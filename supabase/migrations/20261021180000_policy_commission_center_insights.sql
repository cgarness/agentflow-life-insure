-- Commissions Overview insights: carrier and product breakdowns, comparisons, the next month's Months 10–12, the
-- breakdown drill-down lists and an optional owner-only monthly commission goal ("My commissions").
-- Contract: docs/plans/2026-10-21-commissions-insights/implementation_plan.md §2–§5.
-- Approved for LOCAL build and disposable-database testing only. Production application (the new table, its RLS
-- policy and grants, and the functions) requires Chris's separate exact-action approval. Additive only: no existing
-- function, table, column, policy, grant or row changes. Reads are SECURITY INVOKER and STABLE over the released
-- 20261020212000 definitions; the two goal writes are SECURITY INVOKER and touch only the caller's own goal row.
-- Estimates are AgentFlow projections and receipts are manual records; neither is carrier-verified, earned, paid,
-- payroll or booked commission. A goal is a personal target measured by recorded receipts.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE policy_commission_insights_preexisting ON COMMIT DROP AS SELECT oid FROM pg_catalog.pg_proc;

-- ── 0. Prerequisite, preimage and replay guards ──────────────────────────────────────────────────────────────────
DO $guard$
DECLARE r record;
BEGIN
  IF to_regnamespace('policy_commission_reporting') IS NULL
     OR to_regprocedure('public.get_my_commission_overview(text,date,date)') IS NULL THEN
    RAISE EXCEPTION 'commissions insights require 20261020212000';
  END IF;
  IF to_regnamespace('policy_commission_insights') IS NOT NULL OR to_regclass('public.policy_commission_goals') IS NOT NULL THEN
    RAISE EXCEPTION 'commissions insights are already applied; refusing replay';
  END IF;
  -- The released definitions these functions reuse, exactly as the applied migrations left them.
  FOR r IN SELECT * FROM (VALUES
      ('policy_commission_authz.actor_org()', '29be135fe6edfb5082838eeb22d48790'),
      ('policy_commission_authz.access(uuid)', 'a6da4418b7010c609d5be650615ae643'),
      ('policy_commission_reporting.viewer()', 'b6cfc70bebf0a007f303d486e81748bf'),
      ('policy_commission_reporting.period(text,date,date,date,integer)', 'bc9273191bc4ea2b519306cfa069c9d3'),
      ('policy_commission_reporting.installments(uuid,uuid,date,uuid[])', 'b661f4fd5fc186849c0834c47f446605'),
      ('policy_commission_reporting.policies(uuid,uuid,uuid)', '58e2a95cb1975631d9e1daaafd1599c5'),
      ('policy_commission_reporting.contact_json(policy_commission_reporting.policy_fact)', 'd7121baae9f0d8ace15829cd0ad32eab'),
      ('policy_commission_reporting.iso_or_null(text)', '4425715c96469e3fc43ff3bdde081045')) v(fn, digest)
  LOOP
    IF to_regprocedure(r.fn) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.fn))) <> r.digest THEN
      RAISE EXCEPTION 'commissions insights: % differs from the reviewed preimage; refusing', r.fn;
    END IF;
  END LOOP;
END $guard$;

-- ── 1. Monthly commission goals: one optional target per organization, owner and agency calendar month ──────────
-- Owner-only. No admin, Team Leader, Agency Group or service-role access; nothing is created by reading.
CREATE TABLE public.policy_commission_goals (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id        uuid        NOT NULL,
  month           date        NOT NULL CHECK (extract(day FROM month) = 1 AND month BETWEEN DATE '2000-01-01' AND DATE '2100-12-01'),
  target_cents    bigint      NOT NULL CHECK (target_cents BETWEEN 1 AND 100000000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_commission_goals_pkey PRIMARY KEY (organization_id, owner_id, month)
);
ALTER TABLE public.policy_commission_goals ENABLE ROW LEVEL SECURITY;
-- Supabase default privileges would grant every client role ALL on a new public table; start from nothing.
REVOKE ALL ON public.policy_commission_goals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.policy_commission_goals TO authenticated;
GRANT UPDATE (target_cents, updated_at) ON public.policy_commission_goals TO authenticated;
CREATE POLICY policy_commission_goals_owner ON public.policy_commission_goals FOR ALL TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND organization_id = (SELECT policy_commission_authz.actor_org())
         AND policy_commission_authz.access((SELECT auth.uid())) = 'write')
  WITH CHECK (owner_id = (SELECT auth.uid()) AND organization_id = (SELECT policy_commission_authz.actor_org())
              AND policy_commission_authz.access((SELECT auth.uid())) = 'write');

