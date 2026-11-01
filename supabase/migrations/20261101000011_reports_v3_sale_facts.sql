-- =====================================================================================================
-- Reports V2, PKG-A file 2 of 8: shared sale facts and original-seller production (plan §2.6; D2 §3.2).
--
-- PLACEHOLDER VERSION. Renumbered above the then-current production head, order kept, in a
-- filename-only commit before the PKG-A backend merge. Branch work only: not applied to production.
--
-- Privilege class C (plan §2.8): private helpers only, each created sealed. No privilege is added and no
-- data is written. It runs after …10 (it builds envelopes only through the foundation builders).
--
--   report_v3_sale_premium        PKG-B stub. The monthly amount comes ONLY from the shared choke point
--                                 private.performance_sale_monthly, so v3 cannot disagree with the
--                                 Leaderboard; source and state are classified from the wins columns.
--   report_v3_sale_facts          one row per dated, identified sale (main plan §2.6 columns, in order);
--                                 NULL bounds are unbounded; callers filter recorded_at <= as_of.
--   report_v3_stored_without_sale policy identities with no sale event (agency disclosure; credits no one).
--   report_v3_production          totals, by_agent and production_by_date for KPIs 1–4 at an as_of.
--   report_v3_production_kpis     the KPI 1–4 envelopes for one counts object (totals or a by_agent row).
-- =====================================================================================================
SET LOCAL lock_timeout = '2s';

DO $preflight$
DECLARE c text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'private' AND p.proname IN ('report_v3_sale_premium', 'report_v3_sale_facts',
                    'report_v3_stored_without_sale', 'report_v3_production', 'report_v3_production_kpis')) THEN
    RAISE EXCEPTION 'Reports v3 sale facts: refusing replay; sale-fact helpers already exist';
  END IF;
  IF to_regprocedure('private.report_v3_total(integer,numeric,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_ratio(integer,numeric,numeric,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('private.report_v3_reason_codes()') IS NULL THEN
    RAISE EXCEPTION 'Reports v3 sale facts: the foundation (…10) must be applied first';
  END IF;
  -- The shared premium choke point, exactly as live (plan D2 §8: prosrc pins; functiondef preimage 51e06b46…).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('private.performance_monthly(boolean,numeric,numeric)')
                   AND md5(prosrc) = '7e7063317a34f37d90faf14914b98827' AND provolatile = 'i' AND NOT prosecdef
                   AND proowner = 'postgres'::regrole AND proconfig = ARRAY['search_path=pg_catalog, pg_temp'])
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('private.performance_sale_monthly(public.wins,numeric)')
                   AND md5(prosrc) = 'deb0d3330a432cd4324ea422856d67a0'
                   AND md5(pg_get_functiondef(oid)) = '51e06b46a13c3a8eec4d672bec158376' AND provolatile = 's' AND NOT prosecdef
                   AND proowner = 'postgres'::regrole AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
    RAISE EXCEPTION 'Reports v3 sale facts: premium choke point drift';
  END IF;
  FOR c IN SELECT * FROM unnest(ARRAY[
      'public.wins.id', 'public.wins.organization_id', 'public.wins.policy_id', 'public.wins.contact_id',
      'public.wins.agent_id', 'public.wins.sold_date', 'public.wins.created_at', 'public.wins.recorded_at',
      'public.wins.event_time_source', 'public.wins.premium_snapshot', 'public.wins.premium_amount',
      'public.wins.idempotency_key', 'public.clients.id', 'public.clients.organization_id', 'public.clients.premium',
      'private.policy_identities.organization_id', 'private.policy_identities.policy_id',
      'private.policy_identities.source']) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = split_part(c, '.', 1) AND table_name = split_part(c, '.', 2)
                      AND column_name = split_part(c, '.', 3)) THEN
      RAISE EXCEPTION 'Reports v3 sale facts: dependency column missing: %', c;
    END IF;
  END LOOP;
END $preflight$;

