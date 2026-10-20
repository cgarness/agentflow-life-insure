-- Commissions center: read-only reporting over saved policy commissions ("My commissions").
-- Contract: docs/plans/2026-10-20-commissions-center/implementation_plan.md §4–§5.
-- Approved for LOCAL build and disposable-database testing only. Production application requires Chris's separate
-- approval. Every function here is SECURITY INVOKER and STABLE: the existing RLS on the six commission tables, wins,
-- clients and company_settings applies to every row, and nothing is written. Estimates are AgentFlow projections and
-- receipts are manual records; neither is carrier-verified, earned, paid, payroll or booked commission.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE policy_commission_center_preexisting ON COMMIT DROP AS SELECT oid FROM pg_catalog.pg_proc;

-- ── 0. Prerequisite, preimage and replay guards ──────────────────────────────────────────────────────────────────
DO $guard$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.policy_commission_installments')
                   AND attname = 'expected_until' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.policy_commission_estimates')
                      AND attname = 'schedule_assumed' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'commissions center reads require 20261019170000 and 20261020040000';
  END IF;
  IF to_regnamespace('policy_commission_reporting') IS NOT NULL
     OR to_regprocedure('public.get_my_commission_overview(text,date,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'commissions center reads are already applied; refusing replay';
  END IF;
  -- The authorization and read definitions these functions rely on, exactly as the applied migrations left them.
  FOR r IN SELECT * FROM (VALUES
      ('private.campaign_actor()', 'f582e43731a968fb2e0961e80939ff7e'),
      ('policy_commission_authz.actor_org()', '29be135fe6edfb5082838eeb22d48790'),
      ('policy_commission_authz.access(uuid)', 'a6da4418b7010c609d5be650615ae643'),
      ('public.get_client_policy_commissions(uuid)', '5765e4dad8ec9c8b4bbb85fb32651c94')) v(fn, digest)
  LOOP
    IF to_regprocedure(r.fn) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'commissions center reads: % differs from the reviewed preimage; refusing', r.fn;
    END IF;
  END LOOP;
END $guard$;

-- ── 1. Indexes (additive; Phase 2A tables only) ──────────────────────────────────────────────────────────────────
CREATE INDEX policy_commission_receipts_agent_received
  ON public.policy_commission_receipts (organization_id, credited_agent_id, received_on);
CREATE INDEX policy_commission_captures_agent_open
  ON public.policy_commission_captures (organization_id, credited_agent_id)
  WHERE status IN ('awaiting_confirmation', 'needs_attention');

-- ── 2. Shared definitions (not exposed by PostgREST; USAGE for authenticated only) ──────────────────────────────
CREATE SCHEMA policy_commission_reporting;
REVOKE ALL ON SCHEMA policy_commission_reporting FROM PUBLIC;
GRANT USAGE ON SCHEMA policy_commission_reporting TO authenticated;

-- The signed-in viewer: real actor, organization, own commission access and the agency calendar date. Fails closed:
-- 42501 without own access (never an empty report), 55000 when the agency time zone is unset or not a real zone
-- (the Reports convention: no substitute zone).
CREATE FUNCTION policy_commission_reporting.viewer()
RETURNS TABLE (uid uuid, org uuid, today date, time_zone text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid := policy_commission_authz.actor_org(); v_tz text;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL OR policy_commission_authz.access(v_uid) IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT cs.timezone INTO v_tz FROM public.company_settings cs WHERE cs.organization_id = v_org;
  IF v_tz IS NULL OR btrim(v_tz) = '' OR lower(v_tz) IN ('factory', 'localtime', 'posixrules')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tz) THEN
    RAISE EXCEPTION 'The agency time zone is not set' USING ERRCODE = '55000',
      HINT = 'An admin must set the time zone in Settings > Company Branding.';
  END IF;
  RETURN QUERY SELECT v_uid, v_org, (now() AT TIME ZONE v_tz)::date, v_tz;
END $$;

-- A reporting period resolved against the agency date. Custom ranges are inclusive calendar dates within 2000–2100;
-- p_max_days limits the Overview (its monthly timeline) and refuses "all".
CREATE FUNCTION policy_commission_reporting.period(p_period text, p_from date, p_to date, p_today date, p_max_days integer)
RETURNS TABLE (from_on date, to_on date)
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE m date := date_trunc('month', p_today)::date; y date := date_trunc('year', p_today)::date; f date; t date;
BEGIN
  CASE coalesce(p_period, 'this_month')
    WHEN 'this_month' THEN f := m; t := (m + interval '1 month' - interval '1 day')::date;
    WHEN 'last_month' THEN f := (m - interval '1 month')::date; t := m - 1;
    WHEN 'next_month' THEN f := (m + interval '1 month')::date; t := (m + interval '2 months' - interval '1 day')::date;
    WHEN 'this_year' THEN f := y; t := (y + interval '1 year' - interval '1 day')::date;
    WHEN 'last_year' THEN f := (y - interval '1 year')::date; t := y - 1;
    WHEN 'all' THEN
      IF p_max_days IS NOT NULL THEN RAISE EXCEPTION 'Choose a period' USING ERRCODE = '22023'; END IF;
      f := DATE '2000-01-01'; t := DATE '2100-12-31';
    WHEN 'custom' THEN
      f := p_from; t := p_to;
      IF f IS NULL OR t IS NULL OR f < DATE '2000-01-01' OR t > DATE '2100-12-31' OR f > t THEN
        RAISE EXCEPTION 'Choose a start date on or before the end date, between 2000 and 2100.' USING ERRCODE = '22023';
      END IF;
      IF p_max_days IS NOT NULL AND t - f + 1 > p_max_days THEN
        RAISE EXCEPTION 'Choose a range of up to two years.' USING ERRCODE = '22023';
      END IF;
    ELSE RAISE EXCEPTION 'Unknown period' USING ERRCODE = '22023';
  END CASE;
  RETURN QUERY SELECT f, t;
END $$;

-- One row per installment of the viewer's CURRENT estimates (active or on hold; never superseded). Receipts are
-- aggregated per installment before the join, so no amount is multiplied. Remaining and excess use every valid
-- receipt on the installment, whatever its date. The window and status follow plan §4. p_policies narrows it to a
-- page of policies (Policies list).
CREATE TYPE policy_commission_reporting.installment_fact AS (
  installment_id uuid, estimate_id uuid, policy_id uuid, kind text, sequence smallint, expected_cents bigint,
  timing_precision text, expected_on date, expected_until date, window_start date, window_end date,
  received_cents bigint, receipt_count integer, remaining_cents bigint, excess_cents bigint,
  estimate_status text, product_carrier text, product_name text, status text);

CREATE FUNCTION policy_commission_reporting.installments(p_uid uuid, p_org uuid, p_today date, p_policies uuid[] DEFAULT NULL)
RETURNS SETOF policy_commission_reporting.installment_fact
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  WITH r AS (
    SELECT rc.installment_id, sum(rc.amount_cents)::bigint AS received, count(*)::integer AS n
      FROM public.policy_commission_receipts rc
     WHERE rc.organization_id = p_org AND rc.credited_agent_id = p_uid AND rc.voided_at IS NULL
       AND (p_policies IS NULL OR rc.policy_id = ANY (p_policies))
     GROUP BY rc.installment_id),
  i AS (
    SELECT i.id, i.estimate_id, i.policy_id, i.kind, i.sequence, i.expected_cents, i.timing_precision, i.expected_on,
           i.expected_until, e.status AS estimate_status, e.product_carrier, e.product_name,
           CASE WHEN i.expected_on IS NULL THEN NULL
                WHEN i.timing_precision = 'month' THEN (date_trunc('month', i.expected_on) + interval '1 month' - interval '1 day')::date
                ELSE coalesce(i.expected_until, i.expected_on) END AS window_end,
           coalesce(r.received, 0)::bigint AS received, coalesce(r.n, 0) AS n
      FROM public.policy_commission_estimates e
      JOIN public.policy_commission_installments i
        ON i.estimate_id = e.id AND i.organization_id = e.organization_id AND i.policy_id = e.policy_id
       AND i.credited_agent_id = e.credited_agent_id
      LEFT JOIN r ON r.installment_id = i.id
     WHERE e.organization_id = p_org AND e.credited_agent_id = p_uid AND e.status IN ('active', 'on_hold')
       AND (p_policies IS NULL OR e.policy_id = ANY (p_policies)) AND p_uid = (SELECT auth.uid()))
  SELECT i.id, i.estimate_id, i.policy_id, i.kind, i.sequence, i.expected_cents, i.timing_precision, i.expected_on,
         i.expected_until, i.expected_on, i.window_end, i.received, i.n,
         greatest(i.expected_cents - i.received, 0), greatest(i.received - i.expected_cents, 0),
         i.estimate_status, i.product_carrier, i.product_name,
         CASE WHEN i.estimate_status = 'on_hold' THEN 'on_hold'
              WHEN i.received >= i.expected_cents AND i.received > 0 THEN 'received'
              WHEN i.received >= i.expected_cents THEN 'none'
              WHEN i.expected_on IS NULL THEN 'date_needed'
              WHEN i.window_end < p_today THEN 'check_payment'
              ELSE 'upcoming' END
    FROM i
$$;

-- One row per ELIGIBLE policy: a sale (wins row) with a stable policy id credited to the viewer in the viewer's own
-- organization (wins_select also admits Agency Group peers; they are excluded here explicitly). Contact fields come
-- only from public.clients under the viewer's own RLS: no visible client row means a restricted contact. p_policy
-- narrows it to one policy (an index lookup) for the drawer and History rows.
CREATE TYPE policy_commission_reporting.policy_fact AS (
  policy_id uuid, win_id uuid, client_id uuid, sold_date date, sale_created_at timestamptz, win_policy_type text,
  win_premium numeric, win_premium_snapshot boolean, estimate_id uuid, estimate_status text, first_year_cents bigint,
  product_carrier text, product_name text, capture_status text, contact_visible boolean, contact_name text,
  source text, carrier text, policy_type text, premium_text text, effective_date text, payment_frequency text);

CREATE FUNCTION policy_commission_reporting.policies(p_uid uuid, p_org uuid, p_policy uuid DEFAULT NULL)
RETURNS SETOF policy_commission_reporting.policy_fact
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT w.policy_id, w.id, w.contact_id, w.sold_date, w.created_at, w.policy_type, w.premium_amount,
         coalesce(w.premium_snapshot, false),
         e.id, e.status, e.first_year_cents, e.product_carrier, e.product_name,
         CASE WHEN e.id IS NULL THEN cp.status END,
         c.id IS NOT NULL,
         nullif(btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''))), ''),
         CASE WHEN c.id IS NULL THEN NULL WHEN c.primary_policy_id = w.policy_id THEN 'primary'
              WHEN ap.item IS NOT NULL THEN 'additional' END,
         CASE WHEN c.primary_policy_id = w.policy_id THEN c.carrier::text ELSE ap.item->>'carrier' END,
         CASE WHEN c.primary_policy_id = w.policy_id THEN c.policy_type::text ELSE ap.item->>'policyType' END,
         CASE WHEN c.primary_policy_id = w.policy_id THEN c.premium::text ELSE ap.item->>'premiumAmount' END,
         CASE WHEN c.primary_policy_id = w.policy_id THEN c.effective_date::text ELSE ap.item->>'effectiveDate' END,
         CASE WHEN c.primary_policy_id = w.policy_id THEN c.payment_frequency::text END
    FROM public.wins w
    LEFT JOIN public.policy_commission_estimates e
      ON e.organization_id = w.organization_id AND e.policy_id = w.policy_id AND e.status IN ('active', 'on_hold')
    LEFT JOIN public.policy_commission_captures cp
      ON cp.organization_id = w.organization_id AND cp.policy_id = w.policy_id
     AND cp.status IN ('awaiting_confirmation', 'needs_attention')
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    LEFT JOIN LATERAL (
      SELECT x AS item FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies') = 'array'
                                                      THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) x
       WHERE jsonb_typeof(x) = 'object' AND x->>'policyId' = w.policy_id::text LIMIT 1) ap
      ON c.primary_policy_id IS DISTINCT FROM w.policy_id
   WHERE w.organization_id = p_org AND w.agent_id = p_uid AND w.policy_id IS NOT NULL
     AND (p_policy IS NULL OR w.policy_id = p_policy) AND p_uid = (SELECT auth.uid())