-- ── 2. Shared definitions (not exposed by PostgREST; USAGE for authenticated only) ──────────────────────────────
CREATE SCHEMA policy_commission_insights;
REVOKE ALL ON SCHEMA policy_commission_insights FROM PUBLIC;
GRANT USAGE ON SCHEMA policy_commission_insights TO authenticated;

-- Carrier identity: letter case and surrounding spaces only (the released carrier filters' rule). Never fuzzy.
CREATE FUNCTION policy_commission_insights.carrier_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT lower(nullif(btrim(p), ''))
$$;

-- Mutually exclusive product categories from a stored CRM policy type, normalized by case and spacing only. NULL when
-- blank; any other type is 'other'. A comp-grid category is never an input: a whole-life grid product also serves
-- Final Expense sales, so it cannot tell them apart.
CREATE FUNCTION policy_commission_insights.category(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))
           WHEN '' THEN NULL WHEN 'term' THEN 'term' WHEN 'whole life' THEN 'whole_life' WHEN 'iul' THEN 'iul'
           WHEN 'final expense' THEN 'final_expense' ELSE 'other' END
$$;

-- A policy's category: the sale's own snapshot first, then the client record only when the viewer can open that
-- contact today, else unknown.
CREATE FUNCTION policy_commission_insights.policy_category(f policy_commission_reporting.policy_fact)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(policy_commission_insights.category(f.win_policy_type),
                  CASE WHEN f.contact_visible THEN policy_commission_insights.category(f.policy_type) END, 'unknown')
$$;

-- A policy's carrier: the current estimate's saved carrier first, then the visible client record, else NULL (unknown).
-- Identical to the released Policies list's shown carrier.
CREATE FUNCTION policy_commission_insights.policy_carrier(f policy_commission_reporting.policy_fact)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(nullif(btrim(f.product_carrier), ''), CASE WHEN f.contact_visible THEN nullif(btrim(f.carrier), '') END)
$$;

-- The fair comparison for a period [p_from, p_to] on the agency date p_today (plan §2):
--   future (starts after today) → no comparison;
--   whole calendar months: ended → the same number of whole months before; in progress → first day to today against
--     the same elapsed portion one span earlier (days clamp to month end, so Mar 31 compares with Feb 28 or 29);
--   any other range: ended → the equal-length range before; in progress → start to today against the equal-length
--     range before that.
CREATE FUNCTION policy_commission_insights.comparison(p_from date, p_to date, p_today date)
RETURNS TABLE (basis text, cur_from date, cur_to date, prev_from date, prev_to date)
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE n integer; v_end date;
BEGIN
  IF p_from > p_today THEN
    RETURN QUERY SELECT 'future'::text, NULL::date, NULL::date, NULL::date, NULL::date;
    RETURN;
  END IF;
  IF extract(day FROM p_from) = 1 AND extract(day FROM p_to + 1) = 1 THEN
    n := (extract(year FROM p_to)::integer - extract(year FROM p_from)::integer) * 12
         + extract(month FROM p_to)::integer - extract(month FROM p_from)::integer + 1;
    IF p_to <= p_today THEN
      RETURN QUERY SELECT 'months'::text, p_from, p_to, (p_from - make_interval(months => n))::date, p_from - 1;
    ELSE
      RETURN QUERY SELECT 'months_to_date'::text, p_from, p_today, (p_from - make_interval(months => n))::date,
                          (p_today - make_interval(months => n))::date;
    END IF;
  ELSE
    v_end := least(p_to, p_today);
    RETURN QUERY SELECT CASE WHEN p_to <= p_today THEN 'days' ELSE 'days_to_date' END, p_from, v_end,
                        p_from - (v_end - p_from + 1), p_from - 1;
  END IF;
