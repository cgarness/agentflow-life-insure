-- Commissions center reads (20261020180000): definitions, reconciliation of cards, timeline and paginated lists,
-- statuses, receipts (partial, excess, voids, replacements), holds, superseded estimates, month-crossing windows,
-- month timing, unknown dates, non-monthly schedules, zero rates, missing estimates, open captures, same-org,
-- cross-org, Agency Group peer, reassignment with a restricted contact, permissions, time zone, validation, ACLs and
-- reads that never write. Runs on a disposable database after the Phase 2A harness, both applied migrations, the
-- center harness and 20261020180000. Synthetic data only. Dates are relative to the agency date so the suite does not
-- depend on when it runs.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE cc_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON cc_results TO authenticated;
CREATE FUNCTION cc_put(p_key text, p_data jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ INSERT INTO cc_results VALUES (p_key, p_data) ON CONFLICT (key) DO UPDATE SET data = excluded.data $$;
CREATE FUNCTION cc_get(p_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT data FROM cc_results WHERE key = p_key $$;
CREATE FUNCTION cc_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date $$;
CREATE FUNCTION cc_client(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM clients WHERE first_name = p_first $$;
CREATE FUNCTION cc_policy(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT primary_policy_id FROM clients WHERE first_name = p_first $$;
CREATE FUNCTION cc_est(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT e.id FROM policy_commission_estimates e WHERE e.policy_id = cc_policy(p_first) AND e.status IN ('active', 'on_hold') $$;
CREATE FUNCTION cc_rev(p_first text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT state_revision FROM policy_commission_estimates WHERE id = cc_est(p_first) $$;
CREATE FUNCTION cc_inst(p_first text, p_kind text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM policy_commission_installments WHERE estimate_id = cc_est(p_first) AND kind = p_kind $$;
CREATE FUNCTION cc_receipt(p_request integer) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM policy_commission_receipts WHERE request_id = test_id(p_request) $$;
-- A sale with the standard synthetic estimate (or none) credited to profile p_agent.
CREATE FUNCTION cc_sale(p_first text, p_agent integer, p_extra jsonb DEFAULT '{}', p_with_estimate boolean DEFAULT true,
  p_slot jsonb DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client(p_first, p_agent, '50.00') || p_extra, true,
    CASE WHEN p_with_estimate THEN pc_payload(coalesce(p_slot, pc_slot('primary', p_agent, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975)))
         ELSE pc_payload() END)->'commission'->'slots'->0->>'status'
$$;
-- Edit dates with a first premium date (a person's explicit choice).
CREATE FUNCTION cc_start(p_first text, p_on date) RETURNS void LANGUAGE sql AS $$
  SELECT set_policy_commission_schedule_basis(gen_random_uuid(), cc_est(p_first), cc_rev(p_first), p_on, 'manual') $$;
CREATE FUNCTION cc_pay(p_request integer, p_first text, p_kind text, p_cents bigint, p_on date) RETURNS void LANGUAGE sql AS $$
  SELECT record_policy_commission_receipt(test_id(p_request), cc_inst(p_first, p_kind), p_cents, p_on, NULL) $$;
GRANT EXECUTE ON FUNCTION cc_put(text, jsonb), cc_get(text), cc_today(), cc_client(text), cc_policy(text), cc_est(text), cc_rev(text),
  cc_inst(text, text), cc_receipt(integer), cc_sale(text, integer, jsonb, boolean, jsonb), cc_start(text, date),
  cc_pay(integer, text, text, bigint, date) TO authenticated;

-- An INDEPENDENT recomputation of the §4 definitions straight from the base tables (as postgres, no RLS), written
-- differently from the functions under test (correlated sums per installment, no shared helpers).
CREATE FUNCTION cc_expect(p_agent integer, p_from date, p_to date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH i AS (
    SELECT i.*, e.status AS est_status,
           (SELECT coalesce(sum(r.amount_cents), 0) FROM policy_commission_receipts r WHERE r.installment_id = i.id AND r.voided_at IS NULL) AS rec,
           CASE i.timing_precision WHEN 'unknown' THEN NULL
                WHEN 'month' THEN ((date_trunc('month', i.expected_on) + interval '1 month')::date - 1)
                ELSE coalesce(i.expected_until, i.expected_on) END AS wend
      FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id = i.estimate_id
     WHERE e.credited_agent_id = test_id(p_agent) AND e.organization_id = test_id(1) AND e.status <> 'superseded')
  SELECT jsonb_build_object(
    'expected', (SELECT coalesce(sum(expected_cents), 0) FROM i WHERE est_status = 'active' AND expected_on BETWEEN p_from AND p_to),
    'count', (SELECT count(*) FROM i WHERE est_status = 'active' AND expected_on BETWEEN p_from AND p_to),
    'remaining', (SELECT coalesce(sum(greatest(expected_cents - rec, 0)), 0) FROM i WHERE est_status = 'active' AND expected_on BETWEEN p_from AND p_to),
    'excess', (SELECT coalesce(sum(greatest(rec - expected_cents, 0)), 0) FROM i WHERE est_status = 'active' AND expected_on BETWEEN p_from AND p_to),
    'held', (SELECT coalesce(sum(expected_cents), 0) FROM i WHERE est_status = 'on_hold' AND expected_on BETWEEN p_from AND p_to),
    'received', (SELECT coalesce(sum(amount_cents), 0) FROM policy_commission_receipts r
                  WHERE r.credited_agent_id = test_id(p_agent) AND r.organization_id = test_id(1) AND r.voided_at IS NULL
                    AND r.received_on BETWEEN p_from AND p_to),
    'next90', (SELECT coalesce(sum(expected_cents - rec), 0) FROM i WHERE est_status = 'active' AND expected_on IS NOT NULL
                  AND expected_cents > rec AND wend >= cc_today() AND expected_on <= cc_today() + 89),
    'next90_count', (SELECT count(*) FROM i WHERE est_status = 'active' AND expected_on IS NOT NULL
                  AND expected_cents > rec AND wend >= cc_today() AND expected_on <= cc_today() + 89),
    'check_payment', (SELECT count(*) FROM i WHERE est_status = 'active' AND expected_cents > rec AND expected_on IS NOT NULL AND wend < cc_today()),
    'date_needed', (SELECT count(*) FROM i WHERE est_status = 'active' AND expected_cents > rec AND expected_on IS NULL),
    'eligible', (SELECT count(*) FROM wins w WHERE w.agent_id = test_id(p_agent) AND w.organization_id = test_id(1) AND w.policy_id IS NOT NULL),
    'with_estimate', (SELECT count(*) FROM wins w WHERE w.agent_id = test_id(p_agent) AND w.organization_id = test_id(1)
                        AND EXISTS (SELECT 1 FROM policy_commission_estimates e WHERE e.policy_id = w.policy_id AND e.status <> 'superseded')))
$$;
GRANT EXECUTE ON FUNCTION cc_expect(integer, date, date) TO authenticated;

-- Pages through a list read with a small page size; returns {count, ids, sum_expected, sum_remaining, sum_amount, totals}.
CREATE FUNCTION cc_walk(p_sql text, p_id text, p_limit integer DEFAULT 3) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o integer := 0; r jsonb; ids text[] := '{}'; s_exp bigint := 0; s_rem bigint := 0; s_amt bigint := 0; first jsonb; x jsonb;
BEGIN
  LOOP
    EXECUTE format(p_sql, p_limit, o) INTO r;
    first := coalesce(first, r);
    IF r->'totals' IS DISTINCT FROM first->'totals' OR r->'total_count' IS DISTINCT FROM first->'total_count' THEN
      RAISE EXCEPTION 'FAIL: totals changed between pages';
    END IF;
    EXIT WHEN jsonb_array_length(r->'rows') = 0;
    FOR x IN SELECT * FROM jsonb_array_elements(r->'rows') LOOP
      ids := ids || (x->>p_id);
      s_exp := s_exp + coalesce((x->>'expected_cents')::bigint, 0);
      s_rem := s_rem + coalesce((x->>'remaining_cents')::bigint, 0);
      s_amt := s_amt + CASE WHEN (x->>'voided')::boolean IS NOT TRUE THEN coalesce((x->>'amount_cents')::bigint, 0) ELSE 0 END;
    END LOOP;
    o := o + p_limit;
  END LOOP;
  RETURN jsonb_build_object('count', cardinality(ids), 'distinct', (SELECT count(DISTINCT u) FROM unnest(ids) u), 'ids', to_jsonb(ids),
    'sum_expected', s_exp, 'sum_remaining', s_rem, 'sum_amount', s_amt, 'totals', first->'totals', 'total_count', first->'total_count');
END $$;
GRANT EXECUTE ON FUNCTION cc_walk(text, text, integer) TO authenticated;

-- ── Scenario (Ava, profile 11, is the seller unless noted) ───────────────────────────────────────────────────
-- A zero-rate product on the agency grid (a stored 0 is a real zero).
INSERT INTO comp_products(id, grid_id, organization_id, category, carrier, product_name, is_active)
  VALUES (test_id(505), test_id(500), test_id(1), 'term', 'Zero Mutual', 'Zero Term', true);
INSERT INTO comp_product_variants(id, grid_id, product_id, organization_id, label, min_age, max_age, term_years)
  VALUES (test_id(515), test_id(500), test_id(505), test_id(1), 'Ages 18-60', 18, 60, '{20}');
INSERT INTO comp_rates(grid_id, variant_id, organization_id, contract_level, rate_percent) VALUES (test_id(500), test_id(515), test_id(1), 100, 0);

SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(cc_sale('Alpha', 11) = 'recorded', 'Alpha estimate recorded at sale');
SELECT test_assert(cc_sale('Beta', 11) = 'recorded', 'Beta estimate');
SELECT test_assert(cc_sale('Gamma', 11) = 'recorded', 'Gamma estimate');
SELECT test_assert(cc_sale('Delta', 11, '{"effective_date": null}') = 'recorded', 'Delta estimate without an effective date');
SELECT test_assert(cc_sale('Epsilon', 11, '{"payment_frequency": "quarterly"}') = 'recorded', 'Epsilon quarterly estimate');
SELECT test_assert(cc_sale('Zeta', 11) = 'recorded', 'Zeta estimate');
SELECT test_assert(cc_sale('Eta', 11) = 'recorded', 'Eta estimate');
SELECT test_assert(cc_sale('Kappa', 11) = 'recorded', 'Kappa estimate');
SELECT test_assert(cc_sale('Lambda', 11) = 'recorded', 'Lambda estimate');
SELECT test_assert(cc_sale('Omicron', 11, '{"carrier": "Zero Mutual", "payment_frequency": "quarterly"}', true,
                   pc_slot('primary', 11, 505, 515, 35, 20, 100, '0', '50.00', 0, 0)) = 'recorded', 'zero-rate estimate');
SELECT test_assert(cc_sale('Theta', 11, '{}', false) IS NULL, 'Theta: no estimate shown at sale');
SELECT test_assert(cc_sale('Iota', 11, '{}', true, pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57301, 42976)) = 'needs_attention',
                   'Iota: a capture that needs review');

-- Timing: explicit first premium dates relative to the agency date.
SELECT cc_start('Alpha', cc_today() + 20);
SELECT cc_start('Beta', cc_today() - 70);
SELECT cc_start('Gamma', cc_today() + 5);
SELECT cc_start('Zeta', cc_today() - 40);
-- A premium on Thursday Jan 30, 2031 expects payment Jan 31 – Feb 4: the window crosses a month boundary.
SELECT cc_start('Kappa', DATE '2031-01-30');
SELECT set_policy_commission_installment_timing(gen_random_uuid(), cc_inst('Lambda', 'advance'), cc_rev('Lambda'), 'month',
                                                date_trunc('month', cc_today())::date);
-- Receipts: Alpha's Advance is overpaid; Gamma (held) is paid; Zeta has a corrected and a voided receipt.
SELECT cc_pay(7001, 'Alpha', 'advance', 20000, cc_today() - 1);
SELECT cc_pay(7002, 'Alpha', 'advance', 30000, cc_today());
SELECT set_policy_commission_hold(gen_random_uuid(), cc_est('Gamma'), cc_rev('Gamma'), true, 'Carrier review');
SELECT cc_pay(7003, 'Gamma', 'advance', 10000, cc_today());
SELECT cc_pay(7004, 'Zeta', 'advance', 10000, cc_today() - 3);
SELECT void_policy_commission_receipt(test_id(7005), cc_receipt(7004), cc_rev('Zeta'), 'Wrong amount',
  jsonb_build_object('installment_id', cc_inst('Zeta', 'advance'), 'amount_cents', 15000, 'received_on', cc_today() - 2, 'reference', NULL));
SELECT cc_pay(7006, 'Zeta', 'month_10', 5000, cc_today() - 1);
SELECT void_policy_commission_receipt(test_id(7007), cc_receipt(7006), cc_rev('Zeta'), 'Recorded twice', NULL);
-- Eta: a receipt voided, then the estimate replaced (the old one is superseded and never counted).
SELECT cc_pay(7008, 'Eta', 'advance', 1000, cc_today());
SELECT void_policy_commission_receipt(test_id(7009), cc_receipt(7008), cc_rev('Eta'), 'Estimate replaced', NULL);
RESET ROLE;
SELECT cc_put('eta_old', to_jsonb(cc_est('Eta')));
SET ROLE authenticated;
SELECT test_assert(record_policy_commission_estimate_later(gen_random_uuid(), cc_policy('Eta'),
                     pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) - 'slot', cc_est('Eta'), cc_rev('Eta'),
                     'Corrected product')->>'status' = 'recorded', 'Eta estimate replaced');
-- Ben (12) sells one policy of his own; it must never appear in Ava's reports.
SELECT pc_login(12);
SELECT test_assert(cc_sale('Mu', 12, '{}', true, pc_slot('primary', 12, 501, 511, 35, 20, 90, '85.25', '50.00', 51150, 38363)) = 'recorded',
                   'Ben estimate');
RESET ROLE;
SELECT test_assert((SELECT status FROM policy_commission_estimates WHERE id = (cc_get('eta_old')#>>'{}')::uuid) = 'superseded',
                   'Eta original estimate superseded');
SELECT test_assert((SELECT expected_on <> expected_until AND date_trunc('month', expected_on) <> date_trunc('month', expected_until)
                      FROM policy_commission_installments WHERE id = cc_inst('Kappa', 'advance')), 'Kappa window crosses a month boundary');
SELECT 'PASS commissions center scenario built' AS result;

-- ── Overview: cards, timeline and review reconcile with the independent recomputation ───────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
SELECT cc_put('wide', get_my_commission_overview('custom', cc_today() - 365, cc_today() + 365));
SELECT cc_put('month', get_my_commission_overview());
SELECT cc_put('x_wide', cc_expect(11, cc_today() - 365, cc_today() + 365));
SELECT cc_put('x_month', cc_expect(11, date_trunc('month', cc_today())::date, (date_trunc('month', cc_today()) + interval '1 month')::date - 1));
SELECT test_assert(cc_get('month')#>>'{meta,from}' = date_trunc('month', cc_today())::date::text
                   AND cc_get('month')#>>'{meta,to}' = ((date_trunc('month', cc_today()) + interval '1 month')::date - 1)::text
                   AND cc_get('month')#>>'{meta,today}' = cc_today()::text AND cc_get('month')#>>'{meta,time_zone}' = 'America/Los_Angeles',
                   'default period is this month in the agency time zone');
SELECT test_assert((cc_get(k)#>>'{summary,expected_cents}')::bigint = (cc_get('x_' || k)->>'expected')::bigint
               AND (cc_get(k)#>>'{summary,expected_count}')::bigint = (cc_get('x_' || k)->>'count')::bigint
               AND (cc_get(k)#>>'{summary,remaining_cents}')::bigint = (cc_get('x_' || k)->>'remaining')::bigint
               AND (cc_get(k)#>>'{summary,excess_cents}')::bigint = (cc_get('x_' || k)->>'excess')::bigint
               AND (cc_get(k)#>>'{summary,received_cents}')::bigint = (cc_get('x_' || k)->>'received')::bigint
               AND (cc_get(k)#>>'{summary,held_expected_cents}')::bigint = (cc_get('x_' || k)->>'held')::bigint,
               'cards equal the independent recomputation (' || k || ')')
  FROM unnest(ARRAY['wide', 'month']) k;
SELECT test_assert((cc_get('wide')#>>'{summary,expected_cents}')::bigint > 0 AND (cc_get('wide')#>>'{summary,received_cents}')::bigint > 0
                   AND (cc_get('wide')#>>'{summary,excess_cents}')::bigint = 7025 AND (cc_get('wide')#>>'{summary,held_expected_cents}')::bigint > 0
                   AND (cc_get('month')#>>'{summary,expected_cents}')::bigint > 0, 'the scenario exercises every card');
-- Remaining is per installment over all valid receipts, not Expected − Received-this-period.
SELECT test_assert((cc_get('wide')#>>'{summary,remaining_cents}')::bigint
                   <> (cc_get('wide')#>>'{summary,expected_cents}')::bigint - (cc_get('wide')#>>'{summary,received_cents}')::bigint,
                   'Remaining is not Expected minus Received (held receipts, excess and out-of-period receipts differ)');
SELECT test_assert((cc_get('wide')#>>'{next_90,remaining_cents}')::bigint = (cc_get('x_wide')->>'next90')::bigint
                   AND (cc_get('wide')#>>'{next_90,count}')::bigint = (cc_get('x_wide')->>'next90_count')::bigint
                   AND cc_get('wide')#>>'{next_90,from}' = cc_today()::text AND cc_get('wide')#>>'{next_90,to}' = (cc_today() + 89)::text
                   AND cc_get('wide')->'next_90' = cc_get('month')->'next_90'
                   AND cc_get('wide')->'next_90' = get_my_commission_overview('last_year')->'next_90',
                   'Next 90 days is forward-looking from today and independent of the selected period');
-- Timeline: in-period months sum exactly to the cards; padding months are whole months outside the period.
SELECT test_assert((SELECT sum((b->>'expected_advance_cents')::bigint + (b->>'expected_later_cents')::bigint) FROM jsonb_array_elements(cc_get(k)->'timeline') b
                      WHERE (b->>'in_period')::boolean) = (cc_get(k)#>>'{summary,expected_cents}')::bigint
                   AND (SELECT sum((b->>'received_cents')::bigint) FROM jsonb_array_elements(cc_get(k)->'timeline') b
                         WHERE (b->>'in_period')::boolean) = (cc_get(k)#>>'{summary,received_cents}')::bigint,
                   'timeline in-period buckets reconcile with Expected and Received (' || k || ')')
  FROM unnest(ARRAY['wide', 'month']) k;
SELECT test_assert(jsonb_array_length(cc_get('month')->'timeline') = 12
                   AND (SELECT count(*) FROM jsonb_array_elements(cc_get('month')->'timeline') b WHERE (b->>'in_period')::boolean) = 1
                   AND cc_get('month')#>>'{timeline,5,month}' = to_char(cc_today(), 'YYYY-MM')
                   AND (cc_get('month')#>>'{timeline,5,in_period}')::boolean,
                   'a one-month period gets 5 months before and 6 after');
SELECT test_assert((SELECT bool_and(b->>'from' = (b->>'month') || '-01') FROM jsonb_array_elements(get_my_commission_overview('custom',
                      cc_today() - 10, cc_today() + 10)->'timeline') b WHERE NOT (b->>'in_period')::boolean)
                   AND get_my_commission_overview('custom', DATE '2031-01-15', DATE '2031-02-10')#>>'{timeline,5,from}' = '2031-01-15'
                   AND get_my_commission_overview('custom', DATE '2031-01-15', DATE '2031-02-10')#>>'{timeline,6,to}' = '2031-02-10',
                   'in-period months are clipped to the period; padding months are whole');
-- Month-crossing windows count once, in the month their window starts.
SELECT test_assert((get_my_commission_overview('custom', DATE '2031-01-01', DATE '2031-01-31')#>>'{summary,expected_cents}')::bigint = 42975
                   AND (get_my_commission_overview('custom', DATE '2031-02-01', DATE '2031-02-28')#>>'{summary,expected_cents}')::bigint = 0
                   AND (get_my_commission_overview('custom', DATE '2031-01-01', DATE '2031-02-28')#>>'{summary,expected_cents}')::bigint = 42975,
                   'a window crossing a month boundary is counted once, in its start month');
SELECT test_assert((SELECT b->>'expected_advance_cents' = '42975' AND b->>'expected_later_cents' = '0'
                      FROM jsonb_array_elements(get_my_commission_overview('custom', DATE '2031-01-01', DATE '2031-01-31')->'timeline') b
                     WHERE b->>'month' = '2031-01'), 'future Advance and Months 10–12 are distinguished in the timeline');
SELECT test_assert((cc_get('wide')#>>'{review,check_payment,count}')::bigint = (cc_get('x_wide')->>'check_payment')::bigint
                   AND (cc_get('wide')#>>'{review,check_payment,count}')::bigint >= 2
                   AND (cc_get('wide')#>>'{review,date_needed,count}')::bigint = (cc_get('x_wide')->>'date_needed')::bigint
                   AND (cc_get('wide')#>>'{review,date_needed,count}')::bigint = 7
                   AND (cc_get('wide')#>>'{review,needs_review,count}')::bigint = 1
                   AND (cc_get('wide')#>>'{review,missing_estimate,count}')::bigint = 1
                   AND cc_get('wide')->'review' = cc_get('month')->'review',
                   'Needs review: check payment, date needed (4 Delta + 3 Epsilon), one open capture, one missing estimate; period-independent');
SELECT test_assert((cc_get('wide')#>>'{setup,eligible_count}')::bigint = (cc_get('x_wide')->>'eligible')::bigint
                   AND (cc_get('wide')#>>'{setup,eligible_count}')::bigint = 12
                   AND (cc_get('wide')#>>'{setup,with_estimate_count}')::bigint = (cc_get('x_wide')->>'with_estimate')::bigint
                   AND (cc_get('wide')#>>'{setup,with_estimate_count}')::bigint = 10,
                   'setup completeness: 10 of 12 eligible policies have estimates (Ben''s policy excluded)');
SELECT test_assert((cc_get('wide')#>>'{upcoming,total_count}')::bigint = (cc_get('wide')#>>'{next_90,count}')::bigint
                   AND jsonb_array_length(cc_get('wide')#>'{upcoming,rows}') = least(5, (cc_get('wide')#>>'{next_90,count}')::integer)
                   AND (SELECT bool_and(r->>'status' = 'upcoming') FROM jsonb_array_elements(cc_get('wide')#>'{upcoming,rows}') r)
                   AND (SELECT array_agg(r->>'expected_on' ORDER BY n) = array_agg(r->>'expected_on' ORDER BY r->>'expected_on', n)
                          FROM jsonb_array_elements(cc_get('wide')#>'{upcoming,rows}') WITH ORDINALITY x(r, n)),
                   'Upcoming previews the Next 90 days rows in date order with the full count');
SELECT 'PASS overview cards, timeline, review and setup reconcile' AS result;

-- ── Statuses and per-installment arithmetic ─────────────────────────────────────────────────────────────────
SELECT cc_put('all_rows', (SELECT jsonb_agg(r) FROM generate_series(0, 4) g,
  jsonb_array_elements(get_my_commission_installments('all', NULL, NULL, 'any', 'all', NULL, NULL, 100, g * 100)->'rows') r));
SELECT cc_put('held_rows', get_my_commission_installments('all', NULL, NULL, 'any', 'on_hold', NULL, NULL, 100, 0)->'rows');
RESET ROLE;
CREATE FUNCTION cc_row(p_first text, p_kind text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT r FROM jsonb_array_elements(cc_get('all_rows') || cc_get('held_rows')) r WHERE (r->>'installment_id')::uuid = cc_inst(p_first, p_kind) $$;
GRANT EXECUTE ON FUNCTION cc_row(text, text) TO authenticated;
SET ROLE authenticated;
SELECT test_assert(cc_row('Alpha', 'advance')->>'status' = 'received' AND (cc_row('Alpha', 'advance')->>'received_cents')::bigint = 50000
                   AND (cc_row('Alpha', 'advance')->>'excess_cents')::bigint = 7025 AND (cc_row('Alpha', 'advance')->>'remaining_cents')::bigint = 0
                   AND (cc_row('Alpha', 'month_10')->>'remaining_cents')::bigint = (cc_row('Alpha', 'month_10')->>'expected_cents')::bigint
                   AND (cc_row('Alpha', 'month_10')->>'received_cents')::bigint = 0,
                   'an Advance overpayment shows as excess and never settles Months 10–12');
SELECT test_assert(cc_row('Beta', 'advance')->>'status' = 'check_payment' AND cc_row('Beta', 'month_10')->>'status' = 'upcoming',
                   'a past window without a full receipt is Check payment; a future one is Upcoming');
SELECT test_assert(cc_row('Zeta', 'advance')->>'status' = 'check_payment' AND (cc_row('Zeta', 'advance')->>'received_cents')::bigint = 15000
                   AND (cc_row('Zeta', 'advance')->>'receipt_count')::integer = 1 AND (cc_row('Zeta', 'month_10')->>'received_cents')::bigint = 0,
                   'voided receipts are excluded; the replacement counts once');
SELECT test_assert(cc_row('Gamma', k)->>'status' = 'on_hold' AND cc_row('Gamma', k)->>'estimate_status' = 'on_hold', 'held: ' || k)
  FROM unnest(ARRAY['advance', 'month_10', 'month_11', 'month_12']) k;
SELECT test_assert(NOT (cc_get('all_rows') @> jsonb_build_array(jsonb_build_object('estimate_id', cc_est('Gamma'))))
                   AND jsonb_array_length(cc_get('held_rows')) = 4, '"All" excludes held rows; "On hold" lists them');
SELECT test_assert(cc_row('Delta', k)->>'status' = 'date_needed' AND cc_row('Delta', k)->>'expected_on' IS NULL, 'unknown date: ' || k)
  FROM unnest(ARRAY['advance', 'month_10', 'month_11', 'month_12']) k;
SELECT test_assert(cc_row('Epsilon', 'advance')->>'expected_until' IS NOT NULL AND cc_row('Epsilon', 'month_10')->>'status' = 'date_needed'
                   AND cc_row('Epsilon', 'month_12')->>'status' = 'date_needed', 'quarterly: only the Advance has a window');
SELECT test_assert(cc_row('Lambda', 'advance')->>'timing_precision' = 'month' AND cc_row('Lambda', 'advance')->>'status' = 'upcoming'
                   AND cc_row('Lambda', 'advance')->>'window_end' = ((date_trunc('month', cc_today()) + interval '1 month')::date - 1)::text,
                   'month-only timing is not past until the month ends');
SELECT test_assert(cc_row('Omicron', k)->>'status' = 'none' AND (cc_row('Omicron', k)->>'expected_cents')::bigint = 0, 'zero rate: ' || k)
  FROM unnest(ARRAY['advance', 'month_10', 'month_11', 'month_12']) k;
SELECT test_assert(NOT (cc_get('all_rows') @> jsonb_build_array(jsonb_build_object('estimate_id', cc_get('eta_old'))))
                   AND cc_get('all_rows') @> jsonb_build_array(jsonb_build_object('estimate_id', cc_est('Eta'))),
                   'superseded estimates are never listed; the replacement is');
SELECT test_assert(NOT (cc_get('all_rows') @> jsonb_build_array(jsonb_build_object('policy_id', cc_policy('Mu')))), 'another seller''s rows never appear');
SELECT test_assert(jsonb_array_length(cc_get('all_rows')) = 36, 'nine current non-held estimates × four installments');
SELECT 'PASS statuses, excess, voids, holds, superseded, month timing, unknown dates, non-monthly and zero rates' AS result;

-- ── Lists: card drill-downs reconcile across pagination ─────────────────────────────────────────────────────
SELECT cc_put('walk_expected', cc_walk(format('SELECT get_my_commission_installments(%L, %L, %L, %L, %L, NULL, NULL, %%s, %%s)',
  'custom', cc_today() - 365, cc_today() + 365, 'range', 'all'), 'installment_id'));
SELECT test_assert((cc_get('walk_expected')->>'count')::integer = (cc_get('wide')#>>'{summary,expected_count}')::integer
                   AND (cc_get('walk_expected')->>'distinct')::integer = (cc_get('walk_expected')->>'count')::integer
                   AND (cc_get('walk_expected')->>'total_count')::integer = (cc_get('walk_expected')->>'count')::integer
                   AND (cc_get('walk_expected')->>'sum_expected')::bigint = (cc_get('wide')#>>'{summary,expected_cents}')::bigint
                   AND (cc_get('walk_expected')#>>'{totals,expected_cents}')::bigint = (cc_get('wide')#>>'{summary,expected_cents}')::bigint
                   AND (cc_get('walk_expected')#>>'{totals,remaining_cents}')::bigint = (cc_get('wide')#>>'{summary,remaining_cents}')::bigint,
                   'Expected card → Scheduled list: every page, no duplicates, totals equal the card');
SELECT cc_put('walk_remaining', cc_walk(format('SELECT get_my_commission_installments(%L, %L, %L, %L, %L, NULL, NULL, %%s, %%s)',
  'custom', cc_today() - 365, cc_today() + 365, 'range', 'remaining'), 'installment_id', 4));
SELECT test_assert((cc_get('walk_remaining')->>'sum_remaining')::bigint = (cc_get('wide')#>>'{summary,remaining_cents}')::bigint
                   AND (cc_get('walk_remaining')#>>'{totals,remaining_cents}')::bigint = (cc_get('wide')#>>'{summary,remaining_cents}')::bigint,
                   'Remaining card → Scheduled list filtered to Remaining reconciles');
SELECT cc_put('walk_next', cc_walk('SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''next_90'', ''all'', NULL, NULL, %s, %s)',
  'installment_id', 2));
SELECT test_assert((cc_get('walk_next')->>'sum_remaining')::bigint = (cc_get('wide')#>>'{next_90,remaining_cents}')::bigint
                   AND (cc_get('walk_next')->>'count')::integer = (cc_get('wide')#>>'{next_90,count}')::integer,
                   'Next 90 days card → Scheduled list reconciles');
SELECT cc_put('walk_received', cc_walk(format('SELECT get_my_commission_receipts(%L, %L, %L, false, %%s, %%s)',
  'custom', cc_today() - 365, cc_today() + 365), 'receipt_id', 2));
SELECT test_assert((cc_get('walk_received')->>'sum_amount')::bigint = (cc_get('wide')#>>'{summary,received_cents}')::bigint
                   AND (cc_get('walk_received')#>>'{totals,received_cents}')::bigint = (cc_get('wide')#>>'{summary,received_cents}')::bigint
                   AND (cc_get('walk_received')->>'count')::integer = (cc_get('wide')#>>'{summary,received_count}')::integer
                   AND (cc_get('walk_received')->>'count')::integer = 4,
                   'Received card → History list reconciles (four valid receipts: two Alpha, one Gamma, one Zeta replacement)');
SELECT cc_put('history_all', get_my_commission_receipts('all', NULL, NULL, true, 100, 0));
SELECT test_assert((cc_get('history_all')->>'total_count')::integer = 7 AND (cc_get('history_all')#>>'{totals,voided_count}')::integer = 3
                   AND (cc_get('history_all')#>>'{totals,valid_count}')::integer = 4
                   AND (SELECT r->>'replaced_by_receipt_id' FROM jsonb_array_elements(cc_get('history_all')->'rows') r
                         WHERE (r->>'receipt_id')::uuid = cc_receipt(7004)) = cc_receipt(7005)::text
                   AND (SELECT r->>'replaces_receipt_id' FROM jsonb_array_elements(cc_get('history_all')->'rows') r
                         WHERE (r->>'receipt_id')::uuid = cc_receipt(7005)) = cc_receipt(7004)::text
                   AND (SELECT r->>'estimate_status' FROM jsonb_array_elements(cc_get('history_all')->'rows') r
                         WHERE (r->>'receipt_id')::uuid = cc_receipt(7008)) = 'superseded'
                   AND (SELECT (r->>'voided')::boolean AND r->>'void_reason' = 'Recorded twice' FROM jsonb_array_elements(cc_get('history_all')->'rows') r
                         WHERE (r->>'receipt_id')::uuid = cc_receipt(7006)),
                   'History: one row per receipt, voids with reasons and correction links, superseded estimates kept');
SELECT test_assert(NOT (cc_get('history_all')->'rows'->0 ? 'reference'), 'free-text references are not listed');
SELECT test_assert(get_my_commission_installments('all', NULL, NULL, 'any', 'all', 'advance', NULL, 100, 0)->>'total_count' = '9'
                   AND get_my_commission_installments('all', NULL, NULL, 'any', 'all', 'later', NULL, 100, 0)->>'total_count' = '27'
                   AND get_my_commission_installments('all', NULL, NULL, 'any', 'all', NULL, ' zero mutual ', 100, 0)->>'total_count' = '4'
                   AND get_my_commission_installments('all', NULL, NULL, 'any', 'check_payment', NULL, NULL, 100, 0)->>'total_count'
                       = (cc_get('wide')#>>'{review,check_payment,count}')
                   AND get_my_commission_installments('all', NULL, NULL, 'any', 'date_needed', NULL, NULL, 100, 0)->>'total_count' = '7'
                   AND get_my_commission_installments('all', NULL, NULL, 'any', 'all', NULL, NULL, 1, 0)->'carriers' = '["Synthetic Life", "Zero Mutual"]',
                   'payment type, carrier (trimmed, case-insensitive) and status filters');
SELECT 'PASS card drill-downs reconcile across pagination; filters' AS result;

-- ── Policies: one row per stable policy id; missing estimates from eligible policies ────────────────────────
SELECT cc_put('policies', get_my_commission_policies('all', NULL, 100, 0));
SELECT test_assert((cc_get('policies')->>'total_count')::integer = 12
                   AND (SELECT count(DISTINCT r->>'policy_id') FROM jsonb_array_elements(cc_get('policies')->'rows') r) = 12
                   AND cc_get('policies')->'counts' = '{"eligible_count": 12, "with_estimate_count": 10, "missing_count": 1,
                       "needs_review_count": 1, "on_hold_count": 1}'::jsonb,
                   'Policies: one row per eligible policy with setup counts');
SELECT test_assert((SELECT r->>'policy_id' FROM jsonb_array_elements(get_my_commission_policies('missing', NULL, 100, 0)->'rows') r)
                     = cc_policy('Theta')::text
                   AND (SELECT r->'estimate_cents' = 'null'::jsonb AND r->'received_cents' = 'null'::jsonb AND r->'next_payment' = 'null'::jsonb
                          FROM jsonb_array_elements(cc_get('policies')->'rows') r WHERE (r->>'policy_id')::uuid = cc_policy('Theta')),
                   'Missing commission comes from eligible policies, not the estimates table; missing values are null, not $0');
SELECT test_assert((SELECT r->>'policy_id' FROM jsonb_array_elements(get_my_commission_policies('needs_review', NULL, 100, 0)->'rows') r)
                     = cc_policy('Iota')::text
                   AND (get_my_commission_policies('recorded', NULL, 100, 0)->>'total_count')::integer = 10
                   AND (SELECT r->>'policy_id' FROM jsonb_array_elements(get_my_commission_policies('on_hold', NULL, 100, 0)->'rows') r)
                     = cc_policy('Gamma')::text, 'setup filters');
SELECT test_assert((SELECT (r->>'received_cents')::bigint = 50000 AND (r->>'remaining_cents')::bigint = 57300 - 42975
                          AND (r->>'excess_cents')::bigint = 7025 AND r#>>'{next_payment,kind}' = 'month_10'
                          AND r->>'effective_date' = '2026-11-01' AND r->>'carrier' = 'Synthetic Life' AND r->>'product' = 'Synthetic Term'
                          AND r#>>'{contact,name}' = 'Alpha Synthetic' AND r->>'setup' = 'recorded'
                     FROM jsonb_array_elements(cc_get('policies')->'rows') r WHERE (r->>'policy_id')::uuid = cc_policy('Alpha')),
                   'policy row: estimate, received, remaining, excess, next payment, effective date and contact');
SELECT test_assert((SELECT (r->>'date_needed_count')::integer = 4 FROM jsonb_array_elements(cc_get('policies')->'rows') r
                     WHERE (r->>'policy_id')::uuid = cc_policy('Delta')), 'policy row counts its Date needed payments');
SELECT cc_put('walk_policies', cc_walk('SELECT get_my_commission_policies(''all'', NULL, %s, %s)', 'policy_id', 5));
SELECT test_assert((cc_get('walk_policies')->>'distinct')::integer = 12 AND (cc_get('walk_policies')->>'count')::integer = 12,
                   'policy pages cover every policy once');
SELECT 'PASS policies list, setup state and completeness' AS result;

-- ── Drawer: same per-policy shape as the contact read for visible clients ───────────────────────────────────
SELECT test_assert(get_my_policy_commission(cc_policy(n))->'policy'
                     = (SELECT x FROM jsonb_array_elements(get_client_policy_commissions(cc_client(n))->'policies') x
                         WHERE (x->>'policy_id')::uuid = cc_policy(n))
                   AND get_my_policy_commission(cc_policy(n))#>>'{contact,client_id}' = cc_client(n)::text,
                   'drawer parity with get_client_policy_commissions: ' || n)
  FROM unnest(ARRAY['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Kappa', 'Lambda', 'Omicron', 'Theta', 'Iota']) n;
SELECT test_assert(pc_reject(format('SELECT get_my_policy_commission(%L)', cc_policy('Mu')), 'PT404') = 'Commission not found'
                   AND pc_reject(format('SELECT get_my_policy_commission(%L)', gen_random_uuid()), 'PT404') = 'Commission not found',
                   'another seller''s or an unknown policy is not found');
SELECT 'PASS drawer parity' AS result;

-- ── Reassignment: financial history stays with the seller; the contact becomes restricted ───────────────────
RESET ROLE;
UPDATE clients SET assigned_agent_id = test_id(12) WHERE first_name = 'Alpha';
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(get_my_commission_overview('custom', cc_today() - 365, cc_today() + 365)->'summary' = cc_get('wide')->'summary',
                   'reassignment changes no amount');
SELECT test_assert((SELECT r->'contact' = 'null'::jsonb AND r->>'carrier' = 'Synthetic Life' AND r->'effective_date' = 'null'::jsonb
                          AND r->>'setup' = 'recorded' AND (r->>'received_cents')::bigint = 50000
                     FROM jsonb_array_elements(get_my_commission_policies('all', NULL, 100, 0)->'rows') r WHERE (r->>'policy_id')::uuid = cc_policy('Alpha')),
                   'restricted contact: no name, link or client-record fields; the estimate''s own carrier remains');
SELECT test_assert(get_my_policy_commission(cc_policy('Alpha'))->'contact' = 'null'::jsonb
                   AND get_my_policy_commission(cc_policy('Alpha'))#>'{policy,basis,carrier}' = 'null'::jsonb
                   AND get_my_policy_commission(cc_policy('Alpha'))#>'{policy,basis,effective_date}' = 'null'::jsonb
                   AND get_my_policy_commission(cc_policy('Alpha'))#>>'{policy,access}' = 'write'
                   AND jsonb_array_length(get_my_policy_commission(cc_policy('Alpha'))#>'{policy,estimate,installments}') = 4
                   AND NOT (get_my_policy_commission(cc_policy('Alpha'))::text LIKE '%Alpha%'),
                   'restricted drawer: payments and controls stay; the client name never appears');
SELECT test_assert((SELECT bool_and(r->'contact' = 'null'::jsonb) FROM jsonb_array_elements(get_my_commission_receipts('all', NULL, NULL, true, 100, 0)->'rows') r
                     WHERE (r->>'policy_id')::uuid = cc_policy('Alpha')), 'History rows of a restricted contact carry no contact');
SELECT test_assert(record_policy_commission_receipt(test_id(7010), cc_inst('Alpha', 'month_10'), 100, cc_today(), NULL)->>'status' = 'recorded',
                   'the credited seller can still record a payment after reassignment (existing writer)');
SELECT pc_login(12);
SELECT test_assert(NOT (get_my_commission_policies('all', NULL, 100, 0)::text LIKE '%' || cc_policy('Alpha') || '%')
                   AND (get_my_commission_policies('all', NULL, 100, 0)->>'total_count')::integer = 1
                   AND pc_reject(format('SELECT get_my_policy_commission(%L)', cc_policy('Alpha')), 'PT404') = 'Commission not found',
                   'the new assignee does not receive the seller''s commission');
SELECT 'PASS reassignment: seller keeps financial history, contact restricted, assignee sees nothing' AS result;

-- ── Same organization, other organization, Agency Group peer ────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  FOREACH n IN ARRAY ARRAY[13, 14, 21, 31] LOOP
    PERFORM pc_login(n);
    PERFORM test_assert((get_my_commission_overview()#>>'{setup,eligible_count}')::integer = 0
                   AND get_my_commission_overview('custom', cc_today() - 365, cc_today() + 365)#>>'{summary,expected_cents}' = '0'
                   AND get_my_commission_installments('all', NULL, NULL, 'any', 'all', NULL, NULL, 100, 0)->>'total_count' = '0'
                   AND get_my_commission_receipts('all', NULL, NULL, true, 100, 0)->>'total_count' = '0'
                   AND pc_reject(format('SELECT get_my_policy_commission(%L)', cc_policy('Beta')), 'PT404') = 'Commission not found',
                   'My commissions only: profile ' || n || ' sees none of Ava''s records');
  END LOOP;
END $$;
SELECT 'PASS same-org admin and team leader, cross-org and Agency Group peer see only their own' AS result;

-- ── Permissions, sign-in, time zone and validation ──────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO role_permissions(organization_id, role, permissions) VALUES (test_id(1), 'Agent',
  '{"c":[{"name":"View Own Commission Percentage","agent":false}]}');
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(pc_reject(q, '42501') = 'Commission access is unavailable', 'own toggle off refuses: ' || q)
  FROM unnest(ARRAY['SELECT get_my_commission_overview()', 'SELECT get_my_commission_installments()', 'SELECT get_my_commission_receipts()',
                    'SELECT get_my_commission_policies()', format('SELECT get_my_policy_commission(%L)', cc_policy('Beta'))]) q;
RESET ROLE;
DELETE FROM role_permissions WHERE organization_id = test_id(1) AND role = 'Agent';
SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', false);
SET ROLE authenticated;
SELECT test_assert(pc_reject('SELECT get_my_commission_overview()', '42501') = 'Commission access is unavailable', 'no signed-in actor refuses');
RESET ROLE;
SET ROLE anon;
SELECT test_assert(pc_reject('SELECT get_my_commission_overview()', '42501') LIKE 'permission denied%', 'anon cannot execute');
RESET ROLE;
SET ROLE service_role;
SELECT test_assert(pc_reject('SELECT get_my_commission_overview()', '42501') LIKE 'permission denied%', 'service_role cannot execute');
RESET ROLE;
UPDATE company_settings SET timezone = NULL WHERE organization_id = test_id(1);
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(pc_reject('SELECT get_my_commission_overview()', '55000') = 'The agency time zone is not set', 'unset agency time zone fails closed');
RESET ROLE;
UPDATE company_settings SET timezone = 'Factory' WHERE organization_id = test_id(1);
SET ROLE authenticated;
SELECT test_assert(pc_reject('SELECT get_my_commission_policies()', '55000') = 'The agency time zone is not set', 'a pseudo-zone fails closed');
RESET ROLE;
UPDATE company_settings SET timezone = 'America/Los_Angeles' WHERE organization_id = test_id(1);
SET ROLE authenticated;
SELECT test_assert(pc_reject(q, '22023') IS NOT NULL, 'invalid input refused: ' || q)
  FROM unnest(ARRAY[
    'SELECT get_my_commission_overview(''weekly'')', 'SELECT get_my_commission_overview(''all'')',
    'SELECT get_my_commission_overview(''custom'', ''2026-10-10'', ''2026-10-01'')',
    'SELECT get_my_commission_overview(''custom'', ''2026-01-01'', ''2028-01-02'')',
    'SELECT get_my_commission_overview(''custom'', ''1999-12-31'', ''2000-01-31'')',
    'SELECT get_my_commission_overview(''custom'', NULL, ''2026-10-01'')',
    'SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''sideways'')',
    'SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''range'', ''overdue'')',
    'SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''range'', ''all'', ''month_13'')',
    'SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''range'', ''all'', NULL, NULL, 0, 0)',
    'SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''range'', ''all'', NULL, NULL, 101, 0)',
    'SELECT get_my_commission_installments(''this_month'', NULL, NULL, ''range'', ''all'', NULL, NULL, 10, -1)',
    'SELECT get_my_commission_receipts(''this_month'', NULL, NULL, NULL)',
    'SELECT get_my_commission_policies(''paid'')']) q;
SELECT test_assert(get_my_commission_overview('custom', DATE '2026-01-01', DATE '2027-12-31') IS NOT NULL
                   AND jsonb_array_length(get_my_commission_overview('custom', DATE '2026-01-01', DATE '2027-12-31')->'timeline') = 24,
                   'a two-year custom range is allowed (24 months, no padding)');
SELECT 'PASS permissions, sign-in, time zone and validation' AS result;

-- ── Reads never write ───────────────────────────────────────────────────────────────────────────────────────
-- pg_stat_xact_* also shows not-yet-reported counts of earlier transactions in this session, so the check is a
-- before/after delta inside one transaction; any write would also assign a transaction id.
RESET ROLE;
BEGIN;
SELECT pc_login(11);
SET LOCAL ROLE authenticated;
SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) AS before_writes FROM pg_stat_xact_user_tables \gset
SELECT get_my_commission_overview(), get_my_commission_installments('all', NULL, NULL, 'any', 'all', NULL, NULL, 100, 0),
       get_my_commission_receipts('all', NULL, NULL, true, 100, 0), get_my_commission_policies(), get_my_policy_commission(cc_policy('Beta'))
  \gset ignored_
SELECT test_assert(txid_current_if_assigned() IS NULL, 'the five reads assign no transaction id');
SELECT test_assert((SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_xact_user_tables) = :before_writes,
                   'the five reads insert, update or delete nothing');
COMMIT;

-- ── Catalog: invoker, stable, pinned search_path, authenticated-only execution ───────────────────────────────
SELECT test_assert(bool_and(NOT p.prosecdef AND p.provolatile IN ('s', 'i') AND pg_get_userbyid(p.proowner) = 'postgres'
                            AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('agentflow_policy_commission_writer', p.oid, 'EXECUTE')
                            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)),
                   'every new function: SECURITY INVOKER, STABLE/IMMUTABLE, owner postgres, pinned search_path, authenticated only')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'policy_commission_reporting'
    OR p.oid IN ('public.get_my_commission_overview(text,date,date)'::regprocedure,
                 'public.get_my_commission_installments(text,date,date,text,text,text,text,integer,integer)'::regprocedure,
                 'public.get_my_commission_receipts(text,date,date,boolean,integer,integer)'::regprocedure,
                 'public.get_my_commission_policies(text,text,integer,integer)'::regprocedure,
                 'public.get_my_policy_commission(uuid)'::regprocedure);
SELECT test_assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'policy_commission_reporting') = 7,
                   'seven shared helpers');
SELECT test_assert(has_schema_privilege('authenticated', 'policy_commission_reporting', 'USAGE')
                   AND NOT has_schema_privilege('anon', 'policy_commission_reporting', 'USAGE')
                   AND NOT has_schema_privilege('service_role', 'policy_commission_reporting', 'USAGE')
                   AND NOT has_schema_privilege('authenticated', 'policy_commission_reporting', 'CREATE')
                   AND (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'policy_commission_reporting') = '{postgres=UC/postgres,authenticated=U/postgres}',
                   'reporting schema: USAGE for authenticated only');
SELECT test_assert(to_regclass('public.policy_commission_receipts_agent_received') IS NOT NULL
                   AND to_regclass('public.policy_commission_captures_agent_open') IS NOT NULL, 'the two indexes exist');

SELECT 'PASS commissions center reads' AS result;
