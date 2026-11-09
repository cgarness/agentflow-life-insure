-- =====================================================================================================
-- Reports v3 sale facts and original-seller production (plan §2.6; D2 §3.2 and §9). Disposable synthetic
-- database only, through scripts/run_reports_v3_tests.sh. Expected values are computed by hand from the
-- fixture table at the top of reports_v3_fixtures.sql.
-- =====================================================================================================

-- One sale as 'monthly|source|state|revision' (unbounded window, no as_of).
CREATE FUNCTION rt.sf(p_win text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|', coalesce(s.monthly_premium::text, 'null'), s.premium_source, s.premium_state, s.correction_revision)
    FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s WHERE s.win_id = rt.v3(p_win);
$$;
-- Win names returned by a sale-facts call, sorted.
CREATE FUNCTION rt.sf_wins(p_org text, p_agents uuid[], p_from date, p_until date) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(i.name, ',' ORDER BY i.name COLLATE "C")
    FROM private.report_v3_sale_facts(rt.v3(p_org), p_agents, p_from, p_until) s JOIN rt.v3_ids i ON i.id = s.win_id;
$$;
-- October 2026 production for O1 at the suite's as_of (before W16 was recorded).
CREATE FUNCTION rt.prod(p_agents uuid[] DEFAULT NULL, p_as_of timestamptz DEFAULT '2026-11-15 00:00+00') RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT private.report_v3_production(rt.v3('O1'), p_agents, '2026-10-01', '2026-11-01', p_as_of);
$$;
-- The four production envelopes for one counts object, as 'id:status|reason|value' text.
CREATE FUNCTION rt.kpis(p_counts jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(format('%s:%s', e ->> 'id', rt.svr(e)), ' ' ORDER BY o)
    FROM jsonb_array_elements(private.report_v3_production_kpis(p_counts)) WITH ORDINALITY x(e, o);
$$;
CREATE FUNCTION rt.counts(p int, b int, k int, m int, i int, a numeric) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('policy_count', p, 'buyer_count', b, 'known_count', k, 'missing_count', m,
                            'invalid_count', i, 'annual_premium', a);
$$;

-- -----------------------------------------------------------------------------------------------------
-- 1. Contract: signatures, exact columns, bounds, exclusions, timestamps, isolation.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('sale facts columns (plan §2.6, in order)',
  pg_get_function_result('private.report_v3_sale_facts(uuid,uuid[],date,date)'::regprocedure),
  'TABLE(win_id uuid, policy_id uuid, buyer_id uuid, seller_id uuid, sold_date date, created_at timestamp with time zone, '
  || 'recorded_at timestamp with time zone, event_time_source text, monthly_premium numeric, premium_source text, '
  || 'premium_state text, correction_revision integer)');
SELECT rt.eq('sale premium stub columns', pg_get_function_result('private.report_v3_sale_premium(public.wins,numeric)'::regprocedure),
  'TABLE(monthly numeric, premium_source text, premium_state text, revision integer)');
SELECT rt.eq('NULL bounds: every dated, identified sale',
  rt.sf_wins('O1', NULL, NULL, NULL), 'W1,W10,W13,W14,W15,W16,W17,W2,W3,W4,W5,W6,W7,W8,W9');
SELECT rt.eq('a 397-day window is allowed', rt.sf_wins('O1', NULL, '2025-10-01', '2026-11-02'), rt.sf_wins('O1', NULL, NULL, NULL));
SELECT rt.eq('half-open window excludes its end date', rt.sf_wins('O1', NULL, '2026-10-01', '2026-10-31'),
  'W1,W10,W13,W16,W17,W2,W3,W4,W5,W6,W7,W8,W9');
SELECT rt.eq('one-day window', rt.sf_wins('O1', NULL, '2026-10-31', '2026-11-01'), 'W14');
SELECT rt.eq('no policy identity and no Sold Date are excluded',
  (SELECT count(*) FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s
    WHERE s.win_id IN (rt.v3('W11'), rt.v3('W12'))), 0::bigint);
SELECT rt.eq('recorded_at falls back to created_at',
  (SELECT s.recorded_at FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s WHERE s.win_id = rt.v3('W13')),
  '2026-10-09 15:00+00'::timestamptz);
SELECT rt.eq('event time source carried', (SELECT string_agg(DISTINCT s.event_time_source, ',')
  FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s), 'event');
SELECT rt.eq('organization isolation (O2 sees only its own sale)', rt.sf_wins('O2', NULL, NULL, NULL), 'WB1');
SELECT rt.eq('organization isolation (O1 never sees O2)', (SELECT count(*) FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s
  WHERE s.win_id = rt.v3('WB1')), 0::bigint);
SELECT rt.eq('unknown organization returns nothing',
  (SELECT count(*) FROM private.report_v3_sale_facts('c3ffffff-0000-0000-0000-000000000000', NULL, NULL, NULL)), 0::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 2. Credit: the original seller keeps credit; an agent filter never includes unattributed sales.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('original seller after the client was reassigned (C1 now A3)',
  (SELECT s.seller_id FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s WHERE s.win_id = rt.v3('W1')), rt.v3('A1'));
SELECT rt.eq('buyer is the sale contact', (SELECT s.buyer_id FROM private.report_v3_sale_facts(rt.v3('O1'), NULL, NULL, NULL) s
  WHERE s.win_id = rt.v3('W17')), rt.v3('C1'));
SELECT rt.eq('agent filter', rt.sf_wins('O1', ARRAY[rt.v3('A3')], NULL, NULL), 'W6,W7,W8');
SELECT rt.eq('agent filter never includes the unattributed sale',
  (SELECT count(*) FROM private.report_v3_sale_facts(rt.v3('O1'), ARRAY[rt.v3('A1'), rt.v3('A2'), rt.v3('A3')], NULL, NULL) s
    WHERE s.seller_id IS NULL), 0::bigint);
SELECT rt.eq('an empty agent list returns nothing',
  (SELECT count(*) FROM private.report_v3_sale_facts(rt.v3('O1'), '{}'::uuid[], NULL, NULL)), 0::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 3. Premium: the source/state matrix, and the value always equals the shared choke point.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('W1 snapshot', rt.sf('W1'), '100.00|sale_snapshot|known|0');
SELECT rt.eq('W2 snapshot $0 is known', rt.sf('W2'), '0|sale_snapshot|known|0');
SELECT rt.eq('W3 snapshot NULL is missing', rt.sf('W3'), 'null|sale_snapshot|missing|0');
SELECT rt.eq('W4 snapshot negative is invalid', rt.sf('W4'), 'null|sale_snapshot|invalid|0');
SELECT rt.eq('W5 legacy sale event', rt.sf('W5'), '50.25|legacy_sale_event|known|0');
SELECT rt.eq('W6 legacy record fallback', rt.sf('W6'), '80.50|legacy_record_fallback|known|0');
SELECT rt.eq('W7 additional identity never borrows', rt.sf('W7'), 'null|none|missing|0');
SELECT rt.eq('W8 additional key never borrows', rt.sf('W8'), 'null|none|missing|0');
SELECT rt.eq('W9 unattributed snapshot', rt.sf('W9'), '40.00|sale_snapshot|known|0');
SELECT rt.eq('W10 deleted client still has its sale value', rt.sf('W10'), '25.00|sale_snapshot|known|0');
SELECT rt.eq('a negative legacy amount is invalid',
  (SELECT concat_ws('|', coalesce(e.monthly::text, 'null'), e.premium_source, e.premium_state)
     FROM public.wins w0,
          LATERAL private.report_v3_sale_premium(jsonb_populate_record(w0, '{"premium_snapshot":false,"premium_amount":-5}'), 0) e
    WHERE w0.id = rt.v3('W5')),
  'null|legacy_sale_event|invalid');
SELECT rt.eq('a negative fallback premium is invalid',
  (SELECT concat_ws('|', coalesce(e.monthly::text, 'null'), e.premium_source, e.premium_state)
     FROM public.wins w0, LATERAL private.report_v3_sale_premium(w0, -10) e WHERE w0.id = rt.v3('W6')),
  'null|legacy_record_fallback|invalid');
SELECT rt.eq('value equals performance_sale_monthly for every win in the database',
  (SELECT count(*) FROM public.wins w
     LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    CROSS JOIN LATERAL private.report_v3_sale_premium(w, c.premium) e
    WHERE e.monthly IS DISTINCT FROM private.performance_sale_monthly(w, c.premium)), 0::bigint);
SELECT rt.eq('states are only known, missing or invalid (no ambiguous zero)',
  (SELECT count(*) FROM public.wins w
     LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    CROSS JOIN LATERAL private.report_v3_sale_premium(w, c.premium) e
    WHERE e.premium_state NOT IN ('known', 'missing', 'invalid') OR e.revision <> 0), 0::bigint);

-- -----------------------------------------------------------------------------------------------------
-- 4. Production totals, by_agent and production_by_date (agency scope, October, as_of 2026-11-15).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('agency totals', rt.prod() -> 'totals', '{
  "policy_count":13, "buyer_count":12, "known_count":9, "missing_count":3, "invalid_count":1,
  "monthly_premium":338.09, "annual_premium":4057.08,
  "premium_sources":{"sale_snapshot":9,"legacy_sale_event":1,"legacy_record_fallback":1,"correction":0,"none":2},
  "corrections_applied":0, "client_record_deleted":1, "unattributed_annual_premium":480.00, "stored_without_sale":1,
  "quality":{"undated_policies":1,"missing_policy_identity":1,"unattributed_policies":1}}'::jsonb);
SELECT rt.eq('annual premium is exact cents', rt.prod() #>> '{totals,annual_premium}', '4057.08');
SELECT rt.eq('agency by_agent (original sellers, ordered by id)', rt.prod() -> 'by_agent', jsonb_build_array(
  jsonb_build_object('agent_id', rt.v3('A1'), 'policy_count', 4, 'buyer_count', 4, 'known_count', 4, 'missing_count', 0,
                     'invalid_count', 0, 'annual_premium', 2103.00),
  jsonb_build_object('agent_id', rt.v3('A2'), 'policy_count', 5, 'buyer_count', 5, 'known_count', 3, 'missing_count', 1,
                     'invalid_count', 1, 'annual_premium', 508.08),
  jsonb_build_object('agent_id', rt.v3('A3'), 'policy_count', 3, 'buyer_count', 3, 'known_count', 1, 'missing_count', 2,
                     'invalid_count', 0, 'annual_premium', 966.00)));
SELECT rt.eq('production_by_date is daily and zero-filled', jsonb_array_length(rt.prod() -> 'production_by_date'), 31);
SELECT rt.eq('production_by_date rows', (SELECT jsonb_agg(d ORDER BY d ->> 'date') FROM jsonb_array_elements(rt.prod() -> 'production_by_date') d
  WHERE d ->> 'date' IN ('2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-31')), '[
  {"date":"2026-10-01","policies_sold":0,"annual_premium":0,"premium_known":0,"premium_missing":0,"premium_invalid":0},
  {"date":"2026-10-03","policies_sold":2,"annual_premium":0,"premium_known":1,"premium_missing":1,"premium_invalid":0},
  {"date":"2026-10-04","policies_sold":1,"annual_premium":0,"premium_known":0,"premium_missing":0,"premium_invalid":1},
  {"date":"2026-10-05","policies_sold":2,"annual_premium":1569.00,"premium_known":2,"premium_missing":0,"premium_invalid":0},
  {"date":"2026-10-31","policies_sold":1,"annual_premium":240.00,"premium_known":1,"premium_missing":0,"premium_invalid":0}]'::jsonb);
SELECT rt.eq('Σ production_by_date = totals',
  (SELECT format('%s|%s|%s|%s|%s', sum((d ->> 'policies_sold')::int), sum((d ->> 'annual_premium')::numeric),
                 sum((d ->> 'premium_known')::int), sum((d ->> 'premium_missing')::int), sum((d ->> 'premium_invalid')::int))
     FROM jsonb_array_elements(rt.prod() -> 'production_by_date') d), '13|4057.08|9|3|1');
SELECT rt.eq('Σ by_agent plus the unattributed sale = agency totals (KPIs 1, 2, 4)',
  (SELECT format('%s|%s|%s', sum((a ->> 'policy_count')::int) + 1, sum((a ->> 'annual_premium')::numeric) + 480.00,
                 sum((a ->> 'known_count')::int) + 1)
     FROM jsonb_array_elements(rt.prod() -> 'by_agent') a), '13|4057.08|9');
SELECT rt.eq('the sale recorded after as_of is excluded until it is recorded',
  format('%s|%s', rt.prod() #>> '{totals,policy_count}', rt.prod(NULL, '2026-11-25 00:00+00') #>> '{totals,policy_count}'), '13|14');

-- Personal and team scope (an agent list): no unattributed sale and no agency-only disclosure (plan §2.9).
SELECT rt.eq('scoped totals', rt.prod(ARRAY[rt.v3('A1'), rt.v3('A2'), rt.v3('A3')]) -> 'totals', '{
  "policy_count":12, "buyer_count":11, "known_count":8, "missing_count":3, "invalid_count":1,
  "monthly_premium":298.09, "annual_premium":3577.08,
  "premium_sources":{"sale_snapshot":8,"legacy_sale_event":1,"legacy_record_fallback":1,"correction":0,"none":2},
  "corrections_applied":0, "client_record_deleted":1, "unattributed_annual_premium":null, "stored_without_sale":null,
  "quality":{"undated_policies":1,"missing_policy_identity":null,"unattributed_policies":null}}'::jsonb);
SELECT rt.eq('Σ scoped by_agent = scoped totals except deduplicated buyers',
  (SELECT format('%s|%s|%s', sum((a ->> 'policy_count')::int), sum((a ->> 'annual_premium')::numeric), sum((a ->> 'buyer_count')::int))
     FROM jsonb_array_elements(rt.prod(ARRAY[rt.v3('A1'), rt.v3('A2'), rt.v3('A3')]) -> 'by_agent') a), '12|3577.08|12');
SELECT rt.eq('one agent', (rt.prod(ARRAY[rt.v3('A2')]) #> '{totals}') - 'premium_sources' - 'quality', '{
  "policy_count":5, "buyer_count":5, "known_count":3, "missing_count":1, "invalid_count":1, "monthly_premium":42.34,
  "annual_premium":508.08, "corrections_applied":0, "client_record_deleted":0, "unattributed_annual_premium":null,
  "stored_without_sale":null}'::jsonb);
SELECT rt.eq('O2 production is isolated', private.report_v3_production(rt.v3('O2'), NULL, '2026-10-01', '2026-11-01',
  '2026-11-15 00:00+00') #> '{totals,annual_premium}', '6000.00'::jsonb);
SELECT rt.eq('stored policy identities with no sale (agency disclosure)', private.report_v3_stored_without_sale(rt.v3('O1')), 1::bigint);
SELECT rt.eq('an empty window', rt.kpis((private.report_v3_production(rt.v3('O1'), NULL, '2026-09-01', '2026-09-02',
  '2026-11-15 00:00+00')) -> 'totals'),
  '1:available|-|0 2:available|-|0 3:available|-|0 4:unavailable|no_policies_sold|null');
SELECT rt.expect_sql_failure($$SELECT private.report_v3_production(rt.v3('O1'), NULL, NULL, '2026-11-01', now())$$,
  'reports v3 production: the organization, both bounds and as_of are required');

-- -----------------------------------------------------------------------------------------------------
-- 5. KPI 1–4 envelopes (D2 §3.2): totals with detail, by_agent rows without, exact values.
-- -----------------------------------------------------------------------------------------------------
SELECT rt.eq('agency KPIs 1-4', rt.kpis(rt.prod() -> 'totals'),
  '1:partial|premium_invalid|4057.08 2:available|-|13 3:available|-|12 4:partial|premium_invalid|450.786667');
SELECT rt.eq('KPI 1 coverage', private.report_v3_production_kpis(rt.prod() -> 'totals') -> 0 -> 'coverage',
  '{"eligible":13,"assessable":9,"unassessable":4,"reasons":{"premium_invalid":1,"premium_missing":3}}'::jsonb);
SELECT rt.eq('KPI 4 exact numerator and denominator, value at 6 dp (a repeating quotient, not cents)',
  (private.report_v3_production_kpis(rt.prod() -> 'totals') -> 3) - 'id' - 'status' - 'reason' - 'coverage' - 'maturity' - 'detail',
  '{"value":450.786667,"numerator":4057.08,"denominator":9}'::jsonb);
SELECT rt.eq('KPI 1 detail names', private.report_v3_production_kpis(rt.prod() -> 'totals') -> 0 -> 'detail', '{
  "premium":{"known":9,"missing":3,"invalid":1,"legacy_record_fallback":1}, "unattributed_annual_premium":480.00,
  "premium_sources":{"sale_snapshot":9,"legacy_sale_event":1,"legacy_record_fallback":1,"correction":0,"none":2},
  "corrections_applied":0}'::jsonb);
SELECT rt.eq('KPI 2 detail names', private.report_v3_production_kpis(rt.prod() -> 'totals') -> 1 -> 'detail', '{
  "quality":{"undated_policies":1,"missing_policy_identity":1,"unattributed_policies":1}, "stored_without_sale":1}'::jsonb);
SELECT rt.eq('KPI 3 detail names', private.report_v3_production_kpis(rt.prod() -> 'totals') -> 2 -> 'detail',
  '{"client_record_deleted":1}'::jsonb);
SELECT rt.eq('KPI 4 detail names', private.report_v3_production_kpis(rt.prod() -> 'totals') -> 3 -> 'detail',
  '{"premium":{"known":9,"missing":3,"invalid":1,"legacy_record_fallback":1}}'::jsonb);
SELECT rt.eq('scoped KPI 1 detail hides agency-only values',
  private.report_v3_production_kpis(rt.prod(ARRAY[rt.v3('A1')]) -> 'totals') #> '{0,detail,unattributed_annual_premium}', 'null'::jsonb);
SELECT rt.eq('by_agent envelopes', (SELECT string_agg(rt.kpis(a), ' / ' ORDER BY a ->> 'agent_id')
     FROM jsonb_array_elements(rt.prod() -> 'by_agent') a),
  '1:available|-|2103 2:available|-|4 3:available|-|4 4:available|-|525.75 / '
  || '1:partial|premium_invalid|508.08 2:available|-|5 3:available|-|5 4:partial|premium_invalid|169.36 / '
  || '1:partial|premium_missing|966 2:available|-|3 3:available|-|3 4:partial|premium_missing|966');
SELECT rt.eq('by_agent envelopes carry no detail and no maturity',
  (SELECT count(*) FROM jsonb_array_elements(rt.prod() -> 'by_agent') a,
          jsonb_array_elements(private.report_v3_production_kpis(a)) e
    WHERE e -> 'detail' <> 'null'::jsonb OR e -> 'maturity' <> 'null'::jsonb), 0::bigint);
SELECT rt.eq('every reason is registered', (SELECT count(*) FROM jsonb_array_elements(rt.prod() -> 'by_agent') a,
  jsonb_array_elements(private.report_v3_production_kpis(a)) e
  WHERE e ->> 'reason' IS NOT NULL AND NOT (e ->> 'reason') = ANY (private.report_v3_reason_codes())), 0::bigint);

-- Status and reason matrix (D2 §3.2; synthetic counts: P, buyers, K, M, I, A).
SELECT rt.eq('empty', rt.kpis(rt.counts(0, 0, 0, 0, 0, 0)),
  '1:available|-|0 2:available|-|0 3:available|-|0 4:unavailable|no_policies_sold|null');
SELECT rt.eq('all known', rt.kpis(rt.counts(2, 2, 2, 0, 0, 240)),
  '1:available|-|240 2:available|-|2 3:available|-|2 4:available|-|120');
SELECT rt.eq('some missing only', rt.kpis(rt.counts(3, 3, 2, 1, 0, 240)),
  '1:partial|premium_missing|240 2:available|-|3 3:available|-|3 4:partial|premium_missing|120');
SELECT rt.eq('invalid and missing', rt.kpis(rt.counts(4, 4, 2, 1, 1, 240)),
  '1:partial|premium_invalid|240 2:available|-|4 3:available|-|4 4:partial|premium_invalid|120');
SELECT rt.eq('invalid and missing: both counts in coverage',
  private.report_v3_production_kpis(rt.counts(4, 4, 2, 1, 1, 240)) #> '{0,coverage,reasons}',
  '{"premium_invalid":1,"premium_missing":1}'::jsonb);
SELECT rt.eq('invalid only', rt.kpis(rt.counts(3, 3, 2, 0, 1, 240)),
  '1:partial|premium_invalid|240 2:available|-|3 3:available|-|3 4:partial|premium_invalid|120');
SELECT rt.eq('none usable, all missing', rt.kpis(rt.counts(2, 2, 0, 2, 0, 0)),
  '1:unavailable|premium_not_entered|null 2:available|-|2 3:available|-|2 4:unavailable|premium_not_entered|null');
SELECT rt.eq('none usable, all invalid', rt.kpis(rt.counts(2, 2, 0, 0, 2, 0)),
  '1:unavailable|premium_invalid|null 2:available|-|2 3:available|-|2 4:unavailable|premium_invalid|null');
SELECT rt.eq('none usable, invalid and missing', rt.kpis(rt.counts(3, 3, 0, 2, 1, 0)),
  '1:unavailable|premium_invalid|null 2:available|-|3 3:available|-|3 4:unavailable|premium_invalid|null');
SELECT rt.eq('a known $0 counts in KPI 4''s denominator', rt.kpis(rt.counts(2, 2, 2, 0, 0, 0)),
  '1:available|-|0 2:available|-|2 3:available|-|2 4:available|-|0');
SELECT rt.eq('KPI 4 denominator for a known $0', private.report_v3_production_kpis(rt.counts(2, 2, 2, 0, 0, 0)) #> '{3,denominator}',
  '2'::jsonb);
SELECT rt.expect_sql_failure($$SELECT private.report_v3_production_kpis(rt.counts(3, 3, 1, 1, 0, 120))$$,
  'reports v3 production: inconsistent KPI 1-4 counts');

-- -----------------------------------------------------------------------------------------------------
-- 6. Created sealed (class C): helper shape and no client privilege; production reads only through the
--    builders (a sale-facts KPI never bypasses report_v3_evaluate).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.assert_v3_helper_shape();
SELECT rt.assert_sealed_v3(true, false);
SELECT rt.eq('sale-fact helpers and volatility',
  (SELECT string_agg(format('%s:%s', p.oid::regprocedure, p.provolatile), ' ' ORDER BY p.oid::regprocedure::text COLLATE "C")
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('report_v3_sale_premium', 'report_v3_sale_facts', 'report_v3_stored_without_sale',
                                                  'report_v3_production', 'report_v3_production_kpis')),
  'private.report_v3_production(uuid,uuid[],date,date,timestamp with time zone):s private.report_v3_production_kpis(jsonb):i '
  || 'private.report_v3_sale_facts(uuid,uuid[],date,date):s private.report_v3_sale_premium(wins,numeric):s '
  || 'private.report_v3_stored_without_sale(uuid):s');

-- -----------------------------------------------------------------------------------------------------
-- 7. Negative controls: each guard, edited away, makes a suite assertion fail (then is rolled back).
-- -----------------------------------------------------------------------------------------------------
SELECT rt.reject_mutation('private.report_v3_production(uuid,uuid[],date,date,timestamp with time zone)',
  '''unattributed_annual_premium'', CASE WHEN v_agency THEN t.unattributed_annual_premium END',
  '''unattributed_annual_premium'', t.unattributed_annual_premium',
  $probe$SELECT rt.eq('mutated agency-only disclosure', rt.prod(ARRAY[rt.v3('A1')]) #> '{totals,unattributed_annual_premium}',
    'null'::jsonb)$probe$,
  'mutated agency-only disclosure FAIL');
SELECT rt.reject_mutation('private.report_v3_production(uuid,uuid[],date,date,timestamp with time zone)',
  'WHERE s.recorded_at <= p_as_of', 'WHERE true',
  $probe$SELECT rt.eq('mutated as_of', rt.prod() #>> '{totals,policy_count}', '13')$probe$,
  'mutated as_of FAIL');
SELECT rt.reject_mutation('private.report_v3_sale_premium(public.wins,numeric)',
  'CASE WHEN p_win.premium_snapshot THEN ''sale_snapshot''', 'CASE WHEN false THEN ''sale_snapshot''',
  $probe$SELECT rt.eq('mutated snapshot source', rt.sf('W2'), '0|sale_snapshot|known|0')$probe$,
  'mutated snapshot source FAIL');