END $$;

-- A goal month: the first day of a calendar month, 2000-01 to 2100-12.
CREATE FUNCTION policy_commission_insights.goal_month(p_month date)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 OR p_month < DATE '2000-01-01' OR p_month > DATE '2100-12-01' THEN
    RAISE EXCEPTION 'Choose a calendar month' USING ERRCODE = '22023';
  END IF;
  RETURN p_month;
END $$;

-- ── 3. Public reads (SECURITY INVOKER, STABLE; EXECUTE authenticated only) ──────────────────────────────────────

-- Overview breakdowns for a period (≤ 731 days, like the Overview): the sales cohort by Sold Date (policies with or
-- without an estimate; saved first-year estimates of ACTIVE estimates, held ones disclosed), the period's receipts by
-- received date, both grouped by carrier, the cohort by product category, the fair comparison and the next agency
-- month's remaining Months 10–12. Unknown carriers and categories are their own groups.
CREATE FUNCTION public.get_my_commission_breakdown(p_period text DEFAULT 'this_month', p_from date DEFAULT NULL,
  p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; p record; c record; nm record; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, 731);
  SELECT * INTO c FROM policy_commission_insights.comparison(p.from_on, p.to_on, v.today);
  SELECT * INTO nm FROM policy_commission_reporting.period('next_month', NULL, NULL, v.today, NULL);

  WITH pol AS MATERIALIZED (
    SELECT x.policy_id, x.sold_date, x.estimate_status, x.first_year_cents, x.capture_status,
           policy_commission_insights.policy_carrier(x) AS carrier, policy_commission_insights.policy_category(x) AS category
      FROM policy_commission_reporting.policies(v.uid, v.org) x),
  sold AS (SELECT * FROM pol WHERE sold_date BETWEEN p.from_on AND p.to_on),
  -- One row per valid receipt (each has exactly one estimate), so no amount is repeated.
  rec AS MATERIALIZED (
    SELECT r.received_on, r.amount_cents, nullif(btrim(e.product_carrier), '') AS carrier
      FROM public.policy_commission_receipts r
      LEFT JOIN public.policy_commission_estimates e ON e.id = r.estimate_id AND e.organization_id = r.organization_id
     WHERE r.organization_id = v.org AND r.credited_agent_id = v.uid AND r.voided_at IS NULL
       AND (r.received_on BETWEEN p.from_on AND p.to_on OR r.received_on BETWEEN c.prev_from AND c.prev_to)),
  rec_now AS (SELECT * FROM rec WHERE received_on BETWEEN p.from_on AND p.to_on),
  names AS (
    SELECT policy_commission_insights.carrier_key(n.carrier) AS k, mode() WITHIN GROUP (ORDER BY n.carrier) AS label
      FROM (SELECT carrier FROM sold UNION ALL SELECT carrier FROM rec_now) n GROUP BY 1),
  by_carrier AS (
    SELECT policy_commission_insights.carrier_key(s.carrier) AS k, count(DISTINCT s.policy_id) AS policies,
           count(*) FILTER (WHERE s.estimate_status = 'active') AS with_estimate,
           coalesce(sum(s.first_year_cents) FILTER (WHERE s.estimate_status = 'active'), 0) AS estimate_cents,
           count(*) FILTER (WHERE s.estimate_status = 'on_hold') AS on_hold,
           coalesce(sum(s.first_year_cents) FILTER (WHERE s.estimate_status = 'on_hold'), 0) AS on_hold_cents,
           count(*) FILTER (WHERE s.estimate_status IS NULL) AS without_estimate
      FROM sold s GROUP BY 1),
  received_by_carrier AS (
    SELECT policy_commission_insights.carrier_key(r.carrier) AS k, sum(r.amount_cents) AS received, count(*) AS n
      FROM rec_now r GROUP BY 1),
  by_category AS (
    SELECT s.category, count(DISTINCT s.policy_id) AS policies,
           count(*) FILTER (WHERE s.estimate_status = 'active') AS with_estimate,
           coalesce(sum(s.first_year_cents) FILTER (WHERE s.estimate_status = 'active'), 0) AS estimate_cents,
           count(*) FILTER (WHERE s.estimate_status = 'on_hold') AS on_hold,
           coalesce(sum(s.first_year_cents) FILTER (WHERE s.estimate_status = 'on_hold'), 0) AS on_hold_cents,
           count(*) FILTER (WHERE s.estimate_status IS NULL) AS without_estimate
      FROM sold s GROUP BY 1),
  m1012 AS (
    SELECT coalesce(sum(f.remaining_cents), 0) AS remaining, count(*) AS payments, count(DISTINCT f.policy_id) AS policies
      FROM policy_commission_reporting.installments(v.uid, v.org, v.today) f
     WHERE f.estimate_status = 'active' AND f.kind <> 'advance' AND f.remaining_cents > 0
       AND f.window_start BETWEEN nm.from_on AND nm.to_on)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'period', coalesce(p_period, 'this_month'),
             'from', p.from_on, 'to', p.to_on),
    'sold', (SELECT jsonb_build_object('policies', count(DISTINCT s.policy_id),
               'with_estimate_count', count(*) FILTER (WHERE s.estimate_status = 'active'),
               'estimate_cents', coalesce(sum(s.first_year_cents) FILTER (WHERE s.estimate_status = 'active'), 0),
               'on_hold_count', count(*) FILTER (WHERE s.estimate_status = 'on_hold'),
               'on_hold_cents', coalesce(sum(s.first_year_cents) FILTER (WHERE s.estimate_status = 'on_hold'), 0),
               'without_estimate_count', count(*) FILTER (WHERE s.estimate_status IS NULL),
               'needs_review_count', count(*) FILTER (WHERE s.estimate_status IS NULL AND s.capture_status IS NOT NULL),
               'undated_count', (SELECT count(*) FROM pol WHERE pol.sold_date IS NULL)) FROM sold s),
    'received', (SELECT jsonb_build_object('received_cents', coalesce(sum(r.amount_cents), 0), 'receipt_count', count(*)) FROM rec_now r),
    'carriers', (SELECT coalesce(jsonb_agg(jsonb_build_object('carrier', n.label, 'policies', coalesce(b.policies, 0),
                   'with_estimate_count', coalesce(b.with_estimate, 0), 'estimate_cents', coalesce(b.estimate_cents, 0),
                   'on_hold_count', coalesce(b.on_hold, 0), 'on_hold_cents', coalesce(b.on_hold_cents, 0),
                   'without_estimate_count', coalesce(b.without_estimate, 0),
                   'received_cents', coalesce(rc.received, 0), 'receipt_count', coalesce(rc.n, 0))
                 ORDER BY n.k NULLS LAST), '[]'::jsonb)
                   FROM names n LEFT JOIN by_carrier b ON b.k IS NOT DISTINCT FROM n.k
                   LEFT JOIN received_by_carrier rc ON rc.k IS NOT DISTINCT FROM n.k),
    'products', (SELECT coalesce(jsonb_agg(jsonb_build_object('category', b.category, 'policies', b.policies,
                   'with_estimate_count', b.with_estimate, 'estimate_cents', b.estimate_cents, 'on_hold_count', b.on_hold,
                   'on_hold_cents', b.on_hold_cents, 'without_estimate_count', b.without_estimate)
                 ORDER BY array_position(ARRAY['term', 'whole_life', 'iul', 'final_expense', 'other', 'unknown'], b.category)), '[]'::jsonb)
                   FROM by_category b),
    'comparison', CASE WHEN c.basis = 'future' THEN NULL ELSE jsonb_build_object('basis', c.basis,
      'current', (SELECT jsonb_build_object('from', c.cur_from, 'to', c.cur_to, 'policies', count(DISTINCT o.policy_id),
                    'with_estimate_count', count(*) FILTER (WHERE o.estimate_status = 'active'),
                    'estimate_cents', coalesce(sum(o.first_year_cents) FILTER (WHERE o.estimate_status = 'active'), 0),
                    'received_cents', (SELECT coalesce(sum(r.amount_cents), 0) FROM rec r WHERE r.received_on BETWEEN c.cur_from AND c.cur_to),
                    'receipt_count', (SELECT count(*) FROM rec r WHERE r.received_on BETWEEN c.cur_from AND c.cur_to))
                    FROM pol o WHERE o.sold_date BETWEEN c.cur_from AND c.cur_to),
      'previous', (SELECT jsonb_build_object('from', c.prev_from, 'to', c.prev_to, 'policies', count(DISTINCT o.policy_id),
                    'with_estimate_count', count(*) FILTER (WHERE o.estimate_status = 'active'),
                    'estimate_cents', coalesce(sum(o.first_year_cents) FILTER (WHERE o.estimate_status = 'active'), 0),
                    'received_cents', (SELECT coalesce(sum(r.amount_cents), 0) FROM rec r WHERE r.received_on BETWEEN c.prev_from AND c.prev_to),
                    'receipt_count', (SELECT count(*) FROM rec r WHERE r.received_on BETWEEN c.prev_from AND c.prev_to))
                    FROM pol o WHERE o.sold_date BETWEEN c.prev_from AND c.prev_to)) END,
    'months_10_12', (SELECT jsonb_build_object('from', nm.from_on, 'to', nm.to_on, 'remaining_cents', m.remaining,
                       'payment_count', m.payments, 'policy_count', m.policies) FROM m1012 m))
    INTO v_out;
  RETURN v_out;
