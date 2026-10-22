-- Phase 2A policy commission tracking: expected payments, timing, holds, manual receipts, voids, replacement,
-- audit and retention. Runs on a disposable database after the harness and the migration.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE pc_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON pc_results TO authenticated;
CREATE FUNCTION pc_r(p_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT data FROM pc_results WHERE key = p_key $$;
CREATE FUNCTION pc_client_id(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.clients WHERE first_name = p_first $$;
-- Current estimate, its revision and installments of the client's primary policy, as the actor sees them.
CREATE FUNCTION pc_est(p_first text) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT get_client_policy_commissions(pc_client_id(p_first))->'policies'->0->'estimate' $$;
CREATE FUNCTION pc_rev(p_first text) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT (pc_est(p_first)->>'state_revision')::bigint $$;
CREATE FUNCTION pc_inst(p_first text, p_kind text) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT i FROM jsonb_array_elements(pc_est(p_first)->'installments') i WHERE i->>'kind' = p_kind $$;
CREATE FUNCTION pc_timing(p_first text) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT string_agg(i->>'kind' || '=' || (i->>'timing_precision') || ':' || coalesce(i->>'expected_on', '-') || ':' || (i->>'timing_source'),
                       ' ' ORDER BY i->>'kind') FROM jsonb_array_elements(pc_est(p_first)->'installments') i $$;
CREATE FUNCTION pc_any_installment() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.policy_commission_installments ORDER BY id LIMIT 1 $$;
CREATE FUNCTION pc_any_estimate() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.policy_commission_estimates WHERE status = 'active' ORDER BY id LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION pc_any_installment(), pc_any_estimate() TO authenticated;
GRANT EXECUTE ON FUNCTION pc_r(text), pc_client_id(text), pc_est(text), pc_rev(text), pc_inst(text, text), pc_timing(text) TO authenticated;

SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('sale', create_client_with_sale_handoff(test_id(5001), test_id(1), pc_client('Track', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
SELECT test_assert(pc_rev('Track') = 1 AND pc_timing('Track') =
  'advance=unknown:-:unset month_10=unknown:-:unset month_11=unknown:-:unset month_12=unknown:-:unset', 'timing starts unconfirmed');

-- ── Schedule basis: Month 10/11/12 = basis month + 9/10/11; never automatic; replay-safe ───────────────────
INSERT INTO pc_results VALUES ('basis', set_policy_commission_schedule_basis(test_id(5101), (pc_est('Track')->>'id')::uuid, 1, '2026-11-15', 'manual'));
INSERT INTO pc_results VALUES ('basis_retry', set_policy_commission_schedule_basis(test_id(5101), (pc_est('Track')->>'id')::uuid, 1, '2026-11-15', 'manual'));
SELECT test_assert(pc_r('basis') = pc_r('basis_retry') AND pc_rev('Track') = 2, 'basis replay returns the stored result');
SELECT test_assert(pc_timing('Track') = 'advance=unknown:-:unset month_10=month:2027-08-01:schedule_basis '
  'month_11=month:2027-09-01:schedule_basis month_12=month:2027-10-01:schedule_basis', 'months from the basis; advance separate');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 1, %L, %L)', test_id(5101), pc_est('Track')->>'id', '2026-12-01', 'manual'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 1, %L, %L)', test_id(5102), pc_est('Track')->>'id', '2026-12-01', 'manual'), 'PT409');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 2, %L, %L)', test_id(5103), pc_est('Track')->>'id', '2026-12-01', 'effective_date'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_schedule_basis(%L, %L, 2, %L, NULL)', test_id(5104), pc_est('Track')->>'id', '2026-12-01'), '22023');
INSERT INTO pc_results VALUES ('basis_effective', set_policy_commission_schedule_basis(test_id(5105), (pc_est('Track')->>'id')::uuid, 2, '2026-11-01', 'effective_date'));
SELECT test_assert(pc_est('Track')->>'schedule_start_source' = 'effective_date' AND pc_rev('Track') = 3, 'effective date offered as basis');