$$;

-- A contact reference only when the viewer can open that client today.
CREATE FUNCTION policy_commission_reporting.contact_json(p policy_commission_reporting.policy_fact)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p.contact_visible THEN jsonb_build_object('client_id', p.client_id, 'name', p.contact_name) END
$$;

CREATE FUNCTION policy_commission_reporting.iso_or_null(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p ~ '^\d{4}-\d{2}-\d{2}$' THEN p END
$$;

-- One scheduled-payment row (Scheduled list, Upcoming).
CREATE FUNCTION policy_commission_reporting.installment_json(f policy_commission_reporting.installment_fact,
  p policy_commission_reporting.policy_fact)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('installment_id', f.installment_id, 'estimate_id', f.estimate_id, 'policy_id', f.policy_id,
    'kind', f.kind, 'expected_cents', f.expected_cents, 'received_cents', f.received_cents,
    'remaining_cents', f.remaining_cents, 'excess_cents', f.excess_cents, 'receipt_count', f.receipt_count,
    'timing_precision', f.timing_precision, 'expected_on', f.expected_on, 'expected_until', f.expected_until,
    'window_end', f.window_end, 'status', f.status, 'estimate_status', f.estimate_status,
    'carrier', f.product_carrier, 'product', f.product_name,
    'contact', policy_commission_reporting.contact_json(p))
$$;

-- ── 3. Public reads (SECURITY INVOKER, STABLE; EXECUTE authenticated only) ──────────────────────────────────────

CREATE FUNCTION public.get_my_commission_overview(p_period text DEFAULT 'this_month', p_from date DEFAULT NULL,
  p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; p record; v_first date; v_last date; n integer; v_before integer := 0; v_after integer := 0;
  v_chart_from date; v_chart_to date; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, 731);
  v_first := date_trunc('month', p.from_on)::date;
  v_last := date_trunc('month', p.to_on)::date;
  n := (extract(year FROM v_last)::integer - extract(year FROM v_first)::integer) * 12
       + extract(month FROM v_last)::integer - extract(month FROM v_first)::integer + 1;
  IF n < 12 THEN v_before := (12 - n) / 2; v_after := 12 - n - v_before; END IF;
  v_chart_from := (v_first - make_interval(months => v_before))::date;
  v_chart_to := (v_last + make_interval(months => v_after + 1) - interval '1 day')::date;

  WITH inst AS MATERIALIZED (SELECT * FROM policy_commission_reporting.installments(v.uid, v.org, v.today)),
  pol AS MATERIALIZED (SELECT * FROM policy_commission_reporting.policies(v.uid, v.org)),
  cohort AS (SELECT * FROM inst WHERE estimate_status = 'active' AND window_start BETWEEN p.from_on AND p.to_on),
  rec AS (SELECT r.received_on, r.amount_cents FROM public.policy_commission_receipts r
           WHERE r.organization_id = v.org AND r.credited_agent_id = v.uid AND r.voided_at IS NULL
             AND r.received_on BETWEEN least(p.from_on, v_chart_from) AND greatest(p.to_on, v_chart_to)),
  next90 AS (SELECT * FROM inst WHERE estimate_status = 'active' AND window_start IS NOT NULL AND remaining_cents > 0
                AND window_end >= v.today AND window_start <= v.today + 89),
  months AS (
    SELECT m::date AS m, (m::date BETWEEN v_first AND v_last) AS in_period,
           CASE WHEN m::date BETWEEN v_first AND v_last THEN greatest(m::date, p.from_on) ELSE m::date END AS b_from,
           CASE WHEN m::date BETWEEN v_first AND v_last THEN least((m + interval '1 month' - interval '1 day')::date, p.to_on)
                ELSE (m + interval '1 month' - interval '1 day')::date END AS b_to
      FROM generate_series(v_chart_from, v_chart_to, interval '1 month') m),
  -- Each installment or receipt falls in at most one bucket (bucket ranges never overlap).
  tl_inst AS (
    SELECT mo.m, sum(f.expected_cents) FILTER (WHERE f.kind = 'advance') AS advance,
           sum(f.expected_cents) FILTER (WHERE f.kind <> 'advance') AS later, count(*) AS n
      FROM months mo JOIN inst f ON f.estimate_status = 'active' AND f.window_start BETWEEN mo.b_from AND mo.b_to GROUP BY mo.m),
  tl_rec AS (
    SELECT mo.m, sum(r.amount_cents) AS amount, count(*) AS n
      FROM months mo JOIN rec r ON r.received_on BETWEEN mo.b_from AND mo.b_to GROUP BY mo.m)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'period', coalesce(p_period, 'this_month'),
             'from', p.from_on, 'to', p.to_on),
    'summary', (SELECT jsonb_build_object(
        'expected_cents', coalesce(sum(c.expected_cents), 0), 'remaining_cents', coalesce(sum(c.remaining_cents), 0),
        'excess_cents', coalesce(sum(c.excess_cents), 0), 'expected_count', count(*),
        'received_cents', (SELECT coalesce(sum(amount_cents), 0) FROM rec WHERE received_on BETWEEN p.from_on AND p.to_on),
        'received_count', (SELECT count(*) FROM rec WHERE received_on BETWEEN p.from_on AND p.to_on),
        'held_expected_cents', (SELECT coalesce(sum(expected_cents), 0) FROM inst
                                 WHERE estimate_status = 'on_hold' AND window_start BETWEEN p.from_on AND p.to_on),
        'held_count', (SELECT count(*) FROM inst WHERE estimate_status = 'on_hold' AND window_start BETWEEN p.from_on AND p.to_on))
      FROM cohort c),
    'next_90', (SELECT jsonb_build_object('from', v.today, 'to', v.today + 89,
        'remaining_cents', coalesce(sum(remaining_cents), 0), 'count', count(*)) FROM next90),
    'timeline', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', to_char(mo.m, 'YYYY-MM'), 'from', mo.b_from, 'to', mo.b_to,
        'in_period', mo.in_period, 'received_cents', coalesce(tr.amount, 0), 'receipt_count', coalesce(tr.n, 0),
        'expected_advance_cents', coalesce(ti.advance, 0), 'expected_later_cents', coalesce(ti.later, 0),
        'installment_count', coalesce(ti.n, 0)) ORDER BY mo.m), '[]'::jsonb)
        FROM months mo LEFT JOIN tl_inst ti ON ti.m = mo.m LEFT JOIN tl_rec tr ON tr.m = mo.m),
    'review', jsonb_build_object(
      'check_payment', (SELECT jsonb_build_object('count', count(*), 'remaining_cents', coalesce(sum(remaining_cents), 0))
                          FROM inst WHERE status = 'check_payment'),
      'date_needed', (SELECT jsonb_build_object('count', count(*), 'remaining_cents', coalesce(sum(remaining_cents), 0))
                        FROM inst WHERE status = 'date_needed'),
      'needs_review', (SELECT jsonb_build_object('count', count(*)) FROM pol WHERE estimate_id IS NULL AND capture_status IS NOT NULL),
      'missing_estimate', (SELECT jsonb_build_object('count', count(*)) FROM pol WHERE estimate_id IS NULL AND capture_status IS NULL)),
    'upcoming', jsonb_build_object('total_count', (SELECT count(*) FROM next90),
      'rows', (SELECT coalesce(jsonb_agg(x.j ORDER BY x.window_start, x.sequence, x.policy_id, x.installment_id), '[]'::jsonb)
                 FROM (SELECT policy_commission_reporting.installment_json(f, pf) AS j, f.window_start, f.sequence, f.policy_id,
                              f.installment_id
                         FROM next90 f JOIN pol pf ON pf.policy_id = f.policy_id
                        ORDER BY f.window_start, f.sequence, f.policy_id, f.installment_id LIMIT 5) x)),
    'setup', (SELECT jsonb_build_object('eligible_count', count(*), 'with_estimate_count', count(estimate_id)) FROM pol))
    INTO v_out;
  RETURN v_out;
