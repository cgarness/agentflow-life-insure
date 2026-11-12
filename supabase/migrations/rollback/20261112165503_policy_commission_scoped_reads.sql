-- Guarded Team Commissions database rollback. Production execution needs separate exact approval.
-- Restores the ten CURRENT captured preimages from e07d28bd/live readback; no business rows are deleted.
-- Run atomically after containing every affected entry point, including legacy My readers for an auth defect.
-- Ordinary frontend rollback: restore compatible personal frontend first. Do not replay historical migrations.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '120s';
DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_scoped_policy_commission(text,uuid[],uuid)', '819c750c61a1d0509a3921514e8e3ef2', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.read_policies(text,uuid[],text,text,integer,integer,boolean)', '570a3a1585f0703f988592dea09fafb6', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_commission_agent_scope(text,integer,integer,text,uuid[])', 'c3ab5f0bfb1978fddbd438f2ce30e077', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.viewer(text,uuid[])', '378c1226266f3daa1ad4fba73e81c5f2', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.read_overview(text,uuid[],text,date,date,boolean)', '5482cf66e308ae04508a6088c3fae732', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_scoped_commission_overview(text,uuid[],text,date,date)', '804245059bc2aa2432791117ce3c74b6', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp", "statement_timeout=40s"]'),
    ('policy_commission_scoped.read_installments(text,uuid[],text,date,date,text,text,text,text,integer,integer,boolean)', 'ea5b56b161b33342f66b08ad93d54936', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_scoped_commission_policy_list(text,uuid[],text,text,boolean,text,text,date,date,integer,integer)', 'fc5a9b6961b8933873fb7c91c742baa0', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp", "statement_timeout=40s"]'),
    ('policy_commission_scoped.read_breakdown(text,uuid[],text,date,date,boolean)', 'a4c97ed098b646a48b89faec77d892ab', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_scoped_commission_breakdown(text,uuid[],text,date,date)', '9a1a015e790fe3d3d7a487bd97f26560', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp", "statement_timeout=20s"]'),
    ('public.get_scoped_commission_receipt_list(text,uuid[],text,date,date,boolean,text,boolean,integer,integer)', '625861aa2293981965f43d3143a7e084', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.read_policy_detail(text,uuid[],uuid,boolean)', '9aae4e996f3417a95628628c6c371df5', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.resolve_scope(text,uuid[])', '838a8e2a0760e3eb71544e59ed00a38a', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.policies(text,uuid[],uuid,uuid[])', '5ad4e133b1be417aa9fcea399e9bdb36', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.installments(text,uuid[],date,uuid[],date,date,text,boolean)', 'b93ed60e533c243687245b4bc2adc8df', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.read_receipt_list(text,uuid[],text,date,date,boolean,text,boolean,integer,integer,boolean)', '8a74df542d315f88fbe38508415b3f41', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_scoped_commission_installments(text,uuid[],text,date,date,text,text,text,text,integer,integer)', '873863d814257a2e15528d13b730707d', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp", "statement_timeout=40s"]'),
    ('policy_commission_scoped.read_receipts(text,uuid[],text,date,date,boolean,integer,integer,boolean)', '11fd48c7abf2670f548f35e9c92c7638', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_scoped.read_policy_list(text,uuid[],text,text,boolean,text,text,date,date,integer,integer,boolean)', '2b74ef07cf1c73669f5d7131f50a4421', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_overview(text,date,date)', 'b7fdb4cf6774cd602310ef3f6e0542de', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_breakdown(text,date,date)', '873cd4448ac0e5ae9afd7aa2dba55cc4', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_policy_commission(uuid)', 'f46f80066141eb4619432ac15eac2a30', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_reporting.policies(uuid,uuid,uuid)', '7d607a2a8842683ce052687932b03a41', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_receipts(text,date,date,boolean,integer,integer)', '574fe1fc0f6ab66fb3f7c5763771f5aa', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_installments(text,date,date,text,text,text,text,integer,integer)', 'e2978a44f3e584df53dcbf5ab4c2941f', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer)', '0efdbd5f2920846c9a9b36203d788b9a', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_reporting.installments(uuid,uuid,date,uuid[])', 'bf500a61127e483a68379d460f6e4b14', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer)', 'f9b6c1f060b38f876a3ec52b26550881', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_policies(text,text,integer,integer)', '4fd4eb5a1f5fcd911df7b9b7124f3fc2', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]')) p(fn,digest,owner_name,acl,config)
  LOOP
    IF to_regprocedure(r.fn) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.digest
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.owner_name
       OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.acl
       OR (SELECT to_jsonb(proconfig) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.config::jsonb THEN
      RAISE EXCEPTION 'Team Commissions recovery definition/security drift: %',r.fn USING ERRCODE='55000';
    END IF;
  END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_my_commission_overview(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_installments(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_scope text DEFAULT 'range'::text, p_status text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_receipts(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_policies(p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
      FROM inst n WHERE n.remaining_cents > 0
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_breakdown(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_policy_list(p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_category text DEFAULT NULL::text, p_period text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_receipt_list(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_policy_commission(p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION policy_commission_reporting.policies(p_uid uuid, p_org uuid, p_policy uuid DEFAULT NULL::uuid)
 RETURNS SETOF policy_commission_reporting.policy_fact
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION policy_commission_reporting.installments(p_uid uuid, p_org uuid, p_today date, p_policies uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF policy_commission_reporting.installment_fact
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
$function$;
DROP FUNCTION public.get_commission_agent_scope(text,integer,integer,text,uuid[]) RESTRICT;
DROP FUNCTION public.get_scoped_commission_breakdown(text,uuid[],text,date,date) RESTRICT;
DROP FUNCTION public.get_scoped_commission_installments(text,uuid[],text,date,date,text,text,text,text,integer,integer) RESTRICT;
DROP FUNCTION public.get_scoped_commission_overview(text,uuid[],text,date,date) RESTRICT;
DROP FUNCTION public.get_scoped_commission_policy_list(text,uuid[],text,text,boolean,text,text,date,date,integer,integer) RESTRICT;
DROP FUNCTION public.get_scoped_commission_receipt_list(text,uuid[],text,date,date,boolean,text,boolean,integer,integer) RESTRICT;
DROP FUNCTION public.get_scoped_policy_commission(text,uuid[],uuid) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_breakdown(text,uuid[],text,date,date,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_installments(text,uuid[],text,date,date,text,text,text,text,integer,integer,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_overview(text,uuid[],text,date,date,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_policies(text,uuid[],text,text,integer,integer,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_policy_detail(text,uuid[],uuid,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_policy_list(text,uuid[],text,text,boolean,text,text,date,date,integer,integer,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_receipt_list(text,uuid[],text,date,date,boolean,text,boolean,integer,integer,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.read_receipts(text,uuid[],text,date,date,boolean,integer,integer,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.installments(text,uuid[],date,uuid[],date,date,text,boolean) RESTRICT;
DROP FUNCTION policy_commission_scoped.policies(text,uuid[],uuid,uuid[]) RESTRICT;
DROP FUNCTION policy_commission_scoped.viewer(text,uuid[]) RESTRICT;
DROP FUNCTION policy_commission_scoped.resolve_scope(text,uuid[]) RESTRICT;
DROP TYPE policy_commission_scoped.installment_fact RESTRICT;
DROP TYPE policy_commission_scoped.policy_fact RESTRICT;
DROP SCHEMA policy_commission_scoped RESTRICT;

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_my_commission_overview(text,date,date)', '5ac30141bdd4364457a8def8f111f4c5', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_breakdown(text,date,date)', '50fa20f32cd5e3b9ae5ee07ec3ed01f6', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_policy_commission(uuid)', '6581348373a83dc8e09975220d1ca79d', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_reporting.policies(uuid,uuid,uuid)', '58e2a95cb1975631d9e1daaafd1599c5', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_receipts(text,date,date,boolean,integer,integer)', '4c08f793ceda74ea8068d5353c907ff2', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_installments(text,date,date,text,text,text,text,integer,integer)', 'f399c12d73e9b9f2b39a24817e587024', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer)', '72ca47f09b30ed85e86b000db0fb4b6c', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('policy_commission_reporting.installments(uuid,uuid,date,uuid[])', 'b661f4fd5fc186849c0834c47f446605', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer)', '0b86b38252863aaa712c0fe9b8a0a0c4', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]'),
    ('public.get_my_commission_policies(text,text,integer,integer)', '6d69ce9fa49a109ae68a9468407a08ed', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}', '["search_path=pg_catalog, pg_temp"]')) p(fn,digest,owner_name,acl,config)
  LOOP
    IF to_regprocedure(r.fn) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.digest
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.owner_name
       OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.acl
       OR (SELECT to_jsonb(proconfig) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.config::jsonb THEN
      RAISE EXCEPTION 'Team Commissions recovery definition/security drift: %',r.fn USING ERRCODE='55000';
    END IF;
  END LOOP;
END $guard$;
NOTIFY pgrst, 'reload schema';