-- ── Per-installment timing: manual timing survives basis changes ─────────────────────────────────────────
INSERT INTO pc_results VALUES ('advance_date', set_policy_commission_installment_timing(test_id(5201), (pc_inst('Track', 'advance')->>'id')::uuid, 3, 'date', '2026-11-20'));
INSERT INTO pc_results VALUES ('m12_month', set_policy_commission_installment_timing(test_id(5202), (pc_inst('Track', 'month_12')->>'id')::uuid, 4, 'month', '2027-12-01'));
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 5, %L, %L)', test_id(5203), pc_inst('Track', 'month_11')->>'id', 'month', '2027-09-15'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 5, %L, %L)', test_id(5204), pc_inst('Track', 'month_11')->>'id', 'unknown', '2027-09-01'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_installment_timing(%L, %L, 4, %L, %L)', test_id(5205), pc_inst('Track', 'month_11')->>'id', 'date', '2027-09-03'), 'PT409');
INSERT INTO pc_results VALUES ('basis_change', set_policy_commission_schedule_basis(test_id(5206), (pc_est('Track')->>'id')::uuid, 5, '2027-01-31', 'manual'));
SELECT test_assert(pc_timing('Track') = 'advance=date:2026-11-20:manual month_10=month:2027-10-01:schedule_basis '
  'month_11=month:2027-11-01:schedule_basis month_12=month:2027-12-01:manual', 'basis change keeps manual timing (day ignored)');
INSERT INTO pc_results VALUES ('basis_clear', set_policy_commission_schedule_basis(test_id(5207), (pc_est('Track')->>'id')::uuid, 6, NULL, NULL));
SELECT test_assert(pc_timing('Track') = 'advance=date:2026-11-20:manual month_10=unknown:-:unset month_11=unknown:-:unset month_12=month:2027-12-01:manual',
                   'clearing the basis clears only derived timing');
INSERT INTO pc_results VALUES ('basis_again', set_policy_commission_schedule_basis(test_id(5208), (pc_est('Track')->>'id')::uuid, 7, '2026-11-01', 'manual'));

-- ── Hold: estimate-level, reason required, receipts still recordable ─────────────────────────────────────
SELECT pc_reject(format('SELECT set_policy_commission_hold(%L, %L, 8, true, NULL)', test_id(5301), pc_est('Track')->>'id'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_hold(%L, %L, 8, true, %L)', test_id(5302), pc_est('Track')->>'id', 'x'), '22023');
SELECT pc_reject(format('SELECT set_policy_commission_hold(%L, %L, 8, false, NULL)', test_id(5303), pc_est('Track')->>'id'), '22023');
INSERT INTO pc_results VALUES ('hold', set_policy_commission_hold(test_id(5304), (pc_est('Track')->>'id')::uuid, 8, true, '  Carrier review  '));
SELECT test_assert(pc_est('Track')->>'status' = 'on_hold' AND pc_est('Track')->>'status_reason' = 'Carrier review', 'hold placed with trimmed reason');

-- ── Manual receipts: partial, excess, idempotent, validated ──────────────────────────────────────────────
INSERT INTO pc_results VALUES ('r1', record_policy_commission_receipt(test_id(5401), (pc_inst('Track', 'advance')->>'id')::uuid, 20000, current_date, ' Statement 42 '));
INSERT INTO pc_results VALUES ('r1_retry', record_policy_commission_receipt(test_id(5401), (pc_inst('Track', 'advance')->>'id')::uuid, 20000, current_date, 'Statement 42'));
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 20001, current_date, NULL)', test_id(5401), pc_inst('Track', 'advance')->>'id'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 0, current_date, NULL)', test_id(5402), pc_inst('Track', 'advance')->>'id'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100000001, current_date, NULL)', test_id(5403), pc_inst('Track', 'advance')->>'id'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date + 5, NULL)', test_id(5404), pc_inst('Track', 'advance')->>'id'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, %L, NULL)', test_id(5405), pc_inst('Track', 'advance')->>'id', '1999-12-31'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date, %L)', test_id(5406), pc_inst('Track', 'advance')->>'id', repeat('x', 201)), '22023');
INSERT INTO pc_results VALUES ('r2', record_policy_commission_receipt(test_id(5407), (pc_inst('Track', 'advance')->>'id')::uuid, 30000, current_date - 1, NULL));
INSERT INTO pc_results VALUES ('r_m10', record_policy_commission_receipt(test_id(5408), (pc_inst('Track', 'month_10')->>'id')::uuid, 1000, current_date, NULL));
SELECT test_assert(pc_r('r1')->>'receipt_id' = pc_r('r1_retry')->>'receipt_id' AND (pc_r('r1_retry')->>'idempotent')::boolean,
                   'same receipt request returns the original receipt');