END $$;

CREATE FUNCTION public.get_my_commission_installments(p_period text DEFAULT 'this_month', p_from date DEFAULT NULL,
  p_to date DEFAULT NULL, p_scope text DEFAULT 'range', p_status text DEFAULT 'all', p_kind text DEFAULT NULL,
  p_carrier text DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; p record; v_carrier text := lower(nullif(btrim(coalesce(p_carrier, '')), '')); v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, NULL);
  IF p_scope IS NULL OR p_scope NOT IN ('range', 'next_90', 'any') THEN RAISE EXCEPTION 'Unknown scope' USING ERRCODE = '22023'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('all', 'remaining', 'upcoming', 'check_payment', 'received', 'date_needed', 'on_hold') THEN
    RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NOT NULL AND p_kind NOT IN ('advance', 'month_10', 'month_11', 'month_12', 'later') THEN
    RAISE EXCEPTION 'Unknown payment type' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  WITH inst AS MATERIALIZED (SELECT * FROM policy_commission_reporting.installments(v.uid, v.org, v.today)),
  scoped AS (
    SELECT * FROM inst f
     WHERE CASE p_scope WHEN 'range' THEN f.window_start BETWEEN p.from_on AND p.to_on
                        WHEN 'next_90' THEN f.estimate_status = 'active' AND f.window_start IS NOT NULL AND f.remaining_cents > 0
                                            AND f.window_end >= v.today AND f.window_start <= v.today + 89
                        ELSE true END
       AND (p_kind IS NULL OR f.kind = p_kind OR (p_kind = 'later' AND f.kind <> 'advance'))
       AND (v_carrier IS NULL OR lower(btrim(f.product_carrier)) = v_carrier)),
  matched AS (
    SELECT * FROM scoped f
     WHERE CASE p_status WHEN 'all' THEN f.estimate_status = 'active'
                         WHEN 'remaining' THEN f.estimate_status = 'active' AND f.remaining_cents > 0
                         ELSE f.status = p_status END),
  -- Only the page's rows get JSON and a (single-policy) contact lookup.
  page AS (
    SELECT f.installment_id, f.window_start, f.sequence, f.policy_id FROM matched f
     ORDER BY f.window_start NULLS LAST, f.sequence, f.policy_id, f.installment_id
     LIMIT p_limit OFFSET p_offset),
  page_rows AS (
    SELECT policy_commission_reporting.installment_json(f, pf) AS j, g.window_start, g.sequence, g.policy_id, g.installment_id
      FROM page g JOIN matched f ON f.installment_id = g.installment_id
      JOIN LATERAL policy_commission_reporting.policies(v.uid, v.org, g.policy_id) pf ON true)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'period', coalesce(p_period, 'this_month'),
             'from', p.from_on, 'to', p.to_on, 'scope', p_scope, 'status', p_status, 'kind', p_kind, 'carrier', p_carrier,
             'limit', p_limit, 'offset', p_offset),
    'total_count', (SELECT count(*) FROM matched),
    'totals', (SELECT jsonb_build_object('expected_cents', coalesce(sum(expected_cents), 0),
                 'received_cents', coalesce(sum(received_cents), 0), 'remaining_cents', coalesce(sum(remaining_cents), 0),
                 'excess_cents', coalesce(sum(excess_cents), 0)) FROM matched),
    'held_count', (SELECT count(*) FROM scoped WHERE estimate_status = 'on_hold'),
    'carriers', (SELECT coalesce(jsonb_agg(c ORDER BY lower(c), c), '[]'::jsonb)
                   FROM (SELECT DISTINCT btrim(e.product_carrier) AS c FROM public.policy_commission_estimates e
                          WHERE e.organization_id = v.org AND e.credited_agent_id = v.uid AND e.status IN ('active', 'on_hold')
                            AND btrim(e.product_carrier) <> '') d),
    'rows', (SELECT coalesce(jsonb_agg(j ORDER BY window_start NULLS LAST, sequence, policy_id, installment_id), '[]'::jsonb) FROM page_rows))
    INTO v_out;
  RETURN v_out;
