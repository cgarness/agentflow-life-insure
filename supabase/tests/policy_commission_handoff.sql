-- Phase 2A policy commission tracking: sale companions, evidence binding, replay and capture outcomes.
-- Runs on a disposable database after the harness and the migration.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE pc_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON pc_results TO authenticated;
CREATE FUNCTION pc_client_id(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM public.clients WHERE first_name = p_first $$;
CREATE FUNCTION pc_r(p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT data FROM pc_results WHERE key = p_key $$;
GRANT EXECUTE ON FUNCTION pc_client_id(text), pc_r(text) TO authenticated;
-- The single slot outcome of a stored result.
CREATE FUNCTION pc_slot_status(p_key text) RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT (pc_r(p_key)->'commission'->'slots'->0->>'status') || '/' || coalesce(pc_r(p_key)->'commission'->'slots'->0->>'code', '-') $$;
CREATE FUNCTION pc_policy_text(p_type text, p_carrier text, p_number text, p_premium text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT jsonb_build_object('policy_type', p_type, 'carrier', p_carrier, 'policy_number', p_number, 'premium', p_premium,
            'sold_date', '2026-10-02', 'effective_date', '2026-11-01', 'face_amount', '50000') $$;
GRANT EXECUTE ON FUNCTION pc_policy_text(text, text, text, text) TO authenticated;
CREATE TEMP TABLE pc_counts AS SELECT 0 AS n;

-- ── Manual new client (create) ──────────────────────────────────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('create', create_client_with_sale_handoff(test_id(2001), test_id(1), pc_client('Create', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('create_retry', create_client_with_sale_handoff(test_id(2001), test_id(1), pc_client('Create', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('create_retry_other_digest', create_client_with_sale_handoff(test_id(2001), test_id(1),
  pc_client('Create', 11, '50.00'), true, pc_payload()));
INSERT INTO pc_results VALUES ('contact_only', create_client_with_sale_handoff(test_id(2002), test_id(1), pc_contact('ContactOnly', 11), false,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('empty', create_client_with_sale_handoff(test_id(2003), test_id(1), pc_client('Empty', 11, '50.00'), true, pc_payload()));
INSERT INTO pc_results VALUES ('null_payload', create_client_with_sale_handoff(test_id(2004), test_id(1), pc_client('NullPayload', 11, '50.00'), true, NULL));
SELECT pc_reject($q$SELECT create_client_with_sale_handoff(test_id(2001), test_id(1), pc_client('Changed', 11, '50.00'), true, NULL)$q$, 'PT409');
SELECT pc_reject($q$SELECT create_client_with_sale_handoff(test_id(2005), test_id(2), pc_client('WrongOrg', 11, '50.00'), true, NULL)$q$, '42501');
SELECT pc_reject($q$SELECT create_client_with_sale_handoff(test_id(2005), test_id(1), pc_client('', 11, '50.00'), true, NULL)$q$, '22023');
RESET ROLE;
SELECT test_assert(pc_slot_status('create') = 'recorded/-' AND pc_r('create')->'commission'->>'status' = 'evidence_recorded'
                   AND NOT (pc_r('create')->>'idempotent')::boolean, 'create records the estimate');
SELECT test_assert((pc_r('create_retry')->>'idempotent')::boolean AND pc_r('create_retry')->'commission' = pc_r('create')->'commission',
                   'identical retry returns the stored outcome');
SELECT test_assert(pc_r('create_retry_other_digest')->'commission'->>'status' = 'already_captured'
                   AND pc_r('create_retry_other_digest')->'commission'->'slots' = pc_r('create')->'commission'->'slots',
                   'same request with a different commission payload keeps the original');
SELECT test_assert(pc_r('contact_only')->'commission'->>'status' = 'not_applicable', 'contact-only save has no commission step');
SELECT test_assert(pc_r('empty')->'commission' = '{"slots": [], "status": "evidence_recorded"}' AND
                   pc_r('null_payload')->'commission' = '{"slots": [], "status": "evidence_recorded"}', 'empty payload still records evidence');
SELECT test_assert((SELECT count(*) FROM policy_commission_handoffs) = 3, 'one evidence row per created sale operation');
SELECT test_assert((SELECT count(*) FROM policy_commission_captures) = 1 AND (SELECT count(*) FROM policy_commission_estimates) = 1
                   AND (SELECT count(*) FROM policy_commission_installments) = 4
                   AND (SELECT count(*) FROM policy_commission_events WHERE event_type = 'estimate_recorded') = 1, 'one capture, estimate, schedule and audit');
SELECT test_assert((SELECT capture_mode = 'sale_entry' AND premium_source = 'sale_snapshot' AND first_year_cents = 57300 AND advance_cents = 42975
                     AND annual_premium = 600 AND first_year_exact = 573 AND advance_exact = 429.75 AND recorded_by = test_id(11)
                     AND credited_agent_id = test_id(11) AND grid_name = 'Synthetic Agency Grid' AND variant_label = 'Ages 18-60'
                    FROM policy_commission_estimates), 'estimate snapshot');
SELECT test_assert((SELECT array_agg(expected_cents ORDER BY sequence) = ARRAY[42975, 4775, 4775, 4775]::bigint[]
                    FROM policy_commission_installments), 'advance and Month 10/11/12 split');
SELECT test_assert((SELECT h.sale_kind = 'create' AND h.actor_id = test_id(11) AND h.credited_agent_id = test_id(11)
                     AND h.sale_operation_key = 'manual:' || test_id(11) || ':' || test_id(2001)
                     AND h.win_ids = (SELECT win_ids FROM private.policy_sale_receipts r WHERE r.operation_key = h.sale_operation_key)
                    FROM policy_commission_handoffs h WHERE request_id = test_id(2001)), 'evidence binds the committed operation');
SELECT test_assert((SELECT count(*) FROM clients WHERE first_name IN ('Changed', 'WrongOrg')) = 0, 'writer errors still roll back');

-- ── Record Policy (additional and first policy), carrier/category matching ─────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('record_fe', record_client_policy_handoff(test_id(2101), pc_client_id('Create'),
  pc_policy_text('Final Expense', '  synthetic LIFE ', 'FE-1', '30.00'), false,
  pc_payload(pc_slot('primary', 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
INSERT INTO pc_results VALUES ('record_fe_retry', record_client_policy_handoff(test_id(2101), pc_client_id('Create'),
  pc_policy_text('Final Expense', '  synthetic LIFE ', 'FE-1', '30.00'), false,
  pc_payload(pc_slot('primary', 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
SELECT pc_reject($q$SELECT record_client_policy_handoff(test_id(2101), pc_client_id('Create'),
  pc_policy_text('Final Expense', 'Synthetic Life', 'FE-2', '31.00'), false, NULL)$q$, 'PT409');
INSERT INTO pc_results VALUES ('record_primary', record_client_policy_handoff(test_id(2102), pc_client_id('ContactOnly'),
  pc_policy_text('Term', 'Synthetic Life', 'T-1', '12.34'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 40, 30, 100, '95.50', '12.34', 14142, 10606))));
RESET ROLE;
SELECT test_assert(pc_slot_status('record_fe') = 'recorded/-' AND pc_r('record_fe_retry')->'commission' = pc_r('record_fe')->'commission',
                   'Final Expense maps to whole life; carrier compares trimmed and case-insensitive');
SELECT test_assert(pc_slot_status('record_primary') = 'recorded/-', 'first policy through Record Policy');
SELECT test_assert((SELECT array_agg(i.expected_cents ORDER BY i.sequence) = ARRAY[10606, 1179, 1179, 1178]::bigint[]
                    FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id = i.estimate_id
                    WHERE e.policy_id = test_id(2102)), 'leftover cents go to Month 10, then Month 11');
SELECT test_assert((SELECT array_agg(i.expected_cents ORDER BY i.sequence) = ARRAY[32400, 3600, 3600, 3600]::bigint[]
                    FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id = i.estimate_id
                    WHERE e.policy_id = test_id(2101)), 'whole life schedule');

-- ── Every validation difference becomes needs_attention with a specific code, never another figure ────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('codes_client', create_client_with_sale_handoff(test_id(2200), test_id(1), pc_contact('Codes', 11), false, NULL));
INSERT INTO pc_results SELECT 'code_' || c.code, record_client_policy_handoff(test_id(2200 + c.n), pc_client_id('Codes'),
    pc_policy_text(c.ptype, 'Synthetic Life', 'C-' || c.n, c.premium), false, pc_payload(c.slot))
  FROM (VALUES
    (1, 'rate_changed', 'Term', '50.00', pc_slot('primary', 11, 501, 511, 35, 20, 100, '96.00', '50.00', 57600, 43200)),
    (2, 'grid_changed', 'Term', '50.00', pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) || '{"grid_revision": 1}'),
    (3, 'product_unavailable', 'IUL', '50.00', pc_slot('primary', 11, 503, 513, 35, NULL, 100, '100', '50.00', 60000, 45000)),
    (4, 'policy_mismatch', 'Whole Life', '50.00', pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)),
    (5, 'not_available', 'Term', '50.00', pc_slot('primary', 11, 501, 511, 70, 20, 100, '95.50', '50.00', 57300, 42975)),
    (6, 'variant_changed', 'Term', '50.00', pc_slot('primary', 11, 501, 512, 35, 20, 100, '95.50', '50.00', 57300, 42975)),
    (7, 'premium_mismatch', 'Term', '50.00', pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '51.00', 58446, 43835)),
    (8, 'amount_changed', 'Term', '50.00', pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57301, 42975)),
    (9, 'term_not_applicable', 'Final Expense', '30.00', pc_slot('primary', 11, 502, 512, 62, 20, 100, '120.00', '30.00', 43200, 32400)),
    (10, 'no_term', 'Term', '50.00', pc_slot('primary', 11, 504, 514, 35, 30, 100, '90', '50.00', 54000, 40500)),
    (11, 'carrier', 'Term', '50.00', pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))
  ) c(n, code, ptype, premium, slot)
  WHERE c.code <> 'carrier';
INSERT INTO pc_results VALUES ('code_carrier', record_client_policy_handoff(test_id(2211), pc_client_id('Codes'),
  pc_policy_text('Term', 'Other Carrier', 'C-11', '50.00'), false,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
RESET ROLE;
SELECT test_assert(pc_slot_status('code_rate_changed') = 'needs_attention/rate_changed', 'rate change');
SELECT test_assert(pc_slot_status('code_grid_changed') = 'needs_attention/grid_changed', 'grid revision change');
SELECT test_assert(pc_slot_status('code_product_unavailable') = 'needs_attention/product_unavailable', 'inactive product');
SELECT test_assert(pc_slot_status('code_policy_mismatch') = 'needs_attention/policy_mismatch', 'policy type category');
SELECT test_assert(pc_slot_status('code_carrier') = 'needs_attention/policy_mismatch', 'carrier');
SELECT test_assert(pc_slot_status('code_not_available') = 'needs_attention/not_available', 'age outside the grid');
SELECT test_assert(pc_slot_status('code_variant_changed') = 'needs_attention/variant_changed', 'variant');
SELECT test_assert(pc_slot_status('code_premium_mismatch') = 'needs_attention/premium_mismatch', 'premium differs from the sale snapshot');
SELECT test_assert(pc_slot_status('code_amount_changed') = 'needs_attention/amount_changed', 'cents differ');
SELECT test_assert(pc_slot_status('code_term_not_applicable') = 'needs_attention/not_available', 'term for a non-term product');
SELECT test_assert(pc_slot_status('code_no_term') = 'needs_attention/not_available', 'unsupported term');
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates e JOIN policy_commission_captures c ON c.id = e.capture_id
                    WHERE c.attention_code IS NOT NULL) = 0
                   AND (SELECT count(*) FROM policy_commission_captures WHERE status = 'needs_attention') = 11,
                   'no estimate for any capture that needs attention');

-- Seller level: off the grid and malformed (admin saves for the seller and may write).
SELECT pc_login(13);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('level_offgrid', create_client_with_sale_handoff(test_id(2301), test_id(1), pc_client('Offgrid', 18, '50.00'), true,
  pc_payload(pc_slot('primary', 18, 501, 511, 35, 20, 95, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('level_malformed', create_client_with_sale_handoff(test_id(2302), test_id(1), pc_client('Malformed', 17, '50.00'), true,
  pc_payload(pc_slot('primary', 17, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('agent_changed', create_client_with_sale_handoff(test_id(2303), test_id(1), pc_client('AgentChanged', 12, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('admin_for_ben', create_client_with_sale_handoff(test_id(2304), test_id(1), pc_client('AdminForBen', 12, '10.01'), true,
  pc_payload(pc_slot('primary', 12, 501, 511, 35, 20, 90, '85.25', '10.01', 10240, 7680))));
RESET ROLE;
SELECT test_assert(pc_slot_status('level_offgrid') = 'needs_attention/level_changed', 'level not on the grid');
SELECT test_assert(pc_slot_status('level_malformed') = 'needs_attention/level_changed', 'malformed level');
SELECT test_assert(pc_slot_status('agent_changed') = 'not_recorded/agent_changed'
                   AND NOT EXISTS (SELECT 1 FROM policy_commission_captures c JOIN policy_commission_handoffs h ON h.id = c.handoff_id
                                    WHERE h.request_id = test_id(2303)), 'presented seller differs from the sale seller: no capture');
SELECT test_assert(pc_slot_status('admin_for_ben') = 'recorded/-' AND (SELECT recorded_by = test_id(13) AND credited_agent_id = test_id(12)
                    FROM policy_commission_estimates WHERE first_year_cents = 10240), 'admin records for the seller at the seller''s level');
SELECT test_assert((SELECT array_agg(i.expected_cents ORDER BY i.sequence) = ARRAY[7680, 854, 853, 853]::bigint[]
                    FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id = i.estimate_id
                    WHERE e.first_year_cents = 10240), 'one leftover cent to Month 10');

-- ── Team Leader: read-only capture awaiting the seller; without the toggle nothing is captured ───────────
INSERT INTO role_permissions(organization_id, role, permissions) VALUES (test_id(1), 'Team Leader',
  '{"c":[{"name":"View Own Commission Percentage","teamLeader":true},{"name":"View Others'' Commission Percentage","teamLeader":true}]}');
SELECT pc_login(14);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('tl', create_client_with_sale_handoff(test_id(2401), test_id(1), pc_client('LeaderSale', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('tl_read', get_client_policy_commissions(pc_client_id('LeaderSale')));
SELECT pc_reject(format('SELECT confirm_policy_commission_capture(%L, %L)', test_id(2402),
  (SELECT pc_r('tl_read')->'policies'->0->'capture'->>'id')), '42501');
RESET ROLE;
SELECT test_assert(pc_slot_status('tl') = 'awaiting_confirmation/-', 'team leader capture awaits the seller');
SELECT test_assert(pc_r('tl_read')->'policies'->0->>'state' = 'awaiting_confirmation' AND pc_r('tl_read')->'policies'->0->>'access' = 'read',
                   'team leader reads the pending capture');
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('confirm', confirm_policy_commission_capture(test_id(2403), (pc_r('tl_read')->'policies'->0->'capture'->>'id')::uuid));
INSERT INTO pc_results VALUES ('confirm_retry', confirm_policy_commission_capture(test_id(2403), (pc_r('tl_read')->'policies'->0->'capture'->>'id')::uuid));
SELECT pc_reject(format('SELECT confirm_policy_commission_capture(%L, %L)', test_id(2404), pc_r('tl_read')->'policies'->0->'capture'->>'id'), '22023');
RESET ROLE;
SELECT test_assert(pc_r('confirm') = pc_r('confirm_retry') AND pc_r('confirm')->>'status' = 'recorded', 'confirmation is idempotent');
SELECT test_assert((SELECT e.capture_mode = 'sale_entry' AND c.captured_by = test_id(14) AND e.recorded_by = test_id(11) AND c.status = 'recorded'
                    FROM policy_commission_estimates e JOIN policy_commission_captures c ON c.id = e.capture_id
                    WHERE c.captured_by = test_id(14)), 'confirmed capture keeps entry provenance');
DELETE FROM role_permissions;
SELECT pc_login(14);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('tl_no_toggle', create_client_with_sale_handoff(test_id(2405), test_id(1), pc_client('LeaderNoToggle', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
RESET ROLE;
SELECT test_assert(pc_slot_status('tl_no_toggle') = 'not_recorded/not_permitted', 'no commission access: no capture');

-- ── Unassigned client: no seller, nothing manufactured ─────────────────────────────────────────────────────
INSERT INTO clients(id, organization_id, first_name, last_name, assigned_agent_id) VALUES (test_id(2500), test_id(1), 'Unassigned', 'Synthetic', NULL);
SELECT pc_login(13);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('unassigned_empty', record_client_policy_handoff(test_id(2501), test_id(2500),
  pc_policy_text('Term', 'Synthetic Life', 'U-1', '50.00'), false, pc_payload()));
INSERT INTO pc_results VALUES ('unassigned_slot', record_client_policy_handoff(test_id(2502), test_id(2500),
  pc_policy_text('Term', 'Synthetic Life', 'U-2', '50.00'), false,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
RESET ROLE;
SELECT test_assert(pc_r('unassigned_empty')->'commission'->>'status' = 'evidence_recorded'
                   AND pc_slot_status('unassigned_slot') = 'not_recorded/agent_changed'
                   AND (SELECT credited_agent_id IS NULL FROM policy_commission_handoffs WHERE request_id = test_id(2501)),
                   'unassigned sale records evidence without a seller');

-- ── Conversion: primary + additional rows bound by row UUID ─────────────────────────────────────────────
INSERT INTO leads(id, organization_id, user_id, assigned_agent_id, first_name, last_name)
SELECT test_id(3000 + n), test_id(1), test_id(11), test_id(11), 'Lead' || n, 'Synthetic' FROM generate_series(1, 6) n;
INSERT INTO clients(organization_id, first_name, last_name, assigned_agent_id, lead_id) VALUES (test_id(1), 'LegacyConverted', 'Synthetic', test_id(11), test_id(3005));
CREATE FUNCTION pc_conversion_client(p_first text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pc_client(p_first, 11, '50.00') || jsonb_build_object('custom_fields', jsonb_build_object('additional_policies', jsonb_build_array(
    jsonb_build_object('policyId', test_id(3101), 'policyType', 'Final Expense', 'carrier', 'Synthetic Life', 'premiumAmount', '30.00',
                       'soldDate', '2026-10-01', 'effectiveDate', '2026-11-01'),
    jsonb_build_object('policyId', test_id(3102), 'policyType', 'Term', 'carrier', 'Synthetic Life', 'premiumAmount', '12.34',
                       'soldDate', '2026-10-01', 'effectiveDate', '2026-11-01')))) $$;
GRANT EXECUTE ON FUNCTION pc_conversion_client(text) TO authenticated;
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('convert', convert_lead_to_client_with_sales_handoff(test_id(3201), test_id(3001), test_id(1),
  pc_conversion_client('Converted'), NULL, pc_payload(
    pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975),
    pc_slot(test_id(3101)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
INSERT INTO pc_results VALUES ('convert_retry', convert_lead_to_client_with_sales_handoff(test_id(3201), test_id(3001), test_id(1),
  pc_conversion_client('Converted'), NULL, pc_payload(
    pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975),
    pc_slot(test_id(3101)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
INSERT INTO pc_results VALUES ('convert_other_request', convert_lead_to_client_with_sales_handoff(test_id(3202), test_id(3001), test_id(1),
  pc_conversion_client('Converted'), NULL, pc_payload()));
SELECT pc_reject($q$SELECT convert_lead_to_client_with_sales_handoff(test_id(3203), test_id(3001), test_id(1), pc_client('Different', 11, '50.00'), NULL, NULL)$q$, 'PT409');
SELECT pc_reject($q$SELECT convert_lead_to_client_with_sales_handoff(NULL, test_id(3002), test_id(1), pc_client('NoRequest', 11, '50.00'), NULL, NULL)$q$, '22023');
INSERT INTO pc_results VALUES ('convert_unmatched', convert_lead_to_client_with_sales_handoff(test_id(3204), test_id(3002), test_id(1),
  pc_client('Unmatched', 11, '50.00'), NULL, pc_payload(pc_slot(test_id(3999)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
INSERT INTO pc_results VALUES ('convert_cap', convert_lead_to_client_with_sales_handoff(test_id(3205), test_id(3003), test_id(1),
  pc_client('OverCap', 11, '50.00'), NULL, jsonb_build_object('v', 'policy-commission-v1', 'slots',
    (SELECT jsonb_agg(pc_slot(test_id(3300 + n)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400)) FROM generate_series(1, 101) n))));
INSERT INTO pc_results VALUES ('convert_invalid', convert_lead_to_client_with_sales_handoff(test_id(3206), test_id(3004), test_id(1),
  pc_client('Invalid', 11, '50.00'), NULL, pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) || '{"extra": 1}')));
INSERT INTO pc_results VALUES ('convert_legacy', convert_lead_to_client_with_sales_handoff(test_id(3207), test_id(3005), test_id(1),
  pc_client('LegacyRetry', 11, '50.00'), NULL, pc_payload()));
RESET ROLE;
SELECT test_assert((SELECT array_agg(s->>'status' || ':' || (s->>'slot' = 'primary')::text ORDER BY s->>'slot' = 'primary' DESC)
                    FROM jsonb_array_elements(pc_r('convert')->'commission'->'slots') s) = ARRAY['recorded:true', 'recorded:false'],
                   'primary and the matched additional row are recorded');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM policy_commission_captures WHERE policy_id = test_id(3102))
                   AND (SELECT cardinality(win_ids) = 3 FROM policy_commission_handoffs WHERE request_id = test_id(3201)),
                   'an undisplayed row is not captured; evidence lists every committed win');
SELECT test_assert(pc_r('convert_retry')->'commission' = pc_r('convert')->'commission', 'conversion replay returns the stored outcome');
SELECT test_assert(pc_r('convert_other_request')->'commission'->>'status' = 'other_operation'
                   AND pc_r('convert_other_request')->'commission'->'slots' = '[]', 'another request claims nothing');
SELECT test_assert(pc_r('convert_unmatched')->'commission' = '{"slots": [], "reason": "handoff_failed", "status": "not_recorded"}'
                   AND EXISTS (SELECT 1 FROM clients WHERE id = (pc_r('convert_unmatched')->>'client_id')::uuid)
                   AND NOT EXISTS (SELECT 1 FROM policy_commission_handoffs WHERE request_id = test_id(3204)),
                   'unmatched slot fails only the commission step; the sale commits');
SELECT test_assert(pc_r('convert_cap')->'commission'->>'status' = 'not_recorded' AND EXISTS (SELECT 1 FROM clients WHERE id = (pc_r('convert_cap')->>'client_id')::uuid)
                   AND NOT EXISTS (SELECT 1 FROM policy_commission_handoffs WHERE request_id = test_id(3205)), 'over 100 slots: never partial');
SELECT test_assert(pc_r('convert_invalid')->'commission'->>'status' = 'not_recorded', 'unknown payload key refused');
SELECT test_assert(pc_r('convert_legacy')->'commission' = '{"slots": [], "reason": "no_entry_evidence", "status": "not_recorded"}',
                   'legacy conversion has no entry evidence and none is created');
SELECT pc_login(13);
SET ROLE authenticated;
SELECT pc_reject($q$SELECT convert_lead_to_client_with_sales_handoff(test_id(3208), test_id(3001), test_id(1), pc_conversion_client('Converted'), NULL, NULL)$q$, 'PT409');
RESET ROLE;

-- ── First-policy inline edit (D7 receipt-bearing companion) ───────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('edit_client', create_client_with_sale_handoff(test_id(4000), test_id(1), pc_contact('Edit', 11), false, NULL));
INSERT INTO pc_results VALUES ('edit', update_client_with_policy_sale_handoff(test_id(4001), pc_client_id('Edit'),
  jsonb_build_object('carrier', 'Synthetic Life', 'policy_type', 'Term', 'premium', 50, 'policy_number', 'E-1', 'sold_date', '2026-10-03',
                     'effective_date', '2026-11-01', 'updated_at', '2026-10-19T10:00:00Z'),
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
INSERT INTO pc_results VALUES ('edit_retry', update_client_with_policy_sale_handoff(test_id(4001), pc_client_id('Edit'),
  jsonb_build_object('carrier', 'Synthetic Life', 'policy_type', 'Term', 'premium', 50, 'policy_number', 'E-1', 'sold_date', '2026-10-03',
                     'effective_date', '2026-11-01', 'updated_at', '2026-10-19T10:05:00Z'),
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975))));
SELECT pc_reject($q$SELECT update_client_with_policy_sale_handoff(test_id(4001), pc_client_id('Edit'), '{"notes":"changed"}', NULL)$q$, 'PT409');
INSERT INTO pc_results VALUES ('edit_plain', update_client_with_policy_sale_handoff(test_id(4002), pc_client_id('Edit'), '{"notes":"plain edit"}', pc_payload()));
SELECT pc_reject($q$SELECT update_client_with_policy_sale_handoff(test_id(4003), pc_client_id('Edit'), '{"organization_id":"x"}', NULL)$q$, '22023');
RESET ROLE;
SELECT test_assert(pc_slot_status('edit') = 'recorded/-' AND jsonb_array_length(pc_r('edit')->'win_ids') = 1
                   AND NOT (pc_r('edit')->>'idempotent')::boolean, 'first-policy edit records the sale and its estimate');
SELECT test_assert((pc_r('edit_retry')->>'idempotent')::boolean AND pc_r('edit_retry')->'win_ids' = pc_r('edit')->'win_ids'
                   AND pc_r('edit_retry')->'commission' = pc_r('edit')->'commission'
                   AND (SELECT count(*) FROM wins WHERE contact_id = pc_client_id('Edit')) = 1,
                   'edit replay (updated_at differs) returns the stored sale without a second write');
SELECT test_assert(pc_r('edit_plain')->'commission'->>'status' = 'no_new_policy'
                   AND (SELECT win_ids = '{}' FROM private.policy_sale_receipts WHERE operation_key = 'client-edit:' || test_id(11) || ':' || test_id(4002)),
                   'ordinary edit: receipt, no sale, no commission');

-- ── Aggregate budget: slow persistence leaves later slots recoverable, never lost ─────────────────────────
CREATE FUNCTION pc_slow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$;
CREATE TRIGGER pc_slow BEFORE INSERT ON policy_commission_estimates FOR EACH ROW EXECUTE FUNCTION pc_slow();
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('budget', convert_lead_to_client_with_sales_handoff(test_id(3209), test_id(3006), test_id(1),
  pc_client('Budget', 11, '50.00') || jsonb_build_object('custom_fields', jsonb_build_object('additional_policies', jsonb_build_array(
    jsonb_build_object('policyId', test_id(3111), 'policyType', 'Final Expense', 'carrier', 'Synthetic Life', 'premiumAmount', '30.00', 'soldDate', '2026-10-01'),
    jsonb_build_object('policyId', test_id(3112), 'policyType', 'Final Expense', 'carrier', 'Synthetic Life', 'premiumAmount', '30.00', 'soldDate', '2026-10-01')))),
  NULL, pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975),
                   pc_slot(test_id(3111)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400),
                   pc_slot(test_id(3112)::text, 11, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400))));
RESET ROLE;
SELECT test_assert((SELECT array_agg(s->>'status' || '/' || coalesce(s->>'code', '-') ORDER BY s->>'slot' = 'primary' DESC, s->>'slot')
                    FROM jsonb_array_elements(pc_r('budget')->'commission'->'slots') s)
                   = ARRAY['recorded/-', 'needs_attention/budget_exhausted', 'needs_attention/budget_exhausted'], 'budget exhausted after the first slot');
-- Cancellation is never swallowed: the whole request, sale included, rolls back.
SELECT pc_login(11);
SET ROLE authenticated;
SET statement_timeout = '150ms';
SELECT pc_reject($q$SELECT create_client_with_sale_handoff(test_id(2006), test_id(1), pc_client('Cancelled', 11, '50.00'), true,
  pc_payload(pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)))$q$, '57014');
RESET statement_timeout;
RESET ROLE;
SELECT test_assert(pc_client_id('Cancelled') IS NULL AND NOT EXISTS (SELECT 1 FROM private.policy_sale_receipts
                    WHERE operation_key LIKE '%' || test_id(2006)), 'cancellation rolls back the sale');
DROP TRIGGER pc_slow ON policy_commission_estimates;
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('budget_confirm', confirm_policy_commission_capture(test_id(3210),
  (SELECT (p->'capture'->>'id')::uuid FROM jsonb_array_elements(get_client_policy_commissions((pc_r('budget')->>'client_id')::uuid)->'policies') p
    WHERE p->>'policy_id' = test_id(3111)::text)));
RESET ROLE;
SELECT test_assert(pc_r('budget_confirm')->>'status' = 'recorded'
                   AND (SELECT capture_mode FROM policy_commission_estimates WHERE policy_id = test_id(3111)) = 'sale_entry',
                   'a budget-exhausted capture is recoverable by confirmation');

-- ── Server-side operation status (caller-scoped) ──────────────────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('status_same', get_policy_sale_operation_status('create', test_id(2001), NULL,
  jsonb_build_object('p_client', pc_client('Create', 11, '50.00'), 'p_record_sale', true)));
INSERT INTO pc_results VALUES ('status_diff', get_policy_sale_operation_status('create', test_id(2001), NULL,
  jsonb_build_object('p_client', pc_client('Create', 11, '51.00'), 'p_record_sale', true)));
INSERT INTO pc_results VALUES ('status_none', get_policy_sale_operation_status('create', test_id(2999), NULL, NULL));
INSERT INTO pc_results VALUES ('status_convert', get_policy_sale_operation_status('convert', test_id(3201), test_id(3001),
  jsonb_build_object('p_client', pc_conversion_client('Converted'), 'p_campaign_id', NULL)));
INSERT INTO pc_results VALUES ('status_convert_other', get_policy_sale_operation_status('convert', test_id(3202), test_id(3001), NULL));
INSERT INTO pc_results VALUES ('status_legacy', get_policy_sale_operation_status('convert', test_id(3299), test_id(3005), NULL));
INSERT INTO pc_results VALUES ('status_record', get_policy_sale_operation_status('record', test_id(2101), NULL,
  jsonb_build_object('p_client_id', pc_client_id('Create'), 'p_policy', pc_policy_text('Final Expense', '  synthetic LIFE ', 'FE-1', '30.00'), 'p_primary', false)));
INSERT INTO pc_results VALUES ('status_edit', get_policy_sale_operation_status('edit', test_id(4001), NULL,
  jsonb_build_object('p_client_id', pc_client_id('Edit'), 'p_patch', jsonb_build_object('carrier', 'Synthetic Life', 'policy_type', 'Term',
    'premium', 50, 'policy_number', 'E-1', 'sold_date', '2026-10-03', 'effective_date', '2026-11-01', 'updated_at', 'ignored'))));
SELECT pc_reject($q$SELECT get_policy_sale_operation_status('convert', test_id(1), NULL, NULL)$q$, '22023');
RESET ROLE;
SELECT pc_login(13);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('status_admin', get_policy_sale_operation_status('convert', test_id(3201), test_id(3001), NULL));
INSERT INTO pc_results VALUES ('status_admin_create', get_policy_sale_operation_status('create', test_id(2001), NULL, NULL));
RESET ROLE;
SELECT test_assert(pc_r('status_same') @> '{"state": "committed", "same_payload": true, "this_request": true, "commission": "evidence_recorded"}', 'status: same payload');
SELECT test_assert(pc_r('status_diff') @> '{"state": "committed", "same_payload": false}', 'status: different payload');
SELECT test_assert(pc_r('status_none') = '{"state": "not_found"}', 'status: nothing committed for this request');
SELECT test_assert(pc_r('status_convert') @> '{"state": "committed", "same_payload": true, "this_request": true}', 'status: conversion');
SELECT test_assert(pc_r('status_convert_other') @> '{"state": "committed", "this_request": false}', 'status: conversion by another request');
SELECT test_assert(pc_r('status_legacy') = '{"state": "committed_without_receipt"}', 'status: legacy conversion');
SELECT test_assert(pc_r('status_record') @> '{"state": "committed", "same_payload": true}', 'status: record');
SELECT test_assert(pc_r('status_edit') @> '{"state": "committed", "same_payload": true}', 'status: edit ignores updated_at');
SELECT test_assert(pc_r('status_admin') = '{"state": "committed_by_another_user"}', 'status: another actor learns nothing else');
SELECT test_assert(pc_r('status_admin_create') = '{"state": "not_found"}', 'status: manual keys are per actor');

-- ── Contact read: clients RLS ∩ commission access ───────────────────────────────────────────────────────
SELECT pc_login(12);
SET ROLE authenticated;
SELECT pc_reject(format('SELECT get_client_policy_commissions(%L)', pc_client_id('Create')), 'PT404');
RESET ROLE;
SELECT pc_login(21);
SET ROLE authenticated;
SELECT pc_reject(format('SELECT get_client_policy_commissions(%L)', pc_client_id('Create')), 'PT404');
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates) = 0, 'other agency sees no rows');
RESET ROLE;
SELECT pc_login(31);
SET ROLE authenticated;
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates) = 0 AND (SELECT count(*) FROM wins) > 0,
                   'agency group peer sees wins but no commission rows');
RESET ROLE;
-- Reassignment: the new assignee sees the contact but not the original seller's commission.
UPDATE clients SET assigned_agent_id = test_id(12) WHERE id = pc_client_id('Create');
SELECT pc_login(12);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('reassigned', get_client_policy_commissions(pc_client_id('Create')));
SELECT test_assert((SELECT count(*) FROM policy_commission_estimates) = 1, 'new assignee reads only their own seller rows');
RESET ROLE;
SELECT test_assert((SELECT array_agg(p->>'state' ORDER BY p->>'source' DESC) FROM jsonb_array_elements(pc_r('reassigned')->'policies') p)
                   = ARRAY['hidden', 'hidden'], 'reassigned contact: commission hidden');
SELECT pc_login(13);
SET ROLE authenticated;
INSERT INTO pc_results VALUES ('admin_read', get_client_policy_commissions(pc_client_id('Create')));
RESET ROLE;
SELECT test_assert((SELECT array_agg(p->>'state' || ':' || (p->>'access') ORDER BY p->>'source' DESC)
                    FROM jsonb_array_elements(pc_r('admin_read')->'policies') p) = ARRAY['recorded:write', 'recorded:write'], 'admin reads both');

SELECT 'PASS policy commission handoff' AS result;