SELECT test_assert((SELECT sum((r->>'amount_cents')::bigint) FROM jsonb_array_elements(pc_inst('Track', 'advance')->'receipts') r) = 50000
                   AND jsonb_array_length(pc_inst('Track', 'month_11')->'receipts') = 0
                   AND (SELECT reference FROM policy_commission_receipts WHERE request_id = test_id(5401)) = 'Statement 42',
                   'advance overpayment stays on the advance; reference trimmed');
SELECT test_assert(pc_rev('Track') = 12, 'each receipt bumps the estimate revision');

-- ── Voids and replacements ─────────────────────────────────────────────────────────────────────────────────
SELECT pc_reject(format('SELECT void_policy_commission_receipt(%L, %L, 12, NULL, NULL)', test_id(5501), pc_r('r2')->>'receipt_id'), '22023');
SELECT pc_reject(format('SELECT void_policy_commission_receipt(%L, %L, 11, %L, NULL)', test_id(5502), pc_r('r2')->>'receipt_id', 'Wrong amount'), 'PT409');
SELECT pc_reject(format('SELECT void_policy_commission_receipt(%L, %L, 12, %L, %L)', test_id(5503), pc_r('r2')->>'receipt_id', 'Wrong amount',
  jsonb_build_object('installment_id', pc_inst('Track', 'advance')->>'id', 'amount_cents', 22975)), '22023');
INSERT INTO pc_results VALUES ('void', void_policy_commission_receipt(test_id(5504), (pc_r('r2')->>'receipt_id')::uuid, 12, 'Wrong amount entered',
  jsonb_build_object('installment_id', pc_inst('Track', 'advance')->>'id', 'amount_cents', 22975, 'received_on', current_date - 1, 'reference', NULL)));
INSERT INTO pc_results VALUES ('void_retry', void_policy_commission_receipt(test_id(5504), (pc_r('r2')->>'receipt_id')::uuid, 12, 'Wrong amount entered',
  jsonb_build_object('installment_id', pc_inst('Track', 'advance')->>'id', 'amount_cents', 22975, 'received_on', current_date - 1, 'reference', NULL)));
SELECT pc_reject(format('SELECT void_policy_commission_receipt(%L, %L, 13, %L, NULL)', test_id(5505), pc_r('r2')->>'receipt_id', 'Again'), '22023');
SELECT test_assert(pc_r('void') = pc_r('void_retry') AND pc_r('void')->>'replacement_receipt_id' IS NOT NULL, 'void replay returns the stored result');
SELECT test_assert((SELECT replaces_receipt_id = (pc_r('r2')->>'receipt_id')::uuid AND amount_cents = 22975 AND voided_at IS NULL
                    FROM policy_commission_receipts WHERE id = (pc_r('void')->>'replacement_receipt_id')::uuid)
                   AND (SELECT voided_at IS NOT NULL AND voided_by = test_id(11) AND void_reason = 'Wrong amount entered'
                        FROM policy_commission_receipts WHERE id = (pc_r('r2')->>'receipt_id')::uuid), 'void with replacement');