END $$;

-- The Policies list with the breakdown drill-down filters: the released setup and carrier filters, plus an unknown
-- carrier, a product category and a Sold Date period ('all' = no date filter, so undated policies stay listed).
-- Totals cover the whole filter with the breakdown's definitions, so each bar or slice equals its list.
CREATE FUNCTION public.get_my_commission_policy_list(p_setup text DEFAULT 'all', p_carrier text DEFAULT NULL,
  p_carrier_unknown boolean DEFAULT false, p_category text DEFAULT NULL, p_period text DEFAULT 'all', p_from date DEFAULT NULL,
  p_to date DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; p record; v_carrier text := policy_commission_insights.carrier_key(p_carrier);
  v_all boolean := coalesce(p_period, 'all') = 'all'; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO p FROM policy_commission_reporting.period(coalesce(p_period, 'all'), p_from, p_to, v.today, NULL);
  IF p_setup IS NULL OR p_setup NOT IN ('all', 'missing', 'needs_review', 'recorded', 'on_hold') THEN
    RAISE EXCEPTION 'Unknown setup filter' USING ERRCODE = '22023';
  END IF;
  IF p_carrier_unknown IS NULL OR (p_carrier_unknown AND v_carrier IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose one carrier, or Unknown carrier' USING ERRCODE = '22023';
  END IF;
  IF p_category IS NOT NULL AND p_category NOT IN ('term', 'whole_life', 'iul', 'final_expense', 'other', 'unknown') THEN
    RAISE EXCEPTION 'Unknown product type' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  WITH pol AS MATERIALIZED (SELECT x AS pf FROM policy_commission_reporting.policies(v.uid, v.org) x),
  rows AS (
    SELECT o.pf,
           CASE WHEN (o.pf).estimate_status = 'on_hold' THEN 'on_hold' WHEN (o.pf).estimate_id IS NOT NULL THEN 'recorded'
                WHEN (o.pf).capture_status IS NOT NULL THEN 'needs_review' ELSE 'missing' END AS setup,
           policy_commission_insights.policy_carrier(o.pf) AS shown_carrier,
           policy_commission_insights.policy_category(o.pf) AS category
      FROM pol o),
  matched AS (
    SELECT * FROM rows r
     WHERE (p_setup = 'all' OR r.setup = p_setup OR (p_setup = 'recorded' AND r.setup = 'on_hold'))
       AND (v_carrier IS NULL OR policy_commission_insights.carrier_key(r.shown_carrier) = v_carrier)
       AND (NOT p_carrier_unknown OR r.shown_carrier IS NULL)
       AND (p_category IS NULL OR r.category = p_category)
       AND (v_all OR (r.pf).sold_date BETWEEN p.from_on AND p.to_on)),
  page AS (
    SELECT * FROM matched m ORDER BY (m.pf).sold_date DESC NULLS LAST, (m.pf).sale_created_at DESC, (m.pf).policy_id
     LIMIT p_limit OFFSET p_offset),
  inst AS MATERIALIZED (
    SELECT * FROM policy_commission_reporting.installments(v.uid, v.org, v.today, (SELECT array_agg((g.pf).policy_id) FROM page g))),
  nxt AS (
    SELECT DISTINCT ON (n.policy_id) n.policy_id, jsonb_build_object('kind', n.kind, 'timing_precision', n.timing_precision,
             'expected_on', n.expected_on, 'expected_until', n.expected_until, 'remaining_cents', n.remaining_cents,
             'status', n.status) AS next_payment
      FROM inst n WHERE n.remaining_cents > 0
     ORDER BY n.policy_id, n.sequence),
  agg AS (
    SELECT f.policy_id, sum(f.received_cents)::bigint AS received, sum(f.remaining_cents)::bigint AS remaining,
           sum(f.excess_cents)::bigint AS excess, count(*) FILTER (WHERE f.status = 'date_needed') AS date_needed
      FROM inst f GROUP BY f.policy_id)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'setup', p_setup,
             'carrier', p_carrier, 'carrier_unknown', p_carrier_unknown, 'category', p_category,
             'period', coalesce(p_period, 'all'), 'from', CASE WHEN NOT v_all THEN p.from_on END,
             'to', CASE WHEN NOT v_all THEN p.to_on END, 'limit', p_limit, 'offset', p_offset),
    'total_count', (SELECT count(*) FROM matched),
    'totals', (SELECT jsonb_build_object('policies', count(*),
                 'with_estimate_count', count(*) FILTER (WHERE (m.pf).estimate_status = 'active'),
                 'estimate_cents', coalesce(sum((m.pf).first_year_cents) FILTER (WHERE (m.pf).estimate_status = 'active'), 0),
                 'on_hold_count', count(*) FILTER (WHERE (m.pf).estimate_status = 'on_hold'),
                 'on_hold_cents', coalesce(sum((m.pf).first_year_cents) FILTER (WHERE (m.pf).estimate_status = 'on_hold'), 0),
                 'without_estimate_count', count(*) FILTER (WHERE (m.pf).estimate_id IS NULL)) FROM matched m),
    'counts', (SELECT jsonb_build_object('eligible_count', count(*), 'with_estimate_count', count(*) FILTER (WHERE setup IN ('recorded', 'on_hold')),
                 'missing_count', count(*) FILTER (WHERE setup = 'missing'), 'needs_review_count', count(*) FILTER (WHERE setup = 'needs_review'),
                 'on_hold_count', count(*) FILTER (WHERE setup = 'on_hold')) FROM rows),
    'carriers', (SELECT coalesce(jsonb_agg(d.label ORDER BY lower(d.label), d.label), '[]'::jsonb)
                   FROM (SELECT mode() WITHIN GROUP (ORDER BY r.shown_carrier) AS label FROM rows r WHERE r.shown_carrier IS NOT NULL
                          GROUP BY policy_commission_insights.carrier_key(r.shown_carrier)) d),
    'has_unknown_carrier', (SELECT EXISTS (SELECT 1 FROM rows r WHERE r.shown_carrier IS NULL)),
    'rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('policy_id', (g.pf).policy_id, 'setup', g.setup,
                 'contact', policy_commission_reporting.contact_json(g.pf), 'source', (g.pf).source, 'carrier', g.shown_carrier,
                 'product', coalesce(nullif(btrim((g.pf).product_name), ''), nullif(btrim((g.pf).policy_type), '')),
                 'category', g.category, 'sold_date', (g.pf).sold_date,
                 'effective_date', policy_commission_reporting.iso_or_null((g.pf).effective_date),
                 'estimate_cents', (g.pf).first_year_cents, 'received_cents', a.received, 'remaining_cents', a.remaining,
                 'excess_cents', a.excess, 'date_needed_count', coalesce(a.date_needed, 0), 'next_payment', nx.next_payment)
               ORDER BY (g.pf).sold_date DESC NULLS LAST, (g.pf).sale_created_at DESC, (g.pf).policy_id), '[]'::jsonb)
               FROM page g LEFT JOIN agg a ON a.policy_id = (g.pf).policy_id LEFT JOIN nxt nx ON nx.policy_id = (g.pf).policy_id))
    INTO v_out;
  RETURN v_out;
