-- Commissions insights (20261021180000): carrier and product breakdowns, exact drill-down lists across pagination,
-- comparison windows, Months 10–12, monthly goals (owner, organization and month isolation, RLS on direct access,
-- validation), restricted contacts, unknown carriers and types, multiple policies per client, partial receipts,
-- voids, holds, replacement, Final Expense vs a whole-life grid product, reads that never write, catalog and ACLs.
-- Runs on a disposable database after the Phase 2A harness, the three applied migrations, the center harness and
-- 20261021180000. Synthetic data only. The cohort uses fixed past Sold Dates (March 2026, compared with February
-- 2026); Months 10–12 uses dates relative to the agency date so it does not depend on when the suite runs.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE TABLE ci_results(key text PRIMARY KEY, data jsonb);
GRANT ALL ON ci_results TO authenticated;
CREATE FUNCTION ci_put(p_key text, p_data jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS
  $$ INSERT INTO ci_results VALUES (p_key, p_data) ON CONFLICT (key) DO UPDATE SET data = excluded.data $$;
CREATE FUNCTION ci_get(p_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT data FROM ci_results WHERE key = p_key $$;
CREATE FUNCTION ci_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date $$;
CREATE FUNCTION ci_next_month() RETURNS date LANGUAGE sql STABLE AS
  $$ SELECT (date_trunc('month', ci_today()::timestamp) + interval '1 month')::date $$;
CREATE FUNCTION ci_client(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM clients WHERE first_name = p_first $$;
CREATE FUNCTION ci_policy(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT primary_policy_id FROM clients WHERE first_name = p_first $$;
-- Alpha's second (additional) policy.
CREATE FUNCTION ci_extra(p_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT w.policy_id FROM wins w JOIN clients c ON c.id = w.contact_id WHERE c.first_name = p_first AND w.policy_id <> c.primary_policy_id $$;
CREATE FUNCTION ci_est(p_policy uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM policy_commission_estimates WHERE policy_id = p_policy AND status IN ('active', 'on_hold') $$;
CREATE FUNCTION ci_rev(p_policy uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT state_revision FROM policy_commission_estimates WHERE id = ci_est(p_policy) $$;
CREATE FUNCTION ci_inst(p_policy uuid, p_kind text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM policy_commission_installments WHERE estimate_id = ci_est(p_policy) AND kind = p_kind $$;
CREATE FUNCTION ci_receipt(p_request integer) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT id FROM policy_commission_receipts WHERE request_id = test_id(p_request) $$;
CREATE FUNCTION ci_sale(p_first text, p_agent integer, p_type text, p_carrier text, p_premium text, p_slot jsonb) RETURNS text
LANGUAGE sql AS $$
  SELECT create_client_with_sale_handoff(gen_random_uuid(), test_id(1), pc_client(p_first, p_agent, p_premium, p_type, p_carrier), true,
    CASE WHEN p_slot IS NULL THEN pc_payload() ELSE pc_payload(p_slot) END)->'commission'->'slots'->0->>'status'
$$;
CREATE FUNCTION ci_term(p_agent integer) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT pc_slot('primary', p_agent, 501, 511, 35, 20, 100, '95.50', '50.00', 57300, 42975) $$;
-- The agency grid's whole-life product (also the Final Expense candidate).
CREATE FUNCTION ci_wl(p_agent integer) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT pc_slot('primary', p_agent, 502, 512, 62, NULL, 100, '120.00', '30.00', 43200, 32400) $$;
CREATE FUNCTION ci_pay(p_request integer, p_policy uuid, p_kind text, p_cents bigint, p_on date) RETURNS void LANGUAGE sql AS
  $$ SELECT record_policy_commission_receipt(test_id(p_request), ci_inst(p_policy, p_kind), p_cents, p_on, NULL) $$;
CREATE FUNCTION ci_void(p_request integer, p_receipt integer, p_policy uuid, p_reason text) RETURNS void LANGUAGE sql AS
  $$ SELECT void_policy_commission_receipt(test_id(p_request), ci_receipt(p_receipt), ci_rev(p_policy), p_reason, NULL) $$;
CREATE FUNCTION ci_date(p_policy uuid, p_kind text, p_on date) RETURNS void LANGUAGE sql AS
  $$ SELECT set_policy_commission_installment_timing(gen_random_uuid(), ci_inst(p_policy, p_kind), ci_rev(p_policy), 'date', p_on) $$;
GRANT EXECUTE ON FUNCTION ci_put(text, jsonb), ci_get(text), ci_today(), ci_next_month(), ci_client(text), ci_policy(text), ci_extra(text),
  ci_est(uuid), ci_rev(uuid), ci_inst(uuid, text), ci_receipt(integer), ci_sale(text, integer, text, text, text, jsonb), ci_term(integer),
  ci_wl(integer), ci_pay(integer, uuid, text, bigint, date), ci_void(integer, integer, uuid, text), ci_date(uuid, text, date) TO authenticated;

-- Pages through a list read; returns {count, distinct, sum_estimate, sum_amount, totals, total_count}.
CREATE FUNCTION ci_walk(p_sql text, p_id text, p_limit integer DEFAULT 2) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o integer := 0; r jsonb; ids text[] := '{}'; s_est bigint := 0; s_amt bigint := 0; first jsonb; x jsonb;
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
      s_est := s_est + CASE WHEN x->>'setup' = 'recorded' THEN coalesce((x->>'estimate_cents')::bigint, 0) ELSE 0 END;
      s_amt := s_amt + CASE WHEN (x->>'voided')::boolean IS FALSE THEN coalesce((x->>'amount_cents')::bigint, 0) ELSE 0 END;
    END LOOP;
    o := o + p_limit;
  END LOOP;
  RETURN jsonb_build_object('count', cardinality(ids), 'distinct', (SELECT count(DISTINCT u) FROM unnest(ids) u),
    'sum_estimate', s_est, 'sum_amount', s_amt, 'totals', first->'totals', 'total_count', first->'total_count');
END $$;
GRANT EXECUTE ON FUNCTION ci_walk(text, text, integer) TO authenticated;
CREATE FUNCTION ci_group(p_key text, p_field text, p_value text) RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT g FROM jsonb_array_elements(ci_get(p_key)) g WHERE g->>p_field IS NOT DISTINCT FROM p_value $$;
GRANT EXECUTE ON FUNCTION ci_group(text, text, text) TO authenticated;

-- ── Scenario: Ava (11) sells; Ben (12) has his own sale ─────────────────────────────────────────────────────
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(ci_sale('Alpha', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Alpha term');
SELECT test_assert(record_client_policy_handoff(test_id(8101), ci_client('Alpha'), jsonb_build_object('policy_type', 'Final Expense',
    'carrier', '  synthetic LIFE ', 'policy_number', 'FE-1', 'premium', '30.00', 'sold_date', '2026-10-02', 'effective_date', '2026-11-01',
    'face_amount', '10000'), false, pc_payload(ci_wl(11)))#>>'{commission,slots,0,status}' = 'recorded',
  'Alpha''s second policy: Final Expense on the whole-life grid product');
SELECT test_assert(ci_sale('Bravo', 11, 'Whole Life', 'Synthetic Life', '30.00', ci_wl(11)) = 'recorded', 'Bravo whole life');
SELECT test_assert(ci_sale('Charlie', 11, 'Term', 'SYNTHETIC LIFE ', '50.00', NULL) IS NULL, 'Charlie: no estimate, carrier spelled differently');
SELECT test_assert(ci_sale('Delta', 11, 'Annuity', 'Acme Mutual', '50.00', NULL) IS NULL, 'Delta: unlisted type, another carrier');
SELECT test_assert(ci_sale('Echo', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Echo (held later)');
SELECT test_assert(ci_sale('Foxtrot', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Foxtrot (replaced later)');
SELECT test_assert(ci_sale('Golf', 11, 'Term', 'Synthetic Life', '50.00',
                   pc_slot('primary', 11, 501, 511, 35, 20, 100, '95.50', '50.00', 57301, 42975)) = 'needs_attention', 'Golf: open capture');
SELECT test_assert(ci_sale('Hotel', 11, 'IUL', 'Synthetic Life', '50.00', NULL) IS NULL, 'Hotel: sale type blanked later');
SELECT test_assert(ci_sale('India', 11, 'Term', 'Synthetic Life', '50.00', NULL) IS NULL, 'India: restricted later, no estimate');
SELECT test_assert(ci_sale('Juliet', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Juliet: restricted later');
SELECT test_assert(ci_sale('Kilo', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Kilo: sold the month before');
SELECT test_assert(ci_sale('Lima', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Lima: unknown Sold Date');
SELECT test_assert(ci_sale('Mike', 11, 'Term', 'Synthetic Life', '50.00', ci_term(11)) = 'recorded', 'Mike: sold the day after the period');
SELECT pc_login(12);
SELECT test_assert(ci_sale('November', 12, 'Term', 'Synthetic Life', '50.00',
                   pc_slot('primary', 12, 501, 511, 35, 20, 90, '85.25', '50.00', 51150, 38363)) = 'recorded', 'Ben''s own sale');
RESET ROLE;
-- Sold Dates (synthetic setup of recorded sales, including legacy rows without a Sold Date or policy type; the sale
-- immutability trigger is bypassed for these setup statements only): the March 2026 cohort, the February comparison,
-- boundaries and an unknown date.
SET session_replication_role = replica;
UPDATE wins w SET sold_date = d.sold FROM (VALUES
    (ci_policy('Alpha'), DATE '2026-03-05'), (ci_extra('Alpha'), DATE '2026-03-06'), (ci_policy('Bravo'), DATE '2026-03-10'),
    (ci_policy('Charlie'), DATE '2026-03-11'), (ci_policy('Delta'), DATE '2026-03-01'), (ci_policy('Echo'), DATE '2026-03-12'),
    (ci_policy('Foxtrot'), DATE '2026-03-15'), (ci_policy('Golf'), DATE '2026-03-18'), (ci_policy('Hotel'), DATE '2026-03-20'),
    (ci_policy('India'), DATE '2026-03-22'), (ci_policy('Juliet'), DATE '2026-03-31'), (ci_policy('Kilo'), DATE '2026-02-10'),
    (ci_policy('Lima'), NULL::date), (ci_policy('Mike'), DATE '2026-04-01'), (ci_policy('November'), DATE '2026-03-07')) d(policy, sold)
 WHERE w.policy_id = d.policy;
-- Hotel and India: the sale saved no policy type (older sale); India's and Juliet's contacts move to Ben.
UPDATE wins SET policy_type = NULL WHERE policy_id IN (ci_policy('Hotel'), ci_policy('India'));
SET session_replication_role = origin;
UPDATE clients SET assigned_agent_id = test_id(12) WHERE first_name IN ('India', 'Juliet');
SELECT test_assert((SELECT count(*) FROM wins WHERE agent_id = test_id(11) AND policy_id IS NOT NULL) = 14, 'Ava has 14 eligible policies');

SELECT pc_login(11);
SET ROLE authenticated;
-- Receipts: partial (Alpha), a February sale paid in March (Kilo), a voided one (Bravo), one on a held estimate (Echo),
-- the previous month (Alpha FE), outside the period (Mike), and a voided receipt before Foxtrot's replacement.
SELECT ci_pay(8201, ci_policy('Alpha'), 'advance', 20000, DATE '2026-03-20');
SELECT ci_pay(8202, ci_policy('Kilo'), 'advance', 42975, DATE '2026-03-08');
SELECT ci_pay(8203, ci_policy('Bravo'), 'advance', 10000, DATE '2026-03-28');
SELECT ci_void(8204, 8203, ci_policy('Bravo'), 'Wrong policy');
SELECT ci_pay(8205, ci_extra('Alpha'), 'advance', 1000, DATE '2026-02-15');
SELECT ci_pay(8206, ci_policy('Mike'), 'advance', 3000, DATE '2026-04-03');
SELECT ci_pay(8207, ci_policy('Foxtrot'), 'advance', 2000, DATE '2026-03-21');
SELECT ci_void(8208, 8207, ci_policy('Foxtrot'), 'Estimate replaced');
SELECT ci_pay(8209, ci_policy('Echo'), 'advance', 5000, DATE '2026-03-29');
SELECT ci_date(ci_policy('Echo'), 'month_10', ci_next_month() + 6);
SELECT set_policy_commission_hold(gen_random_uuid(), ci_est(ci_policy('Echo')), ci_rev(ci_policy('Echo')), true, 'Carrier review');
RESET ROLE;
SELECT ci_put('foxtrot_old', to_jsonb(ci_est(ci_policy('Foxtrot'))));
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(record_policy_commission_estimate_later(gen_random_uuid(), ci_policy('Foxtrot'), ci_term(11) - 'slot',
                     ci_est(ci_policy('Foxtrot')), ci_rev(ci_policy('Foxtrot')), 'Corrected product')->>'status' = 'recorded', 'Foxtrot replaced');
-- Months 10–12 next agency month: Alpha M10 partly paid, Kilo M11 after an Advance overpayment, Bravo M12; Echo (held)
-- M10 and Alpha FE's Advance also fall there; Kilo M10 falls the month after.
SELECT ci_date(ci_policy('Alpha'), 'month_10', ci_next_month() + 14);
SELECT ci_pay(8210, ci_policy('Alpha'), 'month_10', 1000, ci_today());
SELECT ci_pay(8211, ci_policy('Kilo'), 'advance', 10000, ci_today());
SELECT ci_date(ci_policy('Kilo'), 'month_11', ci_next_month() + 19);
SELECT ci_date(ci_policy('Kilo'), 'month_10', (ci_next_month() + interval '1 month')::date + 2);
SELECT ci_date(ci_policy('Bravo'), 'month_12', ci_next_month() + 4);
SELECT ci_date(ci_extra('Alpha'), 'advance', ci_next_month() + 9);
RESET ROLE;
SELECT test_assert((SELECT status FROM policy_commission_estimates WHERE id = (ci_get('foxtrot_old')#>>'{}')::uuid) = 'superseded',
                   'Foxtrot''s first estimate is superseded');
SELECT 'PASS commissions insights scenario built' AS result;

-- ── Breakdown: cohort, carriers and products for March 2026 (hand-computed from the scenario) ────────────────
SELECT pc_login(11);
SET ROLE authenticated;
SELECT ci_put('march', get_my_commission_breakdown('custom', DATE '2026-03-01', DATE '2026-03-31'));
SELECT ci_put('march_carriers', ci_get('march')->'carriers');
SELECT ci_put('march_products', ci_get('march')->'products');
SELECT test_assert(ci_get('march')->'sold' = '{"policies": 11, "with_estimate_count": 5, "estimate_cents": 258300, "on_hold_count": 1,
                     "on_hold_cents": 57300, "without_estimate_count": 5, "needs_review_count": 1, "undated_count": 1}'::jsonb,
                   'cohort: 11 policies (with or without estimates), 5 active estimates once each (replacement not doubled), held disclosed');
SELECT test_assert(ci_get('march')->'received' = '{"received_cents": 67975, "receipt_count": 3}'::jsonb
                   AND (get_my_commission_overview('custom', DATE '2026-03-01', DATE '2026-03-31')#>>'{summary,received_cents}')::bigint = 67975,
                   'Received: valid receipts by received date (a February sale paid in March; held estimate''s receipt counts; voids excluded) = the card');
SELECT test_assert(jsonb_array_length(ci_get('march_carriers')) = 3
                   AND ci_group('march_carriers', 'carrier', 'Synthetic Life') = '{"carrier": "Synthetic Life", "policies": 9, "with_estimate_count": 5,
                     "estimate_cents": 258300, "on_hold_count": 1, "on_hold_cents": 57300, "without_estimate_count": 3, "received_cents": 67975,
                     "receipt_count": 3}'::jsonb
                   AND ci_group('march_carriers', 'carrier', 'Acme Mutual') = '{"carrier": "Acme Mutual", "policies": 1, "with_estimate_count": 0,
                     "estimate_cents": 0, "on_hold_count": 0, "on_hold_cents": 0, "without_estimate_count": 1, "received_cents": 0, "receipt_count": 0}'::jsonb
                   AND ci_group('march_carriers', 'carrier', NULL) = '{"carrier": null, "policies": 1, "with_estimate_count": 0, "estimate_cents": 0,
                     "on_hold_count": 0, "on_hold_cents": 0, "without_estimate_count": 1, "received_cents": 0, "receipt_count": 0}'::jsonb,
                   'carriers: spelling variants share one group (case and spaces only), restricted contact without an estimate is Unknown');
SELECT test_assert((SELECT jsonb_object_agg(g->>'category', jsonb_build_array((g->>'policies')::int, (g->>'with_estimate_count')::int,
                      (g->>'estimate_cents')::bigint, (g->>'on_hold_count')::int, (g->>'without_estimate_count')::int))
                      FROM jsonb_array_elements(ci_get('march_products')) g)
                   = '{"term": [6, 3, 171900, 1, 2], "whole_life": [1, 1, 43200, 0, 0], "final_expense": [1, 1, 43200, 0, 0],
                       "iul": [1, 0, 0, 0, 1], "other": [1, 0, 0, 0, 1], "unknown": [1, 0, 0, 0, 1]}'::jsonb
                   AND (SELECT array_agg(g->>'category' ORDER BY n) FROM jsonb_array_elements(ci_get('march_products')) WITH ORDINALITY x(g, n))
                       = ARRAY['term', 'whole_life', 'iul', 'final_expense', 'other', 'unknown'],
                   'products: mutually exclusive; Final Expense never Whole Life; sale type first, visible client type second, else Unknown');
SELECT test_assert((SELECT sum((g->>'policies')::int) FROM jsonb_array_elements(ci_get('march_products')) g) = 11
                   AND (SELECT sum((g->>'policies')::int) FROM jsonb_array_elements(ci_get('march_carriers')) g) = 11
                   AND (SELECT sum((g->>'estimate_cents')::bigint) FROM jsonb_array_elements(ci_get('march_products')) g) = 258300
                   AND (SELECT sum((g->>'received_cents')::bigint) FROM jsonb_array_elements(ci_get('march_carriers')) g) = 67975,
                   'groups add up to the cohort and Received totals');
SELECT test_assert(NOT (ci_get('march')::text LIKE '%' || ci_policy('November') || '%')
                   AND (get_my_commission_breakdown('custom', DATE '2026-03-07', DATE '2026-03-07')#>>'{sold,policies}')::int = 0,
                   'another seller''s sale never appears');
SELECT test_assert((get_my_commission_breakdown('custom', DATE '2026-03-31', DATE '2026-03-31')#>>'{sold,policies}')::int = 1
                   AND (get_my_commission_breakdown('custom', DATE '2026-04-01', DATE '2026-04-30')#>>'{sold,policies}')::int = 1
                   AND (get_my_commission_breakdown('custom', DATE '2026-04-01', DATE '2026-04-30')#>>'{received,received_cents}')::bigint = 3000,
                   'month boundaries: Mar 31 in March, Apr 1 in April');
SELECT 'PASS breakdown cohort, carriers and products' AS result;

-- ── Drill-downs: every bar and slice equals its exactly filtered list, across pagination ─────────────────────
SELECT test_assert((SELECT bool_and(
          (w->>'count')::int = (g->>'policies')::int AND (w->>'distinct')::int = (w->>'count')::int
          AND (w#>>'{totals,policies}')::int = (g->>'policies')::int
          AND (w#>>'{totals,with_estimate_count}')::int = (g->>'with_estimate_count')::int
          AND (w#>>'{totals,estimate_cents}')::bigint = (g->>'estimate_cents')::bigint
          AND (w->>'sum_estimate')::bigint = (g->>'estimate_cents')::bigint
          AND (w#>>'{totals,on_hold_count}')::int = (g->>'on_hold_count')::int
          AND (w#>>'{totals,without_estimate_count}')::int = (g->>'without_estimate_count')::int)
        FROM jsonb_array_elements(ci_get('march_carriers')) g,
        LATERAL (SELECT ci_walk(format('SELECT get_my_commission_policy_list(''all'', %L, %L, NULL, ''custom'', ''2026-03-01'', ''2026-03-31'', %%s, %%s)',
                   g->>'carrier', g->>'carrier' IS NULL), 'policy_id') AS w) x),
       'carrier bar (Policies, Est. commission) → Policies list: same policies, totals and estimate sum, every page');
SELECT test_assert((SELECT bool_and((w#>>'{totals,received_cents}')::bigint = (g->>'received_cents')::bigint
          AND (w->>'sum_amount')::bigint = (g->>'received_cents')::bigint AND (w#>>'{totals,valid_count}')::int = (g->>'receipt_count')::int)
        FROM jsonb_array_elements(ci_get('march_carriers')) g,
        LATERAL (SELECT ci_walk(format('SELECT get_my_commission_receipt_list(''custom'', ''2026-03-01'', ''2026-03-31'', false, %L, %L, %%s, %%s)',
                   g->>'carrier', g->>'carrier' IS NULL), 'receipt_id') AS w) x),
       'carrier bar (Received) → History list: same receipts and total, every page');
SELECT test_assert((SELECT bool_and((w->>'count')::int = (g->>'policies')::int
          AND (w#>>'{totals,estimate_cents}')::bigint = (g->>'estimate_cents')::bigint
          AND (w#>>'{totals,with_estimate_count}')::int = (g->>'with_estimate_count')::int)
        FROM jsonb_array_elements(ci_get('march_products')) g,
        LATERAL (SELECT ci_walk(format('SELECT get_my_commission_policy_list(''all'', NULL, false, %L, ''custom'', ''2026-03-01'', ''2026-03-31'', %%s, %%s)',
                   g->>'category'), 'policy_id') AS w) x),
       'product slice → Policies list: same policies and totals, every page');
SELECT test_assert((get_my_commission_policy_list('all', ' synthetic life ', false, NULL, 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 9
                   AND (get_my_commission_policy_list('all', 'SYNTHETIC LIFE', false, NULL, 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 9
                   AND (get_my_commission_policy_list('all', 'Synthetic', false, NULL, 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 0,
                   'carrier filter: case and surrounding spaces only, never a partial match');
-- The new filters compose with the released setup filter and keep its meaning.
SELECT test_assert((get_my_commission_policy_list('missing', 'Synthetic Life', false, 'term', 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 1
                   AND (get_my_commission_policy_list('needs_review', 'Synthetic Life', false, NULL, 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 1
                   AND (get_my_commission_policy_list('recorded', NULL, false, 'term', 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 4
                   AND (get_my_commission_policy_list('on_hold', NULL, false, NULL, 'custom', DATE '2026-03-01', DATE '2026-03-31', 100, 0)->>'total_count')::int = 1,
                   'setup, carrier, type and Sold Date filters compose');
-- Without a Sold Date period the list is the released Policies list (same rows, plus category and Sold Date).
SELECT ci_put('released_policies', get_my_commission_policies('all', NULL, 100, 0));
SELECT ci_put('new_policies', get_my_commission_policy_list('all', NULL, false, NULL, 'all', NULL, NULL, 100, 0));
SELECT test_assert((ci_get('new_policies')->>'total_count')::int = 14 AND ci_get('new_policies')->'counts' = ci_get('released_policies')->'counts'
                   AND (SELECT jsonb_agg(r - 'category' - 'sold_date' ORDER BY n) FROM jsonb_array_elements(ci_get('new_policies')->'rows') WITH ORDINALITY x(r, n))
                       = ci_get('released_policies')->'rows'
                   AND (ci_get('new_policies')#>>'{totals,policies}')::int = 14
                   AND ci_get('new_policies')->'carriers' = '["Acme Mutual", "Synthetic Life"]' AND (ci_get('new_policies')->>'has_unknown_carrier')::boolean,
                   'All time: identical to the released Policies list (undated included); one carrier name per group; unknown carrier offered');
SELECT test_assert((SELECT r->>'category' = 'unknown' AND r->'contact' = 'null'::jsonb AND r->'carrier' = 'null'::jsonb
                     FROM jsonb_array_elements(ci_get('new_policies')->'rows') r WHERE (r->>'policy_id')::uuid = ci_policy('India'))
                   AND (SELECT r->>'category' = 'term' AND r->'contact' = 'null'::jsonb AND r->>'carrier' = 'Synthetic Life'
                     FROM jsonb_array_elements(ci_get('new_policies')->'rows') r WHERE (r->>'policy_id')::uuid = ci_policy('Juliet'))
                   AND (SELECT r->>'category' = 'iul' FROM jsonb_array_elements(ci_get('new_policies')->'rows') r WHERE (r->>'policy_id')::uuid = ci_policy('Hotel'))
                   AND (SELECT r->>'category' = 'final_expense' FROM jsonb_array_elements(ci_get('new_policies')->'rows') r WHERE (r->>'policy_id')::uuid = ci_extra('Alpha'))
                   AND (SELECT r->'sold_date' = 'null'::jsonb FROM jsonb_array_elements(ci_get('new_policies')->'rows') r WHERE (r->>'policy_id')::uuid = ci_policy('Lima')),
                   'restricted contacts never fill labels from the client record; the estimate''s own carrier and the sale''s type stay');
SELECT ci_put('released_receipts', get_my_commission_receipts('all', NULL, NULL, true, 100, 0));
SELECT ci_put('new_receipts', get_my_commission_receipt_list('all', NULL, NULL, true, NULL, false, 100, 0));
SELECT test_assert(ci_get('new_receipts')->'rows' = ci_get('released_receipts')->'rows'
                   AND ci_get('new_receipts')->'totals' = ci_get('released_receipts')->'totals'
                   AND ci_get('new_receipts')->'carriers' = '["Synthetic Life"]' AND NOT (ci_get('new_receipts')->>'has_unknown_carrier')::boolean,
                   'History without a carrier is identical to the released receipt list');
SELECT 'PASS drill-downs reconcile with every bar and slice; filters compose; released lists unchanged' AS result;

-- ── Comparisons: windows from the agency date (pure helper, fixed dates) and the March figures ───────────────
SELECT test_assert(to_jsonb(c) = e::jsonb, 'comparison ' || l)
  FROM (VALUES
    ('month to date', '2026-10-01', '2026-10-31', '2026-10-21', '{"basis": "months_to_date", "cur_from": "2026-10-01", "cur_to": "2026-10-21", "prev_from": "2026-09-01", "prev_to": "2026-09-21"}'),
    ('month to date on the 1st', '2026-10-01', '2026-10-31', '2026-10-01', '{"basis": "months_to_date", "cur_from": "2026-10-01", "cur_to": "2026-10-01", "prev_from": "2026-09-01", "prev_to": "2026-09-01"}'),
    ('last day of the month is a whole month', '2026-03-01', '2026-03-31', '2026-03-31', '{"basis": "months", "cur_from": "2026-03-01", "cur_to": "2026-03-31", "prev_from": "2026-02-01", "prev_to": "2026-02-28"}'),
    ('Mar 30 clamps to Feb 28', '2026-03-01', '2026-03-31', '2026-03-30', '{"basis": "months_to_date", "cur_from": "2026-03-01", "cur_to": "2026-03-30", "prev_from": "2026-02-01", "prev_to": "2026-02-28"}'),
    ('leap year: Mar 30 → Feb 29', '2028-03-01', '2028-03-31', '2028-03-30', '{"basis": "months_to_date", "cur_from": "2028-03-01", "cur_to": "2028-03-30", "prev_from": "2028-02-01", "prev_to": "2028-02-29"}'),
    ('leap day ends February', '2028-02-01', '2028-02-29', '2028-02-29', '{"basis": "months", "cur_from": "2028-02-01", "cur_to": "2028-02-29", "prev_from": "2028-01-01", "prev_to": "2028-01-31"}'),
    ('year to date on a leap day', '2028-01-01', '2028-12-31', '2028-02-29', '{"basis": "months_to_date", "cur_from": "2028-01-01", "cur_to": "2028-02-29", "prev_from": "2027-01-01", "prev_to": "2027-02-28"}'),
    ('completed month', '2026-09-01', '2026-09-30', '2026-10-21', '{"basis": "months", "cur_from": "2026-09-01", "cur_to": "2026-09-30", "prev_from": "2026-08-01", "prev_to": "2026-08-31"}'),
    ('completed year', '2025-01-01', '2025-12-31', '2026-10-21', '{"basis": "months", "cur_from": "2025-01-01", "cur_to": "2025-12-31", "prev_from": "2024-01-01", "prev_to": "2024-12-31"}'),
    ('completed quarter of whole months', '2026-01-01', '2026-03-31', '2026-10-21', '{"basis": "months", "cur_from": "2026-01-01", "cur_to": "2026-03-31", "prev_from": "2025-10-01", "prev_to": "2025-12-31"}'),
    ('custom range ended', '2026-03-10', '2026-03-19', '2026-10-21', '{"basis": "days", "cur_from": "2026-03-10", "cur_to": "2026-03-19", "prev_from": "2026-02-28", "prev_to": "2026-03-09"}'),
    ('custom range in progress', '2026-10-10', '2026-10-31', '2026-10-21', '{"basis": "days_to_date", "cur_from": "2026-10-10", "cur_to": "2026-10-21", "prev_from": "2026-09-28", "prev_to": "2026-10-09"}'),
    ('one day', '2026-10-21', '2026-10-21', '2026-10-21', '{"basis": "days", "cur_from": "2026-10-21", "cur_to": "2026-10-21", "prev_from": "2026-10-20", "prev_to": "2026-10-20"}'),
    ('future month: no comparison', '2026-11-01', '2026-11-30', '2026-10-21', '{"basis": "future", "cur_from": null, "cur_to": null, "prev_from": null, "prev_to": null}'),
    ('future custom: no comparison', '2026-10-22', '2026-12-31', '2026-10-21', '{"basis": "future", "cur_from": null, "cur_to": null, "prev_from": null, "prev_to": null}')
  ) v(l, f, t, today, e),
  LATERAL (SELECT * FROM policy_commission_insights.comparison(v.f::date, v.t::date, v.today::date)) c;
SELECT test_assert(ci_get('march')->'comparison' = '{"basis": "months",
                     "current": {"from": "2026-03-01", "to": "2026-03-31", "policies": 11, "with_estimate_count": 5, "estimate_cents": 258300, "received_cents": 67975, "receipt_count": 3},
                     "previous": {"from": "2026-02-01", "to": "2026-02-28", "policies": 1, "with_estimate_count": 1, "estimate_cents": 57300, "received_cents": 1000, "receipt_count": 1}}'::jsonb,
                   'March compared with February: policies sold, est. commission on those sales and receipts');
SELECT test_assert(get_my_commission_breakdown('custom', DATE '2025-01-01', DATE '2025-01-31')->'comparison'
                     = '{"basis": "months", "current": {"from": "2025-01-01", "to": "2025-01-31", "policies": 0, "with_estimate_count": 0, "estimate_cents": 0,
                         "received_cents": 0, "receipt_count": 0}, "previous": {"from": "2024-12-01", "to": "2024-12-31", "policies": 0,
                         "with_estimate_count": 0, "estimate_cents": 0, "received_cents": 0, "receipt_count": 0}}'::jsonb,
                   'zero baseline: zeros, never a ratio');
SELECT test_assert(get_my_commission_breakdown('next_month')->'comparison' = 'null'::jsonb
                   AND get_my_commission_breakdown()#>>'{comparison,basis}' IN ('months_to_date', 'months')
                   AND get_my_commission_breakdown()#>>'{comparison,current,to}' = ci_today()::text,
                   'Next month has no comparison; This month compares month to date');
SELECT 'PASS comparison windows (month to date, completed months, custom, future, leap years, zero baseline)' AS result;

-- ── Months 10–12: next agency month, reconciled with the Scheduled list and an independent recomputation ────
SELECT ci_put('m1012', get_my_commission_breakdown()->'months_10_12');
RESET ROLE;
SELECT ci_put('x_m1012', (
  WITH i AS (
    SELECT i.*, (SELECT coalesce(sum(r.amount_cents), 0) FROM policy_commission_receipts r WHERE r.installment_id = i.id AND r.voided_at IS NULL) AS rec
      FROM policy_commission_installments i JOIN policy_commission_estimates e ON e.id = i.estimate_id
     WHERE e.credited_agent_id = test_id(11) AND e.status = 'active' AND i.kind <> 'advance'
       AND i.expected_on BETWEEN ci_next_month() AND (ci_next_month() + interval '1 month')::date - 1)
  SELECT jsonb_build_object('remaining', coalesce(sum(expected_cents - rec) FILTER (WHERE expected_cents > rec), 0),
    'payments', count(*) FILTER (WHERE expected_cents > rec), 'policies', count(DISTINCT policy_id) FILTER (WHERE expected_cents > rec)) FROM i));
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert((ci_get('m1012')->>'remaining_cents')::bigint = (ci_get('x_m1012')->>'remaining')::bigint
                   AND (ci_get('m1012')->>'payment_count')::int = (ci_get('x_m1012')->>'payments')::int
                   AND (ci_get('m1012')->>'policy_count')::int = (ci_get('x_m1012')->>'policies')::int
                   AND ci_get('m1012')->>'from' = ci_next_month()::text,
                   'Months 10–12 equals an independent recomputation for the next agency month');
SELECT test_assert((ci_get('m1012')->>'remaining_cents')::bigint >= 3775 + 4775 + 3600 AND (ci_get('m1012')->>'policy_count')::int >= 3,
                   'includes Alpha M10 net of its partial receipt, Kilo M11 despite an Advance overpayment, and Bravo M12');
SELECT ci_put('walk_m1012', ci_walk('SELECT get_my_commission_installments(''next_month'', NULL, NULL, ''range'', ''remaining'', ''later'', NULL, %s, %s)',
  'installment_id'));
SELECT test_assert((ci_get('walk_m1012')#>>'{totals,remaining_cents}')::bigint = (ci_get('m1012')->>'remaining_cents')::bigint
                   AND (ci_get('walk_m1012')->>'count')::int = (ci_get('m1012')->>'payment_count')::int,
                   'Months 10–12 → Scheduled (Next month, Remaining, Months 10–12): same payments and total');
SELECT test_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(get_my_commission_installments('next_month', NULL, NULL, 'range', 'remaining', 'later', NULL, 100, 0)->'rows') r
                     WHERE (r->>'policy_id')::uuid = ci_policy('Echo') OR r->>'kind' = 'advance'),
                   'held and Advance payments are not Months 10–12');
SELECT 'PASS Months 10–12' AS result;

-- ── Monthly goals: owner, organization and month isolation; set, edit, clear; validation; RLS ────────────────
SELECT test_assert(get_my_commission_goal(DATE '2026-03-01')->'target_cents' = 'null'::jsonb, 'no goal until one is set');
SELECT test_assert(set_my_commission_goal(DATE '2026-03-01', 50000)->>'target_cents' = '50000', 'set March');
SELECT test_assert(set_my_commission_goal(DATE '2026-04-01', 90000)->>'target_cents' = '90000', 'set April');
SELECT test_assert(set_my_commission_goal(DATE '2026-03-01', 60000)->>'target_cents' = '60000', 'edit March');
SELECT test_assert(get_my_commission_goal(DATE '2026-03-01')->>'target_cents' = '60000'
                   AND get_my_commission_goal(DATE '2026-04-01')->>'target_cents' = '90000'
                   AND (SELECT count(*) FROM policy_commission_goals) = 2, 'editing March changes March only (one row per month)');
-- Overachievement: progress is Received for that month over the target (the UI caps the bar, not the figure).
SELECT test_assert((get_my_commission_overview('custom', DATE '2026-03-01', DATE '2026-03-31')#>>'{summary,received_cents}')::bigint
                     > (get_my_commission_goal(DATE '2026-03-01')->>'target_cents')::bigint, 'March receipts exceed the March goal');
-- A receipt correction changes the month's Received everywhere.
SELECT ci_void(8212, 8201, ci_policy('Alpha'), 'Recorded on the wrong policy');
SELECT test_assert((get_my_commission_overview('custom', DATE '2026-03-01', DATE '2026-03-31')#>>'{summary,received_cents}')::bigint = 47975
                   AND (get_my_commission_breakdown('custom', DATE '2026-03-01', DATE '2026-03-31')#>>'{received,received_cents}')::bigint = 47975,
                   'a void lowers the month''s Received in the card and the breakdown alike');
SELECT test_assert(pc_reject(q, '22023') IS NOT NULL, 'goal input refused: ' || q)
  FROM unnest(ARRAY['SELECT get_my_commission_goal(''2026-03-15'')', 'SELECT get_my_commission_goal(NULL)',
    'SELECT set_my_commission_goal(''2026-03-02'', 100)', 'SELECT set_my_commission_goal(''2026-03-01'', 0)',
    'SELECT set_my_commission_goal(''2026-03-01'', -5)', 'SELECT set_my_commission_goal(''2026-03-01'', 100000001)',
    'SELECT set_my_commission_goal(''2026-03-01'', NULL)', 'SELECT set_my_commission_goal(''1999-12-01'', 100)',
    'SELECT clear_my_commission_goal(''2026-03-31'')']) q;
SELECT test_assert(get_my_commission_goal(DATE '2026-03-01')->>'target_cents' = '60000', 'refused input changed nothing');
-- Direct table access can do no more than the functions.
SELECT test_assert(pc_reject(format('INSERT INTO policy_commission_goals(organization_id, owner_id, month, target_cents) VALUES (%L, %L, ''2026-05-01'', 100)',
                     test_id(1), test_id(12)), '42501') LIKE '%row-level security%', 'cannot write a goal for someone else');
SELECT test_assert(pc_reject(format('INSERT INTO policy_commission_goals(organization_id, owner_id, month, target_cents) VALUES (%L, %L, ''2026-05-01'', 100)',
                     test_id(2), test_id(11)), '42501') LIKE '%row-level security%', 'cannot write a goal in another organization');
SELECT test_assert(pc_reject('UPDATE policy_commission_goals SET month = ''2026-06-01''', '42501') LIKE 'permission denied%',
                   'a goal cannot be moved to another month');
SELECT test_assert(pc_reject('UPDATE policy_commission_goals SET owner_id = test_id(12)', '42501') LIKE 'permission denied%',
                   'a goal cannot be given to someone else');
SELECT test_assert(pc_reject('INSERT INTO policy_commission_goals(organization_id, owner_id, month, target_cents) VALUES (test_id(1), test_id(11), ''2026-05-02'', 100)', '23514') IS NOT NULL
                   AND pc_reject('INSERT INTO policy_commission_goals(organization_id, owner_id, month, target_cents) VALUES (test_id(1), test_id(11), ''2026-05-01'', 0)', '23514') IS NOT NULL,
                   'server constraints: first of a month, positive whole cents');
SELECT pc_login(12);
SELECT test_assert(get_my_commission_goal(DATE '2026-03-01')->'target_cents' = 'null'::jsonb
                   AND (SELECT count(*) FROM policy_commission_goals) = 0, 'Ben does not see Ava''s goals');
SELECT test_assert(set_my_commission_goal(DATE '2026-03-01', 7000)->>'target_cents' = '7000', 'Ben sets his own March goal');
SELECT test_assert(clear_my_commission_goal(DATE '2026-04-01')->>'cleared' = 'false', 'Ben clearing April does not touch Ava''s April goal');
SELECT test_assert((SELECT count(*) FROM policy_commission_goals) = 1, 'Ben sees exactly his own goal');
WITH d AS (DELETE FROM policy_commission_goals RETURNING 1)
SELECT test_assert((SELECT count(*) FROM d) = 1, 'a direct delete reaches only the caller''s own rows');
SELECT set_my_commission_goal(DATE '2026-03-01', 7000);
DO $$
DECLARE n integer;
BEGIN
  FOREACH n IN ARRAY ARRAY[13, 14, 21, 31] LOOP
    PERFORM pc_login(n);
    PERFORM test_assert((SELECT count(*) FROM policy_commission_goals) = 0
                   AND get_my_commission_goal(DATE '2026-03-01')->'target_cents' = 'null'::jsonb,
                   'no one else reads Ava''s or Ben''s goals: profile ' || n);
  END LOOP;
END $$;
SELECT pc_login(11);
SELECT test_assert(get_my_commission_goal(DATE '2026-03-01')->>'target_cents' = '60000', 'Ava''s goal untouched by Ben');
SELECT test_assert(clear_my_commission_goal(DATE '2026-04-01')->>'cleared' = 'true', 'clear April');
SELECT test_assert(clear_my_commission_goal(DATE '2026-04-01')->>'cleared' = 'false', 'clearing again is a no-op');
SELECT test_assert(get_my_commission_goal(DATE '2026-04-01')->'target_cents' = 'null'::jsonb
                   AND get_my_commission_goal(DATE '2026-03-01')->>'target_cents' = '60000', 'clearing April leaves March');
SELECT 'PASS monthly goals' AS result;

-- ── Permissions, sign-in, time zone and validation ──────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO role_permissions(organization_id, role, permissions) VALUES (test_id(1), 'Agent',
  '{"c":[{"name":"View Own Commission Percentage","agent":false}]}');
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(pc_reject(q, '42501') = 'Commission access is unavailable', 'own toggle off refuses: ' || q)
  FROM unnest(ARRAY['SELECT get_my_commission_breakdown()', 'SELECT get_my_commission_policy_list()', 'SELECT get_my_commission_receipt_list()',
                    'SELECT get_my_commission_goal(''2026-03-01'')', 'SELECT set_my_commission_goal(''2026-03-01'', 100)',
                    'SELECT clear_my_commission_goal(''2026-03-01'')']) q;
SELECT test_assert((SELECT count(*) FROM policy_commission_goals) = 0, 'own toggle off: goal rows are not readable either');
RESET ROLE;
DELETE FROM role_permissions WHERE organization_id = test_id(1) AND role = 'Agent';
SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', false);
SET ROLE authenticated;
SELECT test_assert(pc_reject('SELECT get_my_commission_breakdown()', '42501') = 'Commission access is unavailable', 'no signed-in actor refuses');
RESET ROLE;
SET ROLE anon;
SELECT test_assert(pc_reject('SELECT get_my_commission_goal(''2026-03-01'')', '42501') LIKE 'permission denied%', 'anon cannot execute');
SELECT test_assert(pc_reject('SELECT count(*) FROM policy_commission_goals', '42501') LIKE 'permission denied%', 'anon cannot read goals');
RESET ROLE;
SET ROLE service_role;
SELECT test_assert(pc_reject('SELECT get_my_commission_breakdown()', '42501') LIKE 'permission denied%', 'service_role cannot execute');
SELECT test_assert(pc_reject('SELECT count(*) FROM policy_commission_goals', '42501') LIKE 'permission denied%', 'service_role cannot read goals');
RESET ROLE;
UPDATE company_settings SET timezone = NULL WHERE organization_id = test_id(1);
SELECT pc_login(11);
SET ROLE authenticated;
SELECT test_assert(pc_reject('SELECT get_my_commission_breakdown()', '55000') = 'The agency time zone is not set', 'unset agency time zone fails closed');
RESET ROLE;
UPDATE company_settings SET timezone = 'America/Los_Angeles' WHERE organization_id = test_id(1);
SET ROLE authenticated;
SELECT test_assert(pc_reject(q, '22023') IS NOT NULL, 'invalid input refused: ' || q)
  FROM unnest(ARRAY[
    'SELECT get_my_commission_breakdown(''all'')', 'SELECT get_my_commission_breakdown(''weekly'')',
    'SELECT get_my_commission_breakdown(''custom'', ''2026-01-01'', ''2028-01-02'')',
    'SELECT get_my_commission_policy_list(''paid'')', 'SELECT get_my_commission_policy_list(''all'', ''Synthetic Life'', true)',
    'SELECT get_my_commission_policy_list(''all'', NULL, NULL)', 'SELECT get_my_commission_policy_list(''all'', NULL, false, ''whole life'')',
    'SELECT get_my_commission_policy_list(''all'', NULL, false, NULL, ''custom'', ''2026-03-10'', ''2026-03-01'')',
    'SELECT get_my_commission_policy_list(''all'', NULL, false, NULL, ''all'', NULL, NULL, 0, 0)',
    'SELECT get_my_commission_policy_list(''all'', NULL, false, NULL, ''all'', NULL, NULL, 10, -1)',
    'SELECT get_my_commission_receipt_list(''this_month'', NULL, NULL, NULL)',
    'SELECT get_my_commission_receipt_list(''this_month'', NULL, NULL, false, ''Synthetic Life'', true)',
    'SELECT get_my_commission_receipt_list(''this_month'', NULL, NULL, false, NULL, false, 101, 0)']) q;
SELECT 'PASS permissions, sign-in, time zone and validation' AS result;

-- ── Reads never write ───────────────────────────────────────────────────────────────────────────────────────
RESET ROLE;
BEGIN;
SELECT pc_login(11);
SET LOCAL ROLE authenticated;
SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) AS before_writes FROM pg_stat_xact_user_tables \gset
SELECT get_my_commission_breakdown(), get_my_commission_policy_list('all', NULL, false, NULL, 'this_year', NULL, NULL, 100, 0),
       get_my_commission_receipt_list('all', NULL, NULL, true, NULL, false, 100, 0), get_my_commission_goal(DATE '2026-07-01')
  \gset ignored_
SELECT test_assert(txid_current_if_assigned() IS NULL, 'the four reads assign no transaction id');
SELECT test_assert((SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_xact_user_tables) = :before_writes,
                   'the four reads insert, update or delete nothing (opening a month creates no goal)');
COMMIT;
SELECT test_assert((SELECT count(*) FROM policy_commission_goals WHERE month = DATE '2026-07-01') = 0, 'no goal row was created by reading');

-- ── Catalog: invoker, volatility, pinned search_path, authenticated-only execution; table grants and RLS ──────
SELECT test_assert(bool_and(NOT p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                            AND p.provolatile = CASE WHEN p.proname IN ('set_my_commission_goal', 'clear_my_commission_goal') THEN 'v'
                                                     WHEN n.nspname = 'policy_commission_insights' THEN 'i' ELSE 's' END
                            AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
                            AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('agentflow_policy_commission_writer', p.oid, 'EXECUTE')
                            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)),
                   'every new function: SECURITY INVOKER, owner postgres, pinned search_path, authenticated only')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'policy_commission_insights'
    OR p.oid IN ('public.get_my_commission_breakdown(text,date,date)'::regprocedure,
                 'public.get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer)'::regprocedure,
                 'public.get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer)'::regprocedure,
                 'public.get_my_commission_goal(date)'::regprocedure, 'public.set_my_commission_goal(date,bigint)'::regprocedure,
                 'public.clear_my_commission_goal(date)'::regprocedure);
SELECT test_assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'policy_commission_insights') = 6,
                   'six shared helpers');
SELECT test_assert((SELECT nspacl::text FROM pg_namespace WHERE nspname = 'policy_commission_insights') = '{postgres=UC/postgres,authenticated=U/postgres}',
                   'insights schema: USAGE for authenticated only');
SELECT test_assert((SELECT relrowsecurity AND pg_get_userbyid(relowner) = 'postgres' FROM pg_class WHERE oid = 'public.policy_commission_goals'::regclass)
                   AND (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) FROM pg_class c, aclexplode(c.relacl) a
                         WHERE c.oid = 'public.policy_commission_goals'::regclass AND a.grantee = 'authenticated'::regrole) = ARRAY['DELETE', 'INSERT', 'SELECT']
                   AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.policy_commission_goals'::regclass
                                    AND a.grantee NOT IN ('authenticated'::regrole, c.relowner))
                   AND (SELECT string_agg(attname || '=' || attacl::text, ',' ORDER BY attname) FROM pg_attribute
                         WHERE attrelid = 'public.policy_commission_goals'::regclass AND attacl IS NOT NULL)
                       = 'target_cents={authenticated=w/postgres},updated_at={authenticated=w/postgres}'
                   AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.policy_commission_goals'::regclass) = 1
                   AND (SELECT polcmd = '*' AND polroles = ARRAY['authenticated'::regrole::oid] FROM pg_policy
                         WHERE polrelid = 'public.policy_commission_goals'::regclass),
                   'goals table: RLS on, owner postgres, SELECT/INSERT/DELETE plus UPDATE of the target only, one owner policy for authenticated');

SELECT 'PASS commissions insights' AS result;