SELECT test_assert((SELECT sum((r->>'amount_cents')::bigint) FILTER (WHERE r->>'voided_at' IS NULL)
                    FROM jsonb_array_elements(pc_inst('Track', 'advance')->'receipts') r) = 42975, 'active advance receipts equal the expected advance');

-- ── Estimate replacement (D4): needs a reason, no active receipts; carries basis, timing and hold ──────────
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L, %L, %L, %L, %s, %L)', test_id(5601),
  pc_est('Track')->'installments'->0->>'id', '{}', pc_est('Track')->>'id', pc_rev('Track'), 'Corrected inputs'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L, %L, %L, %L, %s, %L)', test_id(5602),
  (SELECT policy_id FROM policy_commission_estimates), pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot',
  pc_est('Track')->>'id', pc_rev('Track'), 'Corrected inputs'), '22023');
RESET ROLE;
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results SELECT 'void_' || (r->>'id'), void_policy_commission_receipt(gen_random_uuid(), (r->>'id')::uuid, pc_rev('Track'), 'Clearing for replacement', NULL)
  FROM jsonb_array_elements(pc_inst('Track', 'advance')->'receipts') r WHERE r->>'voided_at' IS NULL AND r->>'id' <> (pc_r('void')->>'replacement_receipt_id');
INSERT INTO pc_results VALUES ('void_replacement', void_policy_commission_receipt(test_id(5603), (pc_r('void')->>'replacement_receipt_id')::uuid, pc_rev('Track'), 'Clearing for replacement', NULL));
INSERT INTO pc_results VALUES ('void_m10', void_policy_commission_receipt(test_id(5604), (pc_r('r_m10')->>'receipt_id')::uuid, pc_rev('Track'), 'Clearing for replacement', NULL));
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L, %L, %L, %L, %s, NULL)', test_id(5605),
  (SELECT policy_id FROM policy_commission_estimates), pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot',
  pc_est('Track')->>'id', pc_rev('Track')), '22023');
INSERT INTO pc_results VALUES ('old_estimate', pc_est('Track'));
INSERT INTO pc_results VALUES ('replace', record_policy_commission_estimate_later(test_id(5606), (SELECT policy_id FROM policy_commission_estimates),
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', (pc_est('Track')->>'id')::uuid, pc_rev('Track'), 'Corrected inputs'));
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date, NULL)', test_id(5607),
  pc_r('old_estimate')->'installments'->0->>'id'), '22023');
SELECT pc_reject(format('SELECT record_policy_commission_estimate_later(%L, %L, %L, NULL, NULL, NULL)', test_id(5608),
  (SELECT policy_id FROM policy_commission_estimates LIMIT 1), pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot'), '22023');
RESET ROLE;
SELECT test_assert((SELECT status = 'superseded' AND superseded_by = (pc_r('replace')->>'estimate_id')::uuid AND status_reason = 'Corrected inputs'
                    FROM policy_commission_estimates WHERE id = (pc_r('old_estimate')->>'id')::uuid), 'old estimate superseded and linked');
SELECT test_assert((SELECT status = 'on_hold' AND status_reason = 'Carrier review' AND capture_mode = 'recorded_later' AND capture_id IS NULL
                     AND schedule_start_on = '2026-11-01' AND schedule_start_source = 'manual'
                    FROM policy_commission_estimates WHERE id = (pc_r('replace')->>'estimate_id')::uuid), 'replacement carries hold and basis');
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(pc_timing('Track') = 'advance=date:2026-11-20:manual month_10=month:2027-08-01:schedule_basis '
  'month_11=month:2027-09-01:schedule_basis month_12=month:2027-12-01:manual', 'replacement carries per-installment timing');
INSERT INTO pc_results VALUES ('release', set_policy_commission_hold(test_id(5609), (pc_est('Track')->>'id')::uuid, pc_rev('Track'), false, NULL));
RESET ROLE;
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates WHERE status IN ('active', 'on_hold')) = 1, 'one current estimate per policy');