END $$;

CREATE FUNCTION public.get_my_commission_receipts(p_period text DEFAULT 'this_month', p_from date DEFAULT NULL,
  p_to date DEFAULT NULL, p_include_voided boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; p record; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, NULL);
  IF p_include_voided IS NULL THEN RAISE EXCEPTION 'Choose whether to include voided payments' USING ERRCODE = '22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  WITH rows AS (
    SELECT r.id, r.received_on, r.recorded_at, r.amount_cents, r.voided_at, r.void_reason, r.replaces_receipt_id,
           r.policy_id, r.installment_id, r.estimate_id, i.kind, e.status AS estimate_status, e.product_carrier, e.product_name
      FROM public.policy_commission_receipts r
      JOIN public.policy_commission_installments i
        ON i.id = r.installment_id AND i.estimate_id = r.estimate_id AND i.organization_id = r.organization_id
      JOIN public.policy_commission_estimates e ON e.id = r.estimate_id AND e.organization_id = r.organization_id
     WHERE r.organization_id = v.org AND r.credited_agent_id = v.uid
       AND r.received_on BETWEEN p.from_on AND p.to_on
       AND (p_include_voided OR r.voided_at IS NULL)),
  page AS (
    SELECT x.*, (SELECT n.id FROM public.policy_commission_receipts n
                  WHERE n.replaces_receipt_id = x.id AND n.organization_id = v.org) AS replaced_by,
           (SELECT policy_commission_reporting.contact_json(pf)
              FROM policy_commission_reporting.policies(v.uid, v.org, x.policy_id) pf) AS contact
      FROM rows x ORDER BY x.received_on DESC, x.recorded_at DESC, x.id LIMIT p_limit OFFSET p_offset)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'period', coalesce(p_period, 'this_month'),
             'from', p.from_on, 'to', p.to_on, 'include_voided', p_include_voided, 'limit', p_limit, 'offset', p_offset),
    'total_count', (SELECT count(*) FROM rows),
    'totals', (SELECT jsonb_build_object('received_cents', coalesce(sum(amount_cents) FILTER (WHERE voided_at IS NULL), 0),
                 'valid_count', count(*) FILTER (WHERE voided_at IS NULL), 'voided_count', count(*) FILTER (WHERE voided_at IS NOT NULL))
                 FROM rows),
    'rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('receipt_id', g.id, 'received_on', g.received_on,
                 'recorded_at', g.recorded_at, 'amount_cents', g.amount_cents, 'voided', g.voided_at IS NOT NULL,
                 'void_reason', g.void_reason, 'replaces_receipt_id', g.replaces_receipt_id, 'replaced_by_receipt_id', g.replaced_by,
                 'policy_id', g.policy_id, 'installment_id', g.installment_id, 'estimate_id', g.estimate_id, 'kind', g.kind,
                 'estimate_status', g.estimate_status, 'carrier', g.product_carrier, 'product', g.product_name,
                 'contact', g.contact)
               ORDER BY g.received_on DESC, g.recorded_at DESC, g.id), '[]'::jsonb) FROM page g))
    INTO v_out;
  RETURN v_out;