END $$;

-- The History list with the Received-by-carrier drill-down: the released receipt list plus a carrier filter on the
-- receipt's own estimate (or its unknown carrier). Totals cover the whole filter.
CREATE FUNCTION public.get_my_commission_receipt_list(p_period text DEFAULT 'this_month', p_from date DEFAULT NULL,
  p_to date DEFAULT NULL, p_include_voided boolean DEFAULT false, p_carrier text DEFAULT NULL,
  p_carrier_unknown boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; p record; v_carrier text := policy_commission_insights.carrier_key(p_carrier); v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, NULL);
  IF p_include_voided IS NULL THEN RAISE EXCEPTION 'Choose whether to include voided payments' USING ERRCODE = '22023'; END IF;
  IF p_carrier_unknown IS NULL OR (p_carrier_unknown AND v_carrier IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose one carrier, or Unknown carrier' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  WITH mine AS (
    SELECT r.id, r.received_on, r.recorded_at, r.amount_cents, r.voided_at, r.void_reason, r.replaces_receipt_id,
           r.policy_id, r.installment_id, r.estimate_id, i.kind, e.status AS estimate_status, e.product_carrier, e.product_name,
           nullif(btrim(e.product_carrier), '') AS shown_carrier
      FROM public.policy_commission_receipts r
      JOIN public.policy_commission_installments i
        ON i.id = r.installment_id AND i.estimate_id = r.estimate_id AND i.organization_id = r.organization_id
      JOIN public.policy_commission_estimates e ON e.id = r.estimate_id AND e.organization_id = r.organization_id
     WHERE r.organization_id = v.org AND r.credited_agent_id = v.uid),
  rows AS (
    SELECT * FROM mine m
     WHERE m.received_on BETWEEN p.from_on AND p.to_on AND (p_include_voided OR m.voided_at IS NULL)
       AND (v_carrier IS NULL OR policy_commission_insights.carrier_key(m.shown_carrier) = v_carrier)
       AND (NOT p_carrier_unknown OR m.shown_carrier IS NULL)),
  page AS (
    SELECT x.*, (SELECT n.id FROM public.policy_commission_receipts n
                  WHERE n.replaces_receipt_id = x.id AND n.organization_id = v.org) AS replaced_by,
           (SELECT policy_commission_reporting.contact_json(pf)
              FROM policy_commission_reporting.policies(v.uid, v.org, x.policy_id) pf) AS contact
      FROM rows x ORDER BY x.received_on DESC, x.recorded_at DESC, x.id LIMIT p_limit OFFSET p_offset)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'period', coalesce(p_period, 'this_month'),
             'from', p.from_on, 'to', p.to_on, 'include_voided', p_include_voided, 'carrier', p_carrier,
             'carrier_unknown', p_carrier_unknown, 'limit', p_limit, 'offset', p_offset),
    'total_count', (SELECT count(*) FROM rows),
    'totals', (SELECT jsonb_build_object('received_cents', coalesce(sum(amount_cents) FILTER (WHERE voided_at IS NULL), 0),
                 'valid_count', count(*) FILTER (WHERE voided_at IS NULL), 'voided_count', count(*) FILTER (WHERE voided_at IS NOT NULL))
                 FROM rows),
    'carriers', (SELECT coalesce(jsonb_agg(d.label ORDER BY lower(d.label), d.label), '[]'::jsonb)
                   FROM (SELECT mode() WITHIN GROUP (ORDER BY m.shown_carrier) AS label FROM mine m WHERE m.shown_carrier IS NOT NULL
                          GROUP BY policy_commission_insights.carrier_key(m.shown_carrier)) d),
    'has_unknown_carrier', (SELECT EXISTS (SELECT 1 FROM mine m WHERE m.shown_carrier IS NULL)),
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