-- PKG-B replaces this stub (…21) with the audited effective-premium reader, under a preimage guard.
CREATE FUNCTION private.report_v3_sale_premium(p_win public.wins, p_client numeric)
RETURNS TABLE (monthly numeric, premium_source text, premium_state text, revision integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.v,
         CASE WHEN p_win.premium_snapshot THEN 'sale_snapshot'
              WHEN nullif(p_win.premium_amount, 0) IS NOT NULL THEN 'legacy_sale_event'
              WHEN f.fb IS NOT NULL THEN 'legacy_record_fallback'
              ELSE 'none' END,
         CASE WHEN m.v IS NOT NULL THEN 'known'
              WHEN (CASE WHEN p_win.premium_snapshot THEN p_win.premium_amount
                         ELSE coalesce(nullif(p_win.premium_amount, 0), f.fb) END) < 0 THEN 'invalid'
              ELSE 'missing' END,
         0
    FROM (SELECT private.performance_sale_monthly(p_win, p_client) AS v) m
   CROSS JOIN LATERAL (
     -- Additional-policy legacy sales never borrow a client's premium (the same rule as the choke point).
     SELECT CASE WHEN p_win.idempotency_key ~ ':policy:[0-9]+$'
                   OR EXISTS (SELECT 1 FROM private.policy_identities i
                               WHERE i.organization_id = p_win.organization_id AND i.policy_id = p_win.policy_id
                                 AND i.source = 'additional')
                 THEN NULL ELSE nullif(p_client, 0) END AS fb) f;
$$;

CREATE FUNCTION private.report_v3_sale_facts(p_org uuid, p_agents uuid[], p_sold_from date, p_sold_until date)
RETURNS TABLE (win_id uuid, policy_id uuid, buyer_id uuid, seller_id uuid, sold_date date, created_at timestamptz,
               recorded_at timestamptz, event_time_source text, monthly_premium numeric, premium_source text,
               premium_state text, correction_revision integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT w.id, w.policy_id, w.contact_id, w.agent_id, w.sold_date, w.created_at,
         coalesce(w.recorded_at, w.created_at), w.event_time_source,
         e.monthly, e.premium_source, e.premium_state, e.revision
    FROM public.wins w
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
   CROSS JOIN LATERAL private.report_v3_sale_premium(w, c.premium) e
   WHERE w.organization_id = p_org AND w.policy_id IS NOT NULL AND w.sold_date IS NOT NULL
     AND (p_sold_from IS NULL OR w.sold_date >= p_sold_from)
     AND (p_sold_until IS NULL OR w.sold_date < p_sold_until)
     AND (p_agents IS NULL OR w.agent_id = ANY (p_agents));
$$;

CREATE FUNCTION private.report_v3_stored_without_sale(p_org uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)
    FROM private.policy_identities i
   WHERE i.organization_id = p_org
     AND NOT EXISTS (SELECT 1 FROM public.wins w WHERE w.organization_id = i.organization_id AND w.policy_id = i.policy_id);
$$;

-- KPIs 1–4 counts for one window at one as_of. p_agents NULL means unfiltered agency scope: only then are
-- unattributed sales included and the agency-only disclosures non-null (plan §2.9).
CREATE FUNCTION private.report_v3_production(p_org uuid, p_agents uuid[], p_sold_from date, p_sold_until date,
                                             p_as_of timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_agency boolean := p_agents IS NULL;
  v_out jsonb;
BEGIN
  IF p_org IS NULL OR p_sold_from IS NULL OR p_sold_until IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'reports v3 production: the organization, both bounds and as_of are required' USING ERRCODE = '22023';
  END IF;

  WITH f AS MATERIALIZED (
    SELECT s.* FROM private.report_v3_sale_facts(p_org, p_agents, p_sold_from, p_sold_until) s
     WHERE s.recorded_at <= p_as_of
  ), tot AS (
    SELECT count(*) AS policy_count,
           count(DISTINCT f.buyer_id) AS buyer_count,
           count(*) FILTER (WHERE f.premium_state = 'known') AS known_count,
           count(*) FILTER (WHERE f.premium_state = 'missing') AS missing_count,
           count(*) FILTER (WHERE f.premium_state = 'invalid') AS invalid_count,
           coalesce(sum(f.monthly_premium) FILTER (WHERE f.premium_state = 'known'), 0) AS monthly_premium,
           coalesce(sum(f.monthly_premium * 12) FILTER (WHERE f.premium_state = 'known'), 0) AS annual_premium,
           count(*) FILTER (WHERE f.premium_source = 'sale_snapshot') AS src_snapshot,
           count(*) FILTER (WHERE f.premium_source = 'legacy_sale_event') AS src_event,
           count(*) FILTER (WHERE f.premium_source = 'legacy_record_fallback') AS src_fallback,
           count(*) FILTER (WHERE f.premium_source = 'correction') AS src_correction,
           count(*) FILTER (WHERE f.premium_source = 'none') AS src_none,
           count(*) FILTER (WHERE f.correction_revision > 0) AS corrections_applied,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.clients c
                                               WHERE c.id = f.buyer_id AND c.organization_id = p_org)) AS client_record_deleted,
           coalesce(sum(f.monthly_premium * 12) FILTER (WHERE f.premium_state = 'known' AND f.seller_id IS NULL), 0)
             AS unattributed_annual_premium,
           count(*) FILTER (WHERE f.seller_id IS NULL) AS unattributed_policies
      FROM f
  ), agents AS (
    SELECT f.seller_id,
           count(*) AS policy_count,
           count(DISTINCT f.buyer_id) AS buyer_count,
           count(*) FILTER (WHERE f.premium_state = 'known') AS known_count,
           count(*) FILTER (WHERE f.premium_state = 'missing') AS missing_count,
           count(*) FILTER (WHERE f.premium_state = 'invalid') AS invalid_count,
           coalesce(sum(f.monthly_premium * 12) FILTER (WHERE f.premium_state = 'known'), 0) AS annual_premium
      FROM f
     WHERE f.seller_id IS NOT NULL
     GROUP BY f.seller_id
  ), by_day AS (
    SELECT f.sold_date,
           count(*) AS policies_sold,
           coalesce(sum(f.monthly_premium * 12) FILTER (WHERE f.premium_state = 'known'), 0) AS annual_premium,
           count(*) FILTER (WHERE f.premium_state = 'known') AS premium_known,
           count(*) FILTER (WHERE f.premium_state = 'missing') AS premium_missing,
           count(*) FILTER (WHERE f.premium_state = 'invalid') AS premium_invalid
      FROM f
     GROUP BY f.sold_date
  ), days AS (
    SELECT d::date AS day
      FROM generate_series(p_sold_from::timestamp, (p_sold_until - 1)::timestamp, interval '1 day') AS d
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'policy_count', t.policy_count,
      'buyer_count', t.buyer_count,
      'known_count', t.known_count,
      'missing_count', t.missing_count,
      'invalid_count', t.invalid_count,
      'monthly_premium', t.monthly_premium,
      'annual_premium', t.annual_premium,
      'premium_sources', jsonb_build_object('sale_snapshot', t.src_snapshot, 'legacy_sale_event', t.src_event,
                                            'legacy_record_fallback', t.src_fallback, 'correction', t.src_correction,
                                            'none', t.src_none),
      'corrections_applied', t.corrections_applied,
      'client_record_deleted', t.client_record_deleted,
      'unattributed_annual_premium', CASE WHEN v_agency THEN t.unattributed_annual_premium END,
      'stored_without_sale', CASE WHEN v_agency THEN private.report_v3_stored_without_sale(p_org) END,
      'quality', jsonb_build_object(
        -- In-scope credited sales with a policy identity but no Sold Date, all time, as of p_as_of.
        'undated_policies', (SELECT count(*) FROM public.wins w
                              WHERE w.organization_id = p_org AND w.policy_id IS NOT NULL AND w.sold_date IS NULL
                                AND coalesce(w.recorded_at, w.created_at) <= p_as_of
                                AND (p_agents IS NULL OR w.agent_id = ANY (p_agents))),
        -- Sales with no policy identity, all time, as of p_as_of (agency scope only).
        'missing_policy_identity', CASE WHEN v_agency THEN (SELECT count(*) FROM public.wins w
                                     WHERE w.organization_id = p_org AND w.policy_id IS NULL
                                       AND coalesce(w.recorded_at, w.created_at) <= p_as_of) END,
        'unattributed_policies', CASE WHEN v_agency THEN t.unattributed_policies END)),
    'by_agent', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.seller_id, 'policy_count', a.policy_count, 'buyer_count', a.buyer_count,
        'known_count', a.known_count, 'missing_count', a.missing_count, 'invalid_count', a.invalid_count,
        'annual_premium', a.annual_premium) ORDER BY a.seller_id) FROM agents a), '[]'::jsonb),
    'production_by_date', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'), 'policies_sold', coalesce(b.policies_sold, 0),
        'annual_premium', coalesce(b.annual_premium, 0), 'premium_known', coalesce(b.premium_known, 0),
        'premium_missing', coalesce(b.premium_missing, 0), 'premium_invalid', coalesce(b.premium_invalid, 0))
        ORDER BY d.day) FROM days d LEFT JOIN by_day b ON b.sold_date = d.day), '[]'::jsonb))
    INTO v_out
    FROM tot t;
  RETURN v_out;