END $$;

CREATE FUNCTION public.get_my_commission_policies(p_setup text DEFAULT 'all', p_carrier text DEFAULT NULL,
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; v_carrier text := lower(nullif(btrim(coalesce(p_carrier, '')), '')); v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  IF p_setup IS NULL OR p_setup NOT IN ('all', 'missing', 'needs_review', 'recorded', 'on_hold') THEN
    RAISE EXCEPTION 'Unknown setup filter' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  -- pf keeps the named composite type, so contact_json() accepts it after the CTE boundaries. Setup state and carrier
  -- come from the policies alone; payment amounts are read only for the page's policies.
  WITH pol AS MATERIALIZED (SELECT x AS pf FROM policy_commission_reporting.policies(v.uid, v.org) x),
  rows AS (
    SELECT o.pf,
           CASE WHEN (o.pf).estimate_status = 'on_hold' THEN 'on_hold' WHEN (o.pf).estimate_id IS NOT NULL THEN 'recorded'
                WHEN (o.pf).capture_status IS NOT NULL THEN 'needs_review' ELSE 'missing' END AS setup,
           coalesce(nullif(btrim((o.pf).product_carrier), ''), nullif(btrim((o.pf).carrier), '')) AS shown_carrier
      FROM pol o),
  matched AS (
    SELECT * FROM rows r
     WHERE (p_setup = 'all' OR r.setup = p_setup OR (p_setup = 'recorded' AND r.setup = 'on_hold'))
       AND (v_carrier IS NULL OR lower(r.shown_carrier) = v_carrier)),
  page AS (
    SELECT * FROM matched m ORDER BY (m.pf).sold_date DESC NULLS LAST, (m.pf).sale_created_at DESC, (m.pf).policy_id
     LIMIT p_limit OFFSET p_offset),
  inst AS MATERIALIZED (
    SELECT * FROM policy_commission_reporting.installments(v.uid, v.org, v.today, (SELECT array_agg((g.pf).policy_id) FROM page g))),
  nxt AS (
    SELECT DISTINCT ON (n.policy_id) n.policy_id, jsonb_build_object('kind', n.kind, 'timing_precision', n.timing_precision,
             'expected_on', n.expected_on, 'expected_until', n.expected_until, 'remaining_cents', n.remaining_cents,
             'status', n.status) AS next_payment
      FROM inst n WHERE n.remaining_cents > 0 AND n.estimate_status = 'active'
     ORDER BY n.policy_id, n.sequence),
  agg AS (
    SELECT f.policy_id, sum(f.received_cents)::bigint AS received, sum(f.remaining_cents)::bigint AS remaining,
           sum(f.excess_cents)::bigint AS excess, count(*) FILTER (WHERE f.status = 'date_needed') AS date_needed
      FROM inst f GROUP BY f.policy_id)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'setup', p_setup,
             'carrier', p_carrier, 'limit', p_limit, 'offset', p_offset),
    'total_count', (SELECT count(*) FROM matched),
    'counts', (SELECT jsonb_build_object('eligible_count', count(*), 'with_estimate_count', count(*) FILTER (WHERE setup IN ('recorded', 'on_hold')),
                 'missing_count', count(*) FILTER (WHERE setup = 'missing'), 'needs_review_count', count(*) FILTER (WHERE setup = 'needs_review'),
                 'on_hold_count', count(*) FILTER (WHERE setup = 'on_hold')) FROM rows),
    'carriers', (SELECT coalesce(jsonb_agg(c ORDER BY lower(c), c), '[]'::jsonb)
                   FROM (SELECT DISTINCT shown_carrier AS c FROM rows WHERE shown_carrier IS NOT NULL) d),
    'rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('policy_id', (g.pf).policy_id, 'setup', g.setup,
                 'contact', policy_commission_reporting.contact_json(g.pf), 'source', (g.pf).source, 'carrier', g.shown_carrier,
                 'product', coalesce(nullif(btrim((g.pf).product_name), ''), nullif(btrim((g.pf).policy_type), '')),
                 'effective_date', policy_commission_reporting.iso_or_null((g.pf).effective_date),
                 'estimate_cents', (g.pf).first_year_cents, 'received_cents', a.received, 'remaining_cents', a.remaining,
                 'excess_cents', a.excess, 'date_needed_count', coalesce(a.date_needed, 0), 'next_payment', nx.next_payment)
               ORDER BY (g.pf).sold_date DESC NULLS LAST, (g.pf).sale_created_at DESC, (g.pf).policy_id), '[]'::jsonb)
               FROM page g LEFT JOIN agg a ON a.policy_id = (g.pf).policy_id LEFT JOIN nxt nx ON nx.policy_id = (g.pf).policy_id))
    INTO v_out;
  RETURN v_out;