-- The caller's goal for one agency calendar month (target_cents is null when none is set). Never creates a goal.
CREATE FUNCTION public.get_my_commission_goal(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; m date; g record;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  m := policy_commission_insights.goal_month(p_month);
  SELECT x.target_cents, x.updated_at INTO g FROM public.policy_commission_goals x
   WHERE x.organization_id = v.org AND x.owner_id = v.uid AND x.month = m;
  RETURN jsonb_build_object('month', m, 'target_cents', g.target_cents, 'updated_at', g.updated_at,
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now()));
END $$;

-- Sets or edits the caller's goal for exactly that month (an idempotent upsert of one row; other months untouched).
CREATE FUNCTION public.set_my_commission_goal(p_month date, p_target_cents bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; m date; g record;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  m := policy_commission_insights.goal_month(p_month);
  IF p_target_cents IS NULL OR p_target_cents NOT BETWEEN 1 AND 100000000 THEN
    RAISE EXCEPTION 'Enter a goal above $0.00 (up to $1,000,000.00).' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.policy_commission_goals AS x (organization_id, owner_id, month, target_cents)
  VALUES (v.org, v.uid, m, p_target_cents)
  ON CONFLICT (organization_id, owner_id, month) DO UPDATE SET target_cents = excluded.target_cents, updated_at = now()
  RETURNING x.target_cents, x.updated_at INTO g;
  RETURN jsonb_build_object('month', m, 'target_cents', g.target_cents, 'updated_at', g.updated_at);
END $$;

-- Clears the caller's goal for exactly that month (an explicit action; clearing a month without a goal is a no-op).
CREATE FUNCTION public.clear_my_commission_goal(p_month date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v record; m date; n integer;
BEGIN
  SELECT * INTO v FROM policy_commission_reporting.viewer();
  m := policy_commission_insights.goal_month(p_month);
  DELETE FROM public.policy_commission_goals x WHERE x.organization_id = v.org AND x.owner_id = v.uid AND x.month = m;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('month', m, 'cleared', n > 0);
END $$;

-- ── 4. Execution rights: authenticated only (Supabase default privileges would grant every client role) ─────────
DO $acl$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p WHERE p.oid NOT IN (SELECT oid FROM policy_commission_insights_preexisting)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $acl$;

COMMENT ON TABLE public.policy_commission_goals IS
  'My commissions: optional monthly commission goal per organization, owner and agency calendar month, measured by recorded receipts. Owner-only RLS. Plan: docs/plans/2026-10-21-commissions-insights.';
COMMENT ON SCHEMA policy_commission_insights IS
  'Commissions insights: shared helpers (carrier identity, product category, fair comparison, goal month). Not exposed by PostgREST.';
COMMENT ON FUNCTION public.get_my_commission_breakdown(text, date, date) IS
  'My commissions breakdowns: sales cohort by Sold Date and receipts by received date, by carrier and product, with comparison and next month''s Months 10–12. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_commission_policy_list(text, text, boolean, text, text, date, date, integer, integer) IS
  'My commissions: eligible policies with setup, carrier, product category and Sold Date filters and whole-filter totals. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_commission_receipt_list(text, date, date, boolean, text, boolean, integer, integer) IS
  'My commissions: recorded receipts with period, voided and carrier filters and whole-filter totals. SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.get_my_commission_goal(date) IS
  'My commissions: the caller''s goal for one calendar month (null when none). SECURITY INVOKER; reads only.';
COMMENT ON FUNCTION public.set_my_commission_goal(date, bigint) IS
  'My commissions: sets the caller''s goal for one calendar month only. SECURITY INVOKER under owner-only RLS.';
COMMENT ON FUNCTION public.clear_my_commission_goal(date) IS
  'My commissions: clears the caller''s goal for one calendar month only. SECURITY INVOKER under owner-only RLS.';