-- ── Dismissal and re-entry; legacy policies use the stored policy premium ────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('attention', record_client_policy_handoff(test_id(5701), pc_client_id('Track'),
  jsonb_build_object('policy_type', 'Term', 'carrier', 'Synthetic Life', 'policy_number', 'A-1', 'premium', '50.00', 'sold_date', '2026-10-02'), false,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '96.00', '50.00', 57600, 43200))));
INSERT INTO pc_results VALUES ('attention_read', (SELECT p FROM jsonb_array_elements(get_client_policy_commissions(pc_client_id('Track'))->'policies') p
  WHERE p->>'policy_id' = test_id(5701)::text));
SELECT pc_reject(format('SELECT dismiss_policy_commission_capture(%L, %L, NULL)', test_id(5702), pc_r('attention_read')->'capture'->>'id'), '22023');
INSERT INTO pc_results VALUES ('dismiss', dismiss_policy_commission_capture(test_id(5703), (pc_r('attention_read')->'capture'->>'id')::uuid, 'Rate was corrected'));
INSERT INTO pc_results VALUES ('dismiss_retry', dismiss_policy_commission_capture(test_id(5703), (pc_r('attention_read')->'capture'->>'id')::uuid, 'Rate was corrected'));
SELECT pc_reject(format('SELECT confirm_policy_commission_capture(%L, %L)', test_id(5704), pc_r('attention_read')->'capture'->>'id'), '22023');
INSERT INTO pc_results VALUES ('later_changed', record_policy_commission_estimate_later(test_id(5706), test_id(5701),
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '96.00', '50.00', 57600, 43200) - 'slot', NULL, NULL, NULL));
INSERT INTO pc_results VALUES ('later', record_policy_commission_estimate_later(test_id(5705), test_id(5701),
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', NULL, NULL, NULL));
INSERT INTO pc_results VALUES ('later_retry', record_policy_commission_estimate_later(test_id(5705), test_id(5701),
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', NULL, NULL, NULL));
RESET ROLE;
SELECT test_assert(pc_r('dismiss') = pc_r('dismiss_retry') AND pc_r('later') = pc_r('later_retry') AND pc_r('later')->>'status' = 'recorded'
                   AND (SELECT capture_mode FROM policy_commission_estimates WHERE id = (pc_r('later')->>'estimate_id')::uuid) = 'recorded_later',
                   'dismissed capture, then a labelled later estimate');
SELECT test_assert(pc_r('later_changed') = '{"code": "rate_changed", "status": "changed"}', 'later entry never records a different figure');

-- ── A later estimate resolves the policy's still-open sale-time capture: terminal 'superseded', never confirmed ──
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('open_sale', record_client_policy_handoff(test_id(5711), pc_client_id('Track'),
  jsonb_build_object('policy_type', 'Term', 'carrier', 'Synthetic Life', 'policy_number', 'S-1', 'premium', '50.00', 'sold_date', '2026-10-02'), false,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '96.00', '50.00', 57600, 43200))));
INSERT INTO pc_results VALUES ('open_read', (SELECT p FROM jsonb_array_elements(get_client_policy_commissions(pc_client_id('Track'))->'policies') p
  WHERE p->>'policy_id' = test_id(5711)::text));
INSERT INTO pc_results VALUES ('resolve', record_policy_commission_estimate_later(test_id(5712), test_id(5711),
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', NULL, NULL, NULL));
INSERT INTO pc_results VALUES ('resolve_retry', record_policy_commission_estimate_later(test_id(5712), test_id(5711),
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', NULL, NULL, NULL));
INSERT INTO pc_results VALUES ('resolved_read', (SELECT p FROM jsonb_array_elements(get_client_policy_commissions(pc_client_id('Track'))->'policies') p
  WHERE p->>'policy_id' = test_id(5711)::text));
SELECT pc_reject(format('SELECT confirm_policy_commission_capture(%L, %L)', test_id(5713), pc_r('open_read')->'capture'->>'id'), '22023');
SELECT pc_reject(format('SELECT dismiss_policy_commission_capture(%L, %L, %L)', test_id(5714), pc_r('open_read')->'capture'->>'id', 'Too late'), '22023');
INSERT INTO pc_results VALUES ('open_sale_replay', record_client_policy_handoff(test_id(5711), pc_client_id('Track'),
  jsonb_build_object('policy_type', 'Term', 'carrier', 'Synthetic Life', 'policy_number', 'S-1', 'premium', '50.00', 'sold_date', '2026-10-02'), false,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '96.00', '50.00', 57600, 43200))));
RESET ROLE;
SELECT test_assert(pc_r('open_read')->>'state' = 'needs_attention', 'the sale-time capture is open');
SELECT test_assert(pc_r('resolve') = pc_r('resolve_retry') AND pc_r('resolve')->>'status' = 'recorded', 'the later estimate is recorded once');
SELECT test_assert((SELECT c.status = 'superseded' AND c.resolved_by_estimate_id = (pc_r('resolve')->>'estimate_id')::uuid
                     AND c.attention_code IS NULL AND c.status_by = test_id(11) AND c.status_at IS NOT NULL
                     AND c.status_reason = 'Estimate recorded later with current rates'
                     AND c.rate_percent = 96.00 AND c.first_year_cents = 57600 AND c.advance_cents = 43200 AND c.captured_by = test_id(11)
                    FROM policy_commission_captures c WHERE c.id = (pc_r('open_read')->'capture'->>'id')::uuid),
                   'capture superseded with its original inputs and provenance, linked to the later estimate');
SELECT test_assert((SELECT capture_mode = 'recorded_later' AND capture_id IS NULL FROM policy_commission_estimates
                    WHERE id = (pc_r('resolve')->>'estimate_id')::uuid), 'the later estimate never claims the capture was confirmed');
SELECT test_assert(pc_r('resolved_read')->>'state' = 'recorded' AND pc_r('resolved_read')->'capture' = 'null'::jsonb,
                   'contact read: recorded, no open capture');
SELECT test_assert(pc_r('open_sale_replay')->'commission'->'slots'->0->>'status' = 'superseded', 'a sale replay reports the slot as superseded');
SELECT test_assert((SELECT count(*) FROM policy_commission_captures WHERE policy_id = test_id(5711)
                     AND status IN ('awaiting_confirmation', 'needs_attention')) = 0, 'no open capture remains for the policy');

-- A legacy (non-snapshot) sale: the later estimate uses the stored policy premium and says so.
ALTER TABLE wins DISABLE TRIGGER wins_policy_identity_guard;
BEGIN;
INSERT INTO clients(id, organization_id, first_name, last_name, assigned_agent_id, policy_type, carrier, premium, effective_date)
VALUES (test_id(5800), test_id(1), 'Legacy', 'Synthetic', test_id(11), 'Term', 'Synthetic Life', 45.50, '2025-03-01');
INSERT INTO wins(organization_id, policy_id, agent_id, contact_id, premium_amount, premium_snapshot, policy_type, idempotency_key)
SELECT test_id(1), primary_policy_id, test_id(11), id, 0, false, 'Term', 'legacy:' || id FROM clients WHERE id = test_id(5800);
COMMIT;
ALTER TABLE wins ENABLE TRIGGER wins_policy_identity_guard;
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('legacy_read', get_client_policy_commissions(test_id(5800)));
INSERT INTO pc_results VALUES ('legacy', record_policy_commission_estimate_later(test_id(5801), (pc_r('legacy_read')->'policies'->0->>'policy_id')::uuid,
  pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '45.50', 52143, 39107) - 'slot', NULL, NULL, NULL));
RESET ROLE;
SELECT test_assert(pc_r('legacy_read')->'policies'->0->>'state' = 'not_recorded'
                   AND pc_r('legacy_read')->'policies'->0->'basis' @> '{"monthly_premium": "45.50", "premium_source": "policy_record"}',
                   'legacy policy offers its stored premium as the basis');
SELECT test_assert((SELECT premium_source = 'policy_record' AND capture_mode = 'recorded_later' FROM policy_commission_estimates
                    WHERE id = (pc_r('legacy')->>'estimate_id')::uuid)
                   AND (SELECT array_agg(i.expected_cents ORDER BY i.sequence) = ARRAY[39107, 4346, 4345, 4345]::bigint[]
                        FROM policy_commission_installments i WHERE i.estimate_id = (pc_r('legacy')->>'estimate_id')::uuid),
                   'legacy estimate labelled and split exactly');

-- ── Write permissions: Team Leader read-only, other agents and agencies refused ──────────────────────────
INSERT INTO role_permissions(organization_id, role, permissions) VALUES (test_id(1), 'Team Leader',
  '{"c":[{"name":"View Own Commission Percentage","teamLeader":true},{"name":"View Others'' Commission Percentage","teamLeader":true}]}');
SELECT pc_login(14);
SET ROLE authenticated;
SELECT test_assert(get_client_policy_commissions(pc_client_id('Track'))->'policies'->0->>'access' = 'read', 'team leader reads the downline estimate');
SELECT pc_reject(format('SELECT set_policy_commission_hold(%L, %L, %s, true, %L)', test_id(5901),
  (SELECT id FROM policy_commission_estimates WHERE status = 'active' AND capture_mode = 'recorded_later' AND premium_source = 'sale_snapshot' LIMIT 1),
  1, 'Leader hold'), '42501');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date, NULL)', test_id(5902),
  (SELECT id FROM policy_commission_installments LIMIT 1)), '42501');