END $$;

-- The detail drawer: one of the viewer's eligible policies in exactly the per-policy shape of
-- get_client_policy_commissions (which the tracking controls read), plus the contact reference when visible. Policy
-- fields from the client record appear only for a visible contact; otherwise only the sale's own snapshot is used.
CREATE FUNCTION public.get_my_policy_commission(p_policy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; f policy_commission_reporting.policy_fact; v_est jsonb; v_cap jsonb; v_state text; v_basis jsonb;
  v_pp text; v_type text; v_carrier text; v_eff text;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO f FROM policy_commission_reporting.policies(v.uid, v.org, p_policy_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission not found' USING ERRCODE = 'PT404'; END IF;
  SELECT jsonb_build_object('id', e.id, 'status', e.status, 'status_reason', e.status_reason, 'capture_mode', e.capture_mode,
           'captured_by', cp.captured_by, 'recorded_by', e.recorded_by, 'recorded_at', e.recorded_at,
           'grid_name', e.grid_name, 'grid_revision', e.grid_revision, 'grid_effective_date', e.grid_effective_date,
           'product_name', e.product_name, 'product_carrier', e.product_carrier, 'variant_label', e.variant_label,
           'insured_age', e.insured_age, 'term_years', e.term_years, 'contract_level', e.contract_level,
           'rate_percent', e.rate_percent::text, 'monthly_premium', e.monthly_premium::text, 'premium_source', e.premium_source,
           'first_year_cents', e.first_year_cents, 'advance_cents', e.advance_cents,
           'schedule_start_on', e.schedule_start_on, 'schedule_start_source', e.schedule_start_source,
           'schedule_assumed', e.schedule_assumed, 'schedule_frequency', e.schedule_frequency,
           'schedule_convention', e.schedule_convention, 'state_revision', e.state_revision,
           'installments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind,
               'expected_cents', i.expected_cents, 'timing_precision', i.timing_precision, 'expected_on', i.expected_on,
               'expected_until', i.expected_until, 'timing_source', i.timing_source,
               'receipts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_cents', r.amount_cents,
                   'received_on', r.received_on, 'reference', r.reference, 'recorded_by', r.recorded_by,
                   'recorded_at', r.recorded_at, 'replaces_receipt_id', r.replaces_receipt_id, 'voided_at', r.voided_at,
                   'void_reason', r.void_reason) ORDER BY r.recorded_at, r.id), '[]'::jsonb)
                 FROM public.policy_commission_receipts r WHERE r.installment_id = i.id)) ORDER BY i.sequence), '[]'::jsonb)
             FROM public.policy_commission_installments i WHERE i.estimate_id = e.id))
    INTO v_est
    FROM public.policy_commission_estimates e
    LEFT JOIN public.policy_commission_captures cp ON cp.id = e.capture_id
   WHERE e.organization_id = v.org AND e.policy_id = p_policy_id AND e.status IN ('active', 'on_hold');
  SELECT jsonb_build_object('id', cp.id, 'status', cp.status, 'attention_code', cp.attention_code,
           'first_year_cents', cp.first_year_cents, 'advance_cents', cp.advance_cents, 'captured_by', cp.captured_by,
           'captured_at', cp.captured_at, 'product_id', cp.product_id, 'insured_age', cp.insured_age,
           'term_years', cp.term_years)
    INTO v_cap
    FROM public.policy_commission_captures cp
   WHERE cp.organization_id = v.org AND cp.policy_id = p_policy_id AND cp.status IN ('awaiting_confirmation', 'needs_attention');
  v_state := CASE WHEN v_est IS NOT NULL THEN 'recorded'
                  WHEN v_cap->>'status' = 'awaiting_confirmation' THEN 'awaiting_confirmation'
                  WHEN v_cap->>'status' = 'needs_attention' THEN 'needs_attention'
                  ELSE 'not_recorded' END;
  -- Same basis rules as get_client_policy_commissions; a restricted contact contributes nothing from its record.
  v_pp := CASE WHEN f.contact_visible THEN regexp_replace(coalesce(f.premium_text, ''), '[,$[:space:]]', '', 'g') ELSE '' END;
  v_type := CASE WHEN f.contact_visible THEN coalesce(f.win_policy_type, f.policy_type) ELSE nullif(f.win_policy_type, '') END;
  v_carrier := CASE WHEN f.contact_visible THEN f.carrier END;
  v_eff := CASE WHEN f.contact_visible THEN policy_commission_reporting.iso_or_null(f.effective_date) END;
  v_basis := jsonb_build_object('policy_type', v_type, 'carrier', v_carrier,
    'monthly_premium', CASE WHEN f.win_premium_snapshot AND f.win_premium > 0 THEN f.win_premium::text
                            WHEN v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN v_pp END,
    'premium_source', CASE WHEN f.win_premium_snapshot AND f.win_premium > 0 THEN 'sale_snapshot'
                           WHEN v_pp ~ '^\d+(\.\d{1,2})?$' AND v_pp::numeric > 0 THEN 'policy_record' END,
    'effective_date', v_eff, 'payment_frequency', CASE WHEN f.contact_visible THEN f.payment_frequency END);
  RETURN jsonb_build_object(
    'policy', jsonb_build_object('policy_id', f.policy_id, 'source', f.source, 'state', v_state,
      'access', policy_commission_authz.access(v.uid), 'credited_agent_id', v.uid, 'win_id', f.win_id, 'basis', v_basis,
      'estimate', v_est, 'capture', v_cap),
    'contact', policy_commission_reporting.contact_json(f),
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now()));
END $$;