END $$;

-- The KPI 1–4 envelopes, in id order, for one counts object: the totals (with detail) or a by_agent row
-- (detail null). P = policies, K = known, M = missing, I = invalid, A = known annual premium.
CREATE FUNCTION private.report_v3_production_kpis(p_counts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_p numeric := (p_counts ->> 'policy_count')::numeric;
  v_b numeric := (p_counts ->> 'buyer_count')::numeric;
  v_k numeric := (p_counts ->> 'known_count')::numeric;
  v_m numeric := (p_counts ->> 'missing_count')::numeric;
  v_i numeric := (p_counts ->> 'invalid_count')::numeric;
  v_a numeric := (p_counts ->> 'annual_premium')::numeric;
  v_totals boolean := p_counts ? 'premium_sources';
  v_cov jsonb;
  v_premium jsonb;
BEGIN
  IF v_p IS NULL OR v_b IS NULL OR v_k IS NULL OR v_m IS NULL OR v_i IS NULL OR v_a IS NULL OR v_p <> v_k + v_m + v_i THEN
    RAISE EXCEPTION 'reports v3 production: inconsistent KPI 1-4 counts' USING ERRCODE = 'P0001';
  END IF;
  v_cov := CASE WHEN v_p > 0 THEN jsonb_build_object(
             'eligible', v_p, 'assessable', v_k, 'unassessable', v_m + v_i,
             'reasons', jsonb_strip_nulls(jsonb_build_object('premium_invalid', nullif(v_i, 0), 'premium_missing', nullif(v_m, 0))))
           END;
  IF v_totals THEN
    v_premium := jsonb_build_object('known', v_k, 'missing', v_m, 'invalid', v_i,
                                    'legacy_record_fallback', p_counts #> '{premium_sources,legacy_record_fallback}');
  END IF;
  RETURN jsonb_build_array(
    private.report_v3_total(1, v_a, v_cov, NULL, CASE WHEN v_totals THEN jsonb_build_object(
      'premium', v_premium, 'unattributed_annual_premium', p_counts -> 'unattributed_annual_premium',
      'premium_sources', p_counts -> 'premium_sources', 'corrections_applied', p_counts -> 'corrections_applied') END),
    private.report_v3_total(2, v_p, NULL, NULL, CASE WHEN v_totals THEN jsonb_build_object(
      'quality', p_counts -> 'quality', 'stored_without_sale', p_counts -> 'stored_without_sale') END),
    private.report_v3_total(3, v_b, NULL, NULL, CASE WHEN v_totals THEN jsonb_build_object(
      'client_record_deleted', p_counts -> 'client_record_deleted') END),
    private.report_v3_ratio(4, v_a, v_k, v_cov, NULL, NULL, CASE WHEN v_totals THEN jsonb_build_object('premium', v_premium) END));
END $$;

REVOKE ALL ON FUNCTION private.report_v3_sale_premium(public.wins, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_sale_facts(uuid, uuid[], date, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_stored_without_sale(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_production(uuid, uuid[], date, date, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_v3_production_kpis(jsonb) FROM PUBLIC, anon, authenticated, service_role;

DO $postcondition$
DECLARE f record; r text; n int := 0;
BEGIN
  FOR f IN SELECT p.oid, p.prosecdef, p.proconfig, p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('report_v3_sale_premium', 'report_v3_sale_facts',
                  'report_v3_stored_without_sale', 'report_v3_production', 'report_v3_production_kpis') LOOP
    n := n + 1;
    IF f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp'] OR f.proowner <> 'postgres'::regrole THEN
      RAISE EXCEPTION 'Reports v3 sale facts: helper metadata mismatch: %', f.oid::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reports v3 sale facts: % can execute %', r, f.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  IF n <> 5 THEN
    RAISE EXCEPTION 'Reports v3 sale facts: expected 5 helpers, found %', n;
  END IF;
END $postcondition$;