RESET ROLE;
SELECT pc_login(12);
SET ROLE authenticated;
SELECT test_assert((SELECT count(*) FROM policy_commission_installments) = 0, 'another agent reads nothing');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date, NULL)', test_id(5903),
  pc_any_installment()), '42501');
RESET ROLE;
SELECT pc_login(21);
SET ROLE authenticated;
SELECT pc_reject(format('SELECT set_policy_commission_hold(%L, %L, 1, true, %L)', test_id(5904),
  pc_any_estimate(), 'Other agency'), 'PT404');
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date, NULL)', test_id(5906),
  pc_any_installment()), 'PT404');
RESET ROLE;
-- An inactive actor is refused by the real-actor chain even with a valid token.
SELECT pc_login(16);
SET ROLE authenticated;
SELECT pc_reject(format('SELECT record_policy_commission_receipt(%L, %L, 100, current_date, NULL)', test_id(5905), pc_any_installment()), '42501');
SELECT pc_reject(format('SELECT set_policy_commission_hold(%L, %L, 1, true, %L)', test_id(5907), pc_any_estimate(), 'Inactive'), '42501');
SELECT pc_reject(format('SELECT get_client_policy_commissions(%L)', pc_client_id('Track')), '42501');
RESET ROLE;

-- ── Audit: complete before/after, idempotency keys, references never copied ─────────────────────────────
SELECT test_assert((SELECT array_agg(event_type || ':' || n ORDER BY event_type) FROM (
                      SELECT event_type, count(*) n FROM policy_commission_events
                       WHERE estimate_id IN ((pc_r('old_estimate')->>'id')::uuid, (pc_r('replace')->>'estimate_id')::uuid) GROUP BY 1) x)
                   = ARRAY['estimate_recorded:2', 'estimate_replaced:1', 'hold_placed:1', 'hold_released:1', 'installment_timing_set:2',
                           'receipt_voided:4', 'schedule_basis_set:5'], 'every change of the tracked policy is audited');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM policy_commission_events WHERE event_type <> 'estimate_replaced' AND event_type <> 'estimate_recorded'
                     AND (before_state IS NULL OR after_state IS NULL OR result IS NULL OR request_id IS NULL)), 'state changes carry before, after and result');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM policy_commission_events WHERE (to_jsonb(policy_commission_events))::text LIKE '%Statement 42%'),
                   'free-text references are not copied into events');