-- ── 4. Execution rights: authenticated only (Supabase default privileges would grant every client role) ─────────
DO $acl$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p WHERE p.oid NOT IN (SELECT oid FROM policy_commission_center_preexisting)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $acl$;

COMMENT ON SCHEMA policy_commission_reporting IS
  'Commissions center: shared read definitions (SECURITY INVOKER, STABLE). Not exposed by PostgREST. Plan: docs/plans/2026-10-20-commissions-center.';
COMMENT ON FUNCTION public.get_my_commission_overview(text, date, date) IS
  'My commissions overview: Expected, Received, Remaining, Next 90 days, timeline, review counts and upcoming payments for the signed-in seller. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_commission_installments(text, date, date, text, text, text, text, integer, integer) IS
  'My commissions: one row per scheduled installment of current estimates, filtered and paginated, with totals over the whole filter. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_commission_receipts(text, date, date, boolean, integer, integer) IS
  'My commissions: one row per manually recorded receipt, paginated, with totals over the whole filter. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_commission_policies(text, text, integer, integer) IS
  'My commissions: one row per eligible policy credited to the signed-in seller, with setup state. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_policy_commission(uuid) IS
  'My commissions drawer: one policy in the get_client_policy_commissions shape plus a contact reference when the client is visible. SECURITY INVOKER; reads only.';