SELECT test_assert((SELECT before_state->'receipt'->>'amount_cents' = '30000' FROM policy_commission_events WHERE request_id = test_id(5504)),
                   'void audit records the voided receipt');

-- ── Retention and immutability ───────────────────────────────────────────────────────────────────────────
SELECT pc_reject($q$DELETE FROM policy_commission_estimates$q$, '23514');
SELECT pc_reject($q$DELETE FROM policy_commission_receipts WHERE amount_cents = 20000$q$, '23514');
SELECT pc_reject($q$UPDATE policy_commission_receipts SET void_reason = 'changed' WHERE voided_at IS NOT NULL$q$, '42501');
ALTER TABLE wins DISABLE TRIGGER wins_policy_identity_guard;
SELECT pc_reject(format('DELETE FROM wins WHERE id = %L', (SELECT win_id FROM policy_commission_estimates LIMIT 1)), '23503');
ALTER TABLE wins ENABLE TRIGGER wins_policy_identity_guard;
SELECT pc_login(11);
SET ROLE agentflow_policy_commission_writer;
SELECT pc_reject(format('UPDATE policy_commission_estimates SET status = %L WHERE id = %L', 'active', pc_r('old_estimate')->>'id'), '23514');
SELECT pc_reject(format('UPDATE policy_commission_receipts SET void_reason = %L WHERE id = %L', 'Changed later', pc_r('r2')->>'receipt_id'), '23514');
SELECT pc_reject($q$UPDATE policy_commission_estimates SET first_year_cents = 1$q$, '42501');
SELECT pc_reject(format($q$INSERT INTO policy_commission_estimates SELECT (jsonb_populate_record(NULL::policy_commission_estimates,
  to_jsonb(e) || jsonb_build_object('id', gen_random_uuid(), 'status', 'superseded', 'first_year_cents', e.first_year_cents + 1))).*
  FROM policy_commission_estimates e WHERE id = %L$q$, pc_r('legacy')->>'estimate_id'), '23514');
SELECT pc_reject(format($q$WITH e AS (INSERT INTO policy_commission_estimates SELECT (jsonb_populate_record(NULL::policy_commission_estimates,
  to_jsonb(x) || jsonb_build_object('id', test_id(5999), 'status', 'superseded'))).* FROM policy_commission_estimates x WHERE id = %L RETURNING *)
  INSERT INTO policy_commission_installments(organization_id, estimate_id, policy_id, credited_agent_id, kind, sequence, expected_cents)
  SELECT e.organization_id, e.id, e.policy_id, e.credited_agent_id, k, s, 1 FROM e, unnest(ARRAY['advance','month_10','month_11'], ARRAY[1,2,3]) u(k, s)$q$,
  pc_r('legacy')->>'estimate_id'), '23514');
RESET ROLE;
-- Deleting the contact keeps every commission row.
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates WHERE win_id IN (SELECT id FROM wins WHERE contact_id = test_id(5800))) = 1, 'legacy estimate present');
DELETE FROM clients WHERE id = test_id(5800);
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates WHERE win_id IN (SELECT id FROM wins WHERE contact_id = test_id(5800))) = 1
                   AND (SELECT count(*) FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id = i.estimate_id
                        WHERE e.id = (pc_r('legacy')->>'estimate_id')::uuid) = 4, 'contact deletion keeps commission records');

SELECT 'PASS policy commission tracking' AS result;
