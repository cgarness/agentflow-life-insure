-- Team Commissions: shared scoped reads; no financial writes, RLS changes or table grants.
-- CLI-generated 20261112165503, based on 713aa48d2c71de7da595d74bee878324654e3255.
-- Production application requires Chris's approval of this exact content hash and release packet.
-- Apply atomically. Legacy signatures/types, owners, grants, goals and every writer remain intact.
-- Fixed fact-query text with USING bindings avoids generic-plan cliffs without changing nested
-- authorization plans, role settings, or RLS. No query identifiers or SQL fragments come from inputs.
-- Optional installment windows/kinds only narrow the exact requested output domain; no-filter
-- defaults retain every legacy installment, including undated records. Typed ROW projections
-- preserve the old composite layouts without serializing and reparsing every summary fact.
-- Only the new public Overview, Scheduled and Breakdown RPCs declare a bounded 20s
-- transaction request budget for PostgREST to hoist. Role/database defaults, legacy
-- readers and helper-function settings are unchanged; release approval must name this effect.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE commission_scoped_preexisting ON COMMIT DROP AS
  SELECT oid, to_jsonb(p) - 'prosrc' AS metadata FROM pg_catalog.pg_proc p;
DO $guard$
DECLARE r record;
BEGIN
  IF to_regnamespace('policy_commission_scoped') IS NOT NULL THEN
    RAISE EXCEPTION 'Team Commissions already exists; refusing replay' USING ERRCODE = '55000';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('policy_commission_authz.access(uuid)', 'a6da4418b7010c609d5be650615ae643', 'postgres', '{postgres=X/postgres,authenticated=X/postgres,agentflow_policy_commission_writer=X/postgres}'),
    ('policy_commission_authz.actor_org()', '29be135fe6edfb5082838eeb22d48790', 'postgres', '{postgres=X/postgres,authenticated=X/postgres,agentflow_policy_commission_writer=X/postgres}'),
    ('policy_commission_authz.actor_uid()', 'dd7b63a5a20b36ab875e3710700bfd5e', 'postgres', '{postgres=X/postgres,agentflow_policy_commission_writer=X/postgres}'),
    ('policy_commission_insights.carrier_key(text)', '8b9b447dcacc4a258a95dfda79b82a3f', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_insights.category(text)', '03a593df96696f05d886a476ad1cd560', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_insights.comparison(date,date,date)', '10c94b5dfae4f844b06f80303e369de0', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_insights.goal_month(date)', '2468aeec4cb6bfc9456b1a0eb275b0ae', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_insights.policy_carrier(policy_commission_reporting.policy_fact)', '5174c5e9ad141f6f52cab428f1d045e5', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_insights.policy_category(policy_commission_reporting.policy_fact)', '516b085b9f50ce9593b862107696e84f', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.contact_json(policy_commission_reporting.policy_fact)', 'd7121baae9f0d8ace15829cd0ad32eab', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.installment_json(policy_commission_reporting.installment_fact,policy_commission_reporting.policy_fact)', 'd64c8f54aaf1243b610bccabac185245', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.installments(uuid,uuid,date,uuid[])', 'b661f4fd5fc186849c0834c47f446605', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.iso_or_null(text)', '4425715c96469e3fc43ff3bdde081045', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.period(text,date,date,date,integer)', 'bc9273191bc4ea2b519306cfa069c9d3', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.policies(uuid,uuid,uuid)', '58e2a95cb1975631d9e1daaafd1599c5', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('policy_commission_reporting.viewer()', 'b6cfc70bebf0a007f303d486e81748bf', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_breakdown(text,date,date)', '50fa20f32cd5e3b9ae5ee07ec3ed01f6', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_installments(text,date,date,text,text,text,text,integer,integer)', 'f399c12d73e9b9f2b39a24817e587024', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_overview(text,date,date)', '5ac30141bdd4364457a8def8f111f4c5', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_policies(text,text,integer,integer)', '6d69ce9fa49a109ae68a9468407a08ed', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_policy_list(text,text,boolean,text,text,date,date,integer,integer)', '72ca47f09b30ed85e86b000db0fb4b6c', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_receipt_list(text,date,date,boolean,text,boolean,integer,integer)', '0b86b38252863aaa712c0fe9b8a0a0c4', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_commission_receipts(text,date,date,boolean,integer,integer)', '4c08f793ceda74ea8068d5353c907ff2', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.get_my_policy_commission(uuid)', '6581348373a83dc8e09975220d1ca79d', 'postgres', '{postgres=X/postgres,authenticated=X/postgres}'),
    ('public.is_ancestor_of(uuid,uuid)', 'c6d121db50b7ea2e37ce4a620cc855af', 'postgres', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')) AS pins(fn,digest,owner_name,acl)
  LOOP
    IF to_regprocedure(r.fn) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.digest
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.owner_name
       OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'Team Commissions preimage/security drift: %', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $guard$;
CREATE SCHEMA policy_commission_scoped;
REVOKE ALL ON SCHEMA policy_commission_scoped FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA policy_commission_scoped TO authenticated;

CREATE TYPE policy_commission_scoped.policy_fact AS (
  policy_id uuid, win_id uuid, client_id uuid, sold_date date, sale_created_at timestamptz, win_policy_type text,
  win_premium numeric, win_premium_snapshot boolean, estimate_id uuid, estimate_status text, first_year_cents bigint,
  product_carrier text, product_name text, capture_status text, contact_visible boolean, contact_name text,
  source text, carrier text, policy_type text, premium_text text, effective_date text, payment_frequency text, credited_agent_id uuid, agent_name text);

CREATE TYPE policy_commission_scoped.installment_fact AS (
  installment_id uuid, estimate_id uuid, policy_id uuid, kind text, sequence smallint, expected_cents bigint,
  timing_precision text, expected_on date, expected_until date, window_start date, window_end date,
  received_cents bigint, receipt_count integer, remaining_cents bigint, excess_cents bigint,
  estimate_status text, product_carrier text, product_name text, status text, credited_agent_id uuid, agent_name text);

-- Resolve the complete permitted universe on each invocation. No client-supplied identity or revision is authority.
CREATE FUNCTION policy_commission_scoped.resolve_scope(p_agent_scope text, p_agent_ids uuid[])
RETURNS TABLE(uid uuid, org uuid, agent_ids uuid[], revision text, mode text, agents jsonb, can_view_own boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v_uid uuid := auth.uid(); v_org uuid := policy_commission_authz.actor_org(); v_own boolean;
  v_all uuid[]; v_ids uuid[]; v_agents jsonb; v_revision text;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE='42501';
  END IF;
  IF p_agent_scope IS NULL OR p_agent_scope NOT IN ('me','all','selected')
     OR (p_agent_scope <> 'selected' AND p_agent_ids IS NOT NULL)
     THEN
    RAISE EXCEPTION 'Choose Me, All agents, or one or more exact agents' USING ERRCODE='22023';
  END IF;
  IF p_agent_scope='selected' THEN
    IF p_agent_ids IS NULL OR cardinality(p_agent_ids)=0 OR coalesce(array_ndims(p_agent_ids),0)<>1 THEN
      RAISE EXCEPTION 'Choose one or more exact agents' USING ERRCODE='22023';
    END IF;
    IF array_position(p_agent_ids,NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'Agent IDs cannot be null' USING ERRCODE='22023';
    END IF;
  END IF;
  v_own := policy_commission_authz.access(v_uid) IS NOT NULL;
  WITH permitted AS MATERIALIZED (
    SELECT p.id, coalesce(nullif(btrim(concat_ws(' ',nullif(btrim(p.first_name),''),nullif(btrim(p.last_name),''))),''),'Unnamed agent') AS display_name,
      p.status, p.id=v_uid AS is_self, policy_commission_authz.access(p.id) AS access
    FROM public.profiles p
    WHERE p.organization_id=v_org
      AND (p.id=v_uid OR p.status='Active' OR EXISTS (
        SELECT 1 FROM public.wins w WHERE w.organization_id=v_org AND w.agent_id=p.id AND w.policy_id IS NOT NULL)))
  SELECT coalesce(array_agg(p.id ORDER BY p.id),'{}'::uuid[]),
      coalesce(jsonb_agg(jsonb_build_object('agent_id',p.id,'display_name',p.display_name,'status',p.status,'is_self',p.is_self)
        ORDER BY lower(p.display_name),p.display_name,p.id),'[]'::jsonb),
      md5(v_uid::text||':'||v_org::text||':'||v_own::text||':'||coalesce(string_agg(p.id::text||':'||p.access||':'||p.display_name||':'||coalesce(p.status,''),',' ORDER BY p.id),''))
    INTO v_all,v_agents,v_revision FROM permitted p WHERE p.access IS NOT NULL;
  IF p_agent_scope='me' THEN
    IF NOT v_own OR NOT (v_uid=ANY(v_all)) THEN RAISE EXCEPTION 'Commission access is unavailable' USING ERRCODE='42501'; END IF;
    v_ids := ARRAY[v_uid];
  ELSIF p_agent_scope='all' THEN v_ids:=v_all;
  ELSE
    SELECT array_agg(x ORDER BY x) INTO v_ids FROM (SELECT DISTINCT unnest(p_agent_ids) AS x) d;
    IF NOT v_ids <@ v_all THEN RAISE EXCEPTION 'One or more agents are unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN QUERY SELECT v_uid,v_org,v_ids,v_revision,p_agent_scope,v_agents,v_own;
END $function$;

CREATE FUNCTION policy_commission_scoped.viewer(p_agent_scope text,p_agent_ids uuid[])
RETURNS TABLE(uid uuid,org uuid,today date,time_zone text,agent_ids uuid[],revision text,mode text,agents jsonb,can_view_own boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v record; v_tz text;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.resolve_scope(p_agent_scope,p_agent_ids);
  SELECT cs.timezone INTO v_tz FROM public.company_settings cs WHERE cs.organization_id=v.org;
  IF v_tz IS NULL OR btrim(v_tz)='' OR lower(v_tz) IN ('factory','localtime','posixrules')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=v_tz) THEN
    RAISE EXCEPTION 'The agency time zone is not set' USING ERRCODE='55000', HINT='An admin must set the time zone in Settings > Company Branding.';
  END IF;
  RETURN QUERY SELECT v.uid,v.org,(now() AT TIME ZONE v_tz)::date,v_tz,v.agent_ids,v.revision,v.mode,v.agents,v.can_view_own;
END $function$;

CREATE FUNCTION public.get_commission_agent_scope(p_search text DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0,
 p_agent_scope text DEFAULT NULL,p_agent_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v record; v_out jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 OR length(p_search)>200
     OR (p_agent_scope IS NULL AND p_agent_ids IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid agent picker filters' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM policy_commission_scoped.resolve_scope(coalesce(p_agent_scope,'all'),p_agent_ids);
  WITH roster AS MATERIALIZED (SELECT x.value AS agent,x.ordinality AS ord FROM jsonb_array_elements(v.agents) WITH ORDINALITY x),
  matched AS (SELECT * FROM roster WHERE p_search IS NULL OR position(lower(btrim(p_search)) IN lower(agent->>'display_name'))>0),
  page AS (SELECT * FROM matched ORDER BY ord LIMIT p_limit OFFSET p_offset)
  SELECT jsonb_build_object('agents',(SELECT coalesce(jsonb_agg(agent ORDER BY ord),'[]'::jsonb) FROM page),
    'selected_agents',(SELECT coalesce(jsonb_agg(agent ORDER BY ord),'[]'::jsonb) FROM roster
      WHERE p_agent_scope IS NOT NULL AND (agent->>'agent_id')::uuid=ANY(v.agent_ids)),
    'available_count',jsonb_array_length(v.agents),'total_count',(SELECT count(*) FROM matched),
    'can_view_own',v.can_view_own,'can_select_others',EXISTS(SELECT 1 FROM roster WHERE (agent->>'agent_id')::uuid<>v.uid),
    'default_scope',CASE WHEN v.can_view_own THEN 'me' WHEN jsonb_array_length(v.agents)>0 THEN 'all' END,
    'scope_revision',v.revision) INTO v_out;
  RETURN v_out;
END $function$;

CREATE FUNCTION policy_commission_scoped.policies(p_agent_scope text,p_agent_ids uuid[],p_policy uuid DEFAULT NULL,p_policies uuid[] DEFAULT NULL)
RETURNS SETOF policy_commission_scoped.policy_fact
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.resolve_scope(p_agent_scope,p_agent_ids);
RETURN QUERY EXECUTE $facts$SELECT w.policy_id, w.id, w.contact_id, w.sold_date, w.created_at, w.policy_type, w.premium_amount,
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
         CASE WHEN c.primary_policy_id = w.policy_id THEN c.payment_frequency::text END, w.agent_id,
         coalesce(nullif(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),'Unnamed agent')
    FROM public.wins w
    JOIN public.profiles pr ON pr.id=w.agent_id AND pr.organization_id=w.organization_id
    LEFT JOIN public.policy_commission_estimates e
      ON e.organization_id = w.organization_id AND e.policy_id = w.policy_id AND e.credited_agent_id=w.agent_id AND e.credited_agent_id=ANY($2) AND e.organization_id=$1 AND e.status IN ('active', 'on_hold')
    LEFT JOIN public.policy_commission_captures cp
      ON cp.organization_id = w.organization_id AND cp.policy_id = w.policy_id
     AND cp.credited_agent_id=w.agent_id AND cp.credited_agent_id=ANY($2) AND cp.organization_id=$1 AND cp.status IN ('awaiting_confirmation', 'needs_attention')
    LEFT JOIN public.clients c ON c.id = w.contact_id AND c.organization_id = w.organization_id
    LEFT JOIN LATERAL (
      SELECT x AS item FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.custom_fields->'additional_policies') = 'array'
                                                      THEN c.custom_fields->'additional_policies' ELSE '[]'::jsonb END) x
       WHERE jsonb_typeof(x) = 'object' AND x->>'policyId' = w.policy_id::text LIMIT 1) ap
      ON c.primary_policy_id IS DISTINCT FROM w.policy_id
   WHERE w.organization_id = $1 AND w.agent_id = ANY($2) AND w.policy_id IS NOT NULL
     AND ($3 IS NULL OR w.policy_id = $3) AND ($4 IS NULL OR w.policy_id=ANY($4))$facts$ USING v.org,v.agent_ids,p_policy,p_policies;
END $function$;

CREATE FUNCTION policy_commission_scoped.installments(p_agent_scope text,p_agent_ids uuid[],p_today date,p_policies uuid[] DEFAULT NULL,
 p_window_from date DEFAULT NULL,p_window_to date DEFAULT NULL,p_kind text DEFAULT NULL,p_include_undated boolean DEFAULT false)
RETURNS SETOF policy_commission_scoped.installment_fact
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.resolve_scope(p_agent_scope,p_agent_ids);
  IF p_include_undated IS NULL OR p_window_from>p_window_to
     OR p_window_from NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'
     OR p_window_to NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'
     OR (p_kind IS NOT NULL AND p_kind NOT IN ('advance','month_10','month_11','month_12','later')) THEN
    RAISE EXCEPTION 'Invalid installment fact filters' USING ERRCODE='22023';
  END IF;
RETURN QUERY EXECUTE $facts$WITH r AS (
    SELECT rc.installment_id,rc.credited_agent_id,rc.policy_id, sum(rc.amount_cents)::bigint AS received, count(*)::integer AS n
      FROM public.policy_commission_receipts rc
     WHERE rc.organization_id = $1 AND rc.credited_agent_id = ANY($2) AND rc.voided_at IS NULL
       AND ($4 IS NULL OR rc.policy_id = ANY ($4))
     GROUP BY rc.installment_id,rc.credited_agent_id,rc.policy_id),
  i AS (
    SELECT i.id, i.estimate_id, i.policy_id, i.kind, i.sequence, i.expected_cents, i.timing_precision, i.expected_on,
           i.expected_until, e.status AS estimate_status, e.product_carrier, e.product_name,
           CASE WHEN i.expected_on IS NULL THEN NULL
                WHEN i.timing_precision = 'month' THEN (date_trunc('month', i.expected_on) + interval '1 month' - interval '1 day')::date
                ELSE coalesce(i.expected_until, i.expected_on) END AS window_end,
           coalesce(r.received, 0)::bigint AS received, coalesce(r.n, 0) AS n, e.credited_agent_id,
           coalesce(nullif(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),'Unnamed agent') AS agent_name
      FROM public.policy_commission_estimates e
      JOIN public.profiles pr ON pr.id=e.credited_agent_id AND pr.organization_id=e.organization_id
      JOIN public.policy_commission_installments i
        ON i.estimate_id = e.id AND i.organization_id = e.organization_id AND i.policy_id = e.policy_id
       AND i.credited_agent_id = e.credited_agent_id AND i.organization_id=$1 AND i.credited_agent_id=ANY($2)
      LEFT JOIN r ON r.installment_id = i.id AND r.credited_agent_id=i.credited_agent_id AND r.policy_id=i.policy_id
     WHERE e.organization_id = $1 AND e.credited_agent_id = ANY($2) AND e.status IN ('active', 'on_hold')
       AND ($4 IS NULL OR e.policy_id = ANY ($4))
       AND ($7 IS NULL OR i.kind=$7 OR ($7='later' AND i.kind<>'advance'))
       AND (($5 IS NULL AND $6 IS NULL)
         OR ($8 AND i.expected_on IS NULL)
         OR (($5 IS NULL OR i.expected_on>=$5)
           AND ($6 IS NULL OR i.expected_on<=$6))))
  SELECT i.id, i.estimate_id, i.policy_id, i.kind, i.sequence, i.expected_cents, i.timing_precision, i.expected_on,
         i.expected_until, i.expected_on, i.window_end, i.received, i.n,
         greatest(i.expected_cents - i.received, 0), greatest(i.received - i.expected_cents, 0),
         i.estimate_status, i.product_carrier, i.product_name,
         CASE WHEN i.estimate_status = 'on_hold' THEN 'on_hold'
              WHEN i.received >= i.expected_cents AND i.received > 0 THEN 'received'
              WHEN i.received >= i.expected_cents THEN 'none'
              WHEN i.expected_on IS NULL THEN 'date_needed'
              WHEN i.window_end < $3 THEN 'check_payment'
              ELSE 'upcoming' END, i.credited_agent_id,i.agent_name
    FROM i$facts$ USING v.org,v.agent_ids,p_today,p_policies,p_window_from,p_window_to,p_kind,p_include_undated;
END $function$;

CREATE OR REPLACE FUNCTION policy_commission_reporting.policies(p_uid uuid, p_org uuid, p_policy uuid DEFAULT NULL::uuid)
 RETURNS SETOF policy_commission_reporting.policy_fact
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT (ROW((f).policy_id,(f).win_id,(f).client_id,(f).sold_date,(f).sale_created_at,(f).win_policy_type,(f).win_premium,(f).win_premium_snapshot,(f).estimate_id,(f).estimate_status,(f).first_year_cents,(f).product_carrier,(f).product_name,(f).capture_status,(f).contact_visible,(f).contact_name,(f).source,(f).carrier,(f).policy_type,(f).premium_text,(f).effective_date,(f).payment_frequency)::policy_commission_reporting.policy_fact).*
    FROM policy_commission_scoped.policies('me',NULL,p_policy) f
   WHERE p_uid=auth.uid() AND p_org=policy_commission_authz.actor_org()
$function$;

CREATE OR REPLACE FUNCTION policy_commission_reporting.installments(p_uid uuid, p_org uuid, p_today date, p_policies uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF policy_commission_reporting.installment_fact
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT (ROW((f).installment_id,(f).estimate_id,(f).policy_id,(f).kind,(f).sequence,(f).expected_cents,(f).timing_precision,(f).expected_on,(f).expected_until,(f).window_start,(f).window_end,(f).received_cents,(f).receipt_count,(f).remaining_cents,(f).excess_cents,(f).estimate_status,(f).product_carrier,(f).product_name,(f).status)::policy_commission_reporting.installment_fact).*
    FROM policy_commission_scoped.installments('me',NULL,p_today,p_policies) f
   WHERE p_uid=auth.uid() AND p_org=policy_commission_authz.actor_org()
$function$;

CREATE FUNCTION policy_commission_scoped.read_overview(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; p record; v_first date; v_last date; n integer; v_before integer := 0; v_after integer := 0;
  v_chart_from date; v_chart_to date; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, 731);
  v_first := date_trunc('month', p.from_on)::date;
  v_last := date_trunc('month', p.to_on)::date;
  n := (extract(year FROM v_last)::integer - extract(year FROM v_first)::integer) * 12
       + extract(month FROM v_last)::integer - extract(month FROM v_first)::integer + 1;
  IF n < 12 THEN v_before := (12 - n) / 2; v_after := 12 - n - v_before; END IF;
  v_chart_from := (v_first - make_interval(months => v_before))::date;
  v_chart_to := (v_last + make_interval(months => v_after + 1) - interval '1 day')::date;

  WITH inst AS MATERIALIZED (SELECT * FROM policy_commission_scoped.installments(p_agent_scope,p_agent_ids, v.today)),
  pol AS MATERIALIZED (SELECT * FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids)),
  cohort AS (SELECT * FROM inst WHERE estimate_status = 'active' AND window_start BETWEEN p.from_on AND p.to_on),
  rec AS (SELECT r.received_on, r.amount_cents FROM public.policy_commission_receipts r
           WHERE r.organization_id = v.org AND r.credited_agent_id = ANY(v.agent_ids) AND r.voided_at IS NULL
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
                 FROM (SELECT (policy_commission_reporting.installment_json(ROW((f).installment_id,(f).estimate_id,(f).policy_id,(f).kind,(f).sequence,(f).expected_cents,(f).timing_precision,(f).expected_on,(f).expected_until,(f).window_start,(f).window_end,(f).received_cents,(f).receipt_count,(f).remaining_cents,(f).excess_cents,(f).estimate_status,(f).product_carrier,(f).product_name,(f).status)::policy_commission_reporting.installment_fact,ROW((pf).policy_id,(pf).win_id,(pf).client_id,(pf).sold_date,(pf).sale_created_at,(pf).win_policy_type,(pf).win_premium,(pf).win_premium_snapshot,(pf).estimate_id,(pf).estimate_status,(pf).first_year_cents,(pf).product_carrier,(pf).product_name,(pf).capture_status,(pf).contact_visible,(pf).contact_name,(pf).source,(pf).carrier,(pf).policy_type,(pf).premium_text,(pf).effective_date,(pf).payment_frequency)::policy_commission_reporting.policy_fact) || CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('credited_agent_id',f.credited_agent_id,'agent_name',f.agent_name) END) AS j, f.window_start, f.sequence, f.policy_id,
                              f.installment_id
                         FROM next90 f JOIN pol pf ON pf.policy_id = f.policy_id
                        ORDER BY f.window_start, f.sequence, f.policy_id, f.installment_id LIMIT 5) x)),
    'setup', (SELECT jsonb_build_object('eligible_count', count(*), 'with_estimate_count', count(estimate_id)) FROM pol))
    INTO v_out;
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_overview(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_overview('me',NULL,p_period,p_from,p_to,true);
END $function$;

CREATE FUNCTION public.get_scoped_commission_overview(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
 SELECT policy_commission_scoped.read_overview(p_agent_scope,p_agent_ids,p_period,p_from,p_to,false)
$function$;

CREATE FUNCTION policy_commission_scoped.read_installments(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_scope text DEFAULT 'range'::text, p_status text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; p record; v_carrier text := lower(nullif(btrim(coalesce(p_carrier, '')), '')); v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
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

  WITH inst AS MATERIALIZED (SELECT * FROM policy_commission_scoped.installments(p_agent_scope,p_agent_ids,v.today,NULL,CASE WHEN p_scope='range' THEN p.from_on END,CASE p_scope WHEN 'range' THEN p.to_on WHEN 'next_90' THEN v.today+89 END,p_kind)),
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
    SELECT (policy_commission_reporting.installment_json(ROW((f).installment_id,(f).estimate_id,(f).policy_id,(f).kind,(f).sequence,(f).expected_cents,(f).timing_precision,(f).expected_on,(f).expected_until,(f).window_start,(f).window_end,(f).received_cents,(f).receipt_count,(f).remaining_cents,(f).excess_cents,(f).estimate_status,(f).product_carrier,(f).product_name,(f).status)::policy_commission_reporting.installment_fact,ROW((pf).policy_id,(pf).win_id,(pf).client_id,(pf).sold_date,(pf).sale_created_at,(pf).win_policy_type,(pf).win_premium,(pf).win_premium_snapshot,(pf).estimate_id,(pf).estimate_status,(pf).first_year_cents,(pf).product_carrier,(pf).product_name,(pf).capture_status,(pf).contact_visible,(pf).contact_name,(pf).source,(pf).carrier,(pf).policy_type,(pf).premium_text,(pf).effective_date,(pf).payment_frequency)::policy_commission_reporting.policy_fact) || CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('credited_agent_id',f.credited_agent_id,'agent_name',f.agent_name) END) AS j, g.window_start, g.sequence, g.policy_id, g.installment_id
      FROM page g JOIN matched f ON f.installment_id = g.installment_id
      JOIN policy_commission_scoped.policies(p_agent_scope,p_agent_ids,NULL,(SELECT coalesce(array_agg(pg.policy_id),'{}'::uuid[]) FROM page pg)) pf ON pf.policy_id=g.policy_id AND pf.credited_agent_id=f.credited_agent_id)
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
                          WHERE e.organization_id = v.org AND e.credited_agent_id = ANY(v.agent_ids) AND e.status IN ('active', 'on_hold')
                            AND btrim(e.product_carrier) <> '') d),
    'rows', (SELECT coalesce(jsonb_agg(j ORDER BY window_start NULLS LAST, sequence, policy_id, installment_id), '[]'::jsonb) FROM page_rows))
    INTO v_out;
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_installments(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_scope text DEFAULT 'range'::text, p_status text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_installments('me',NULL,p_period,p_from,p_to,p_scope,p_status,p_kind,p_carrier,p_limit,p_offset,true);
END $function$;

CREATE FUNCTION public.get_scoped_commission_installments(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_scope text DEFAULT 'range'::text, p_status text DEFAULT 'all'::text, p_kind text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
 SELECT policy_commission_scoped.read_installments(p_agent_scope,p_agent_ids,p_period,p_from,p_to,p_scope,p_status,p_kind,p_carrier,p_limit,p_offset,false)
$function$;

CREATE FUNCTION policy_commission_scoped.read_receipts(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; p record; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, NULL);
  IF p_include_voided IS NULL THEN RAISE EXCEPTION 'Choose whether to include voided payments' USING ERRCODE = '22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  WITH rows AS (
    SELECT r.id, r.received_on, r.recorded_at, r.amount_cents, r.voided_at, r.void_reason, r.replaces_receipt_id,
           r.policy_id, r.installment_id, r.estimate_id, r.credited_agent_id,
           coalesce(nullif(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),'Unnamed agent') AS agent_name, i.kind, e.status AS estimate_status, e.product_carrier, e.product_name
      FROM public.policy_commission_receipts r
      JOIN public.profiles pr ON pr.id=r.credited_agent_id AND pr.organization_id=r.organization_id
      JOIN public.policy_commission_installments i
        ON i.id = r.installment_id AND i.estimate_id = r.estimate_id AND i.organization_id = r.organization_id AND i.organization_id=v.org AND i.credited_agent_id IS NOT DISTINCT FROM r.credited_agent_id AND i.credited_agent_id=ANY(v.agent_ids) AND i.policy_id IS NOT DISTINCT FROM r.policy_id
      JOIN public.policy_commission_estimates e ON e.id = r.estimate_id AND e.organization_id = r.organization_id AND e.organization_id=v.org AND e.credited_agent_id IS NOT DISTINCT FROM r.credited_agent_id AND e.credited_agent_id=ANY(v.agent_ids) AND e.policy_id IS NOT DISTINCT FROM r.policy_id
     WHERE r.organization_id = v.org AND r.credited_agent_id = ANY(v.agent_ids)
       AND r.received_on BETWEEN p.from_on AND p.to_on
       AND (p_include_voided OR r.voided_at IS NULL)),
  page_base AS MATERIALIZED (SELECT * FROM rows x ORDER BY x.received_on DESC,x.recorded_at DESC,x.id LIMIT p_limit OFFSET p_offset),
  page_pol AS MATERIALIZED (SELECT * FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids,NULL,(SELECT coalesce(array_agg(x.policy_id),'{}'::uuid[]) FROM page_base x))),
  page AS (
    SELECT x.*, (SELECT n.id FROM public.policy_commission_receipts n
      WHERE n.replaces_receipt_id=x.id AND n.organization_id=v.org AND n.credited_agent_id=ANY(v.agent_ids)
        AND n.credited_agent_id=x.credited_agent_id AND n.policy_id=x.policy_id) AS replaced_by,
      policy_commission_reporting.contact_json(ROW((pf).policy_id,(pf).win_id,(pf).client_id,(pf).sold_date,(pf).sale_created_at,(pf).win_policy_type,(pf).win_premium,(pf).win_premium_snapshot,(pf).estimate_id,(pf).estimate_status,(pf).first_year_cents,(pf).product_carrier,(pf).product_name,(pf).capture_status,(pf).contact_visible,(pf).contact_name,(pf).source,(pf).carrier,(pf).policy_type,(pf).premium_text,(pf).effective_date,(pf).payment_frequency)::policy_commission_reporting.policy_fact) AS contact
    FROM page_base x LEFT JOIN page_pol pf ON pf.policy_id=x.policy_id AND pf.credited_agent_id=x.credited_agent_id)
  SELECT jsonb_build_object(
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now(), 'period', coalesce(p_period, 'this_month'),
             'from', p.from_on, 'to', p.to_on, 'include_voided', p_include_voided, 'limit', p_limit, 'offset', p_offset),
    'total_count', (SELECT count(*) FROM rows),
    'totals', (SELECT jsonb_build_object('received_cents', coalesce(sum(amount_cents) FILTER (WHERE voided_at IS NULL), 0),
                 'valid_count', count(*) FILTER (WHERE voided_at IS NULL), 'voided_count', count(*) FILTER (WHERE voided_at IS NOT NULL))
                 FROM rows),
    'rows', (SELECT coalesce(jsonb_agg((CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('credited_agent_id',g.credited_agent_id,'agent_name',g.agent_name) END) || jsonb_build_object('receipt_id', g.id, 'received_on', g.received_on,
                 'recorded_at', g.recorded_at, 'amount_cents', g.amount_cents, 'voided', g.voided_at IS NOT NULL,
                 'void_reason', g.void_reason, 'replaces_receipt_id', g.replaces_receipt_id, 'replaced_by_receipt_id', g.replaced_by,
                 'policy_id', g.policy_id, 'installment_id', g.installment_id, 'estimate_id', g.estimate_id, 'kind', g.kind,
                 'estimate_status', g.estimate_status, 'carrier', g.product_carrier, 'product', g.product_name,
                 'contact', g.contact)
               ORDER BY g.received_on DESC, g.recorded_at DESC, g.id), '[]'::jsonb) FROM page g))
    INTO v_out;
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_receipts(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_receipts('me',NULL,p_period,p_from,p_to,p_include_voided,p_limit,p_offset,true);
END $function$;

CREATE FUNCTION policy_commission_scoped.read_policies(p_agent_scope text,p_agent_ids uuid[],p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; v_carrier text := lower(nullif(btrim(coalesce(p_carrier, '')), '')); v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
  IF p_setup IS NULL OR p_setup NOT IN ('all', 'missing', 'needs_review', 'recorded', 'on_hold') THEN
    RAISE EXCEPTION 'Unknown setup filter' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Page size must be 1 to 100' USING ERRCODE = '22023';
  END IF;

  -- pf keeps the named composite type, so contact_json() accepts it after the CTE boundaries. Setup state and carrier
  -- come from the policies alone; payment amounts are read only for the page's policies.
  WITH pol AS MATERIALIZED (SELECT x AS pf FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids) x),
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
    SELECT * FROM policy_commission_scoped.installments(p_agent_scope,p_agent_ids, v.today, (SELECT coalesce(array_agg((g.pf).policy_id),'{}'::uuid[]) FROM page g))),
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
    'rows', (SELECT coalesce(jsonb_agg((CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('credited_agent_id',(g.pf).credited_agent_id,'agent_name',(g.pf).agent_name) END) || jsonb_build_object('policy_id', (g.pf).policy_id, 'setup', g.setup,
                 'contact', policy_commission_reporting.contact_json(ROW((g.pf).policy_id,(g.pf).win_id,(g.pf).client_id,(g.pf).sold_date,(g.pf).sale_created_at,(g.pf).win_policy_type,(g.pf).win_premium,(g.pf).win_premium_snapshot,(g.pf).estimate_id,(g.pf).estimate_status,(g.pf).first_year_cents,(g.pf).product_carrier,(g.pf).product_name,(g.pf).capture_status,(g.pf).contact_visible,(g.pf).contact_name,(g.pf).source,(g.pf).carrier,(g.pf).policy_type,(g.pf).premium_text,(g.pf).effective_date,(g.pf).payment_frequency)::policy_commission_reporting.policy_fact), 'source', (g.pf).source, 'carrier', g.shown_carrier,
                 'product', coalesce(nullif(btrim((g.pf).product_name), ''), nullif(btrim((g.pf).policy_type), '')),
                 'effective_date', policy_commission_reporting.iso_or_null((g.pf).effective_date),
                 'estimate_cents', (g.pf).first_year_cents, 'received_cents', a.received, 'remaining_cents', a.remaining,
                 'excess_cents', a.excess, 'date_needed_count', coalesce(a.date_needed, 0), 'next_payment', nx.next_payment)
               ORDER BY (g.pf).sold_date DESC NULLS LAST, (g.pf).sale_created_at DESC, (g.pf).policy_id), '[]'::jsonb)
               FROM page g LEFT JOIN agg a ON a.policy_id = (g.pf).policy_id LEFT JOIN nxt nx ON nx.policy_id = (g.pf).policy_id))
    INTO v_out;
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_policies(p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_policies('me',NULL,p_setup,p_carrier,p_limit,p_offset,true);
END $function$;

CREATE FUNCTION policy_commission_scoped.read_breakdown(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; p record; c record; nm record; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
  SELECT * INTO p FROM policy_commission_reporting.period(p_period, p_from, p_to, v.today, 731);
  SELECT * INTO c FROM policy_commission_insights.comparison(p.from_on, p.to_on, v.today);
  SELECT * INTO nm FROM policy_commission_reporting.period('next_month', NULL, NULL, v.today, NULL);

  WITH pol AS MATERIALIZED (
    SELECT x.policy_id, x.sold_date, x.estimate_status, x.first_year_cents, x.capture_status,
           policy_commission_insights.policy_carrier(ROW((x).policy_id,(x).win_id,(x).client_id,(x).sold_date,(x).sale_created_at,(x).win_policy_type,(x).win_premium,(x).win_premium_snapshot,(x).estimate_id,(x).estimate_status,(x).first_year_cents,(x).product_carrier,(x).product_name,(x).capture_status,(x).contact_visible,(x).contact_name,(x).source,(x).carrier,(x).policy_type,(x).premium_text,(x).effective_date,(x).payment_frequency)::policy_commission_reporting.policy_fact) AS carrier, policy_commission_insights.policy_category(ROW((x).policy_id,(x).win_id,(x).client_id,(x).sold_date,(x).sale_created_at,(x).win_policy_type,(x).win_premium,(x).win_premium_snapshot,(x).estimate_id,(x).estimate_status,(x).first_year_cents,(x).product_carrier,(x).product_name,(x).capture_status,(x).contact_visible,(x).contact_name,(x).source,(x).carrier,(x).policy_type,(x).premium_text,(x).effective_date,(x).payment_frequency)::policy_commission_reporting.policy_fact) AS category
      FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids) x),
  sold AS (SELECT * FROM pol WHERE sold_date BETWEEN p.from_on AND p.to_on),
  -- One row per valid receipt (each has exactly one estimate), so no amount is repeated.
  rec AS MATERIALIZED (
    SELECT r.received_on, r.amount_cents, nullif(btrim(e.product_carrier), '') AS carrier
      FROM public.policy_commission_receipts r
      LEFT JOIN public.policy_commission_estimates e ON e.id = r.estimate_id AND e.organization_id = r.organization_id AND e.organization_id=v.org AND e.credited_agent_id IS NOT DISTINCT FROM r.credited_agent_id AND e.credited_agent_id=ANY(v.agent_ids) AND e.policy_id IS NOT DISTINCT FROM r.policy_id
     WHERE r.organization_id = v.org AND r.credited_agent_id = ANY(v.agent_ids) AND r.voided_at IS NULL
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
      FROM policy_commission_scoped.installments(p_agent_scope,p_agent_ids,v.today,NULL,nm.from_on,nm.to_on,'later') f
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
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_breakdown(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_breakdown('me',NULL,p_period,p_from,p_to,true);
END $function$;

CREATE FUNCTION public.get_scoped_commission_breakdown(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET statement_timeout TO '20s'
AS $function$
 SELECT policy_commission_scoped.read_breakdown(p_agent_scope,p_agent_ids,p_period,p_from,p_to,false)
$function$;

CREATE FUNCTION policy_commission_scoped.read_policy_list(p_agent_scope text,p_agent_ids uuid[],p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_category text DEFAULT NULL::text, p_period text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; p record; v_carrier text := policy_commission_insights.carrier_key(p_carrier);
  v_all boolean := coalesce(p_period, 'all') = 'all'; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
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

  WITH pol AS MATERIALIZED (SELECT x AS pf FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids) x),
  rows AS (
    SELECT o.pf,
           CASE WHEN (o.pf).estimate_status = 'on_hold' THEN 'on_hold' WHEN (o.pf).estimate_id IS NOT NULL THEN 'recorded'
                WHEN (o.pf).capture_status IS NOT NULL THEN 'needs_review' ELSE 'missing' END AS setup,
           policy_commission_insights.policy_carrier(ROW((o.pf).policy_id,(o.pf).win_id,(o.pf).client_id,(o.pf).sold_date,(o.pf).sale_created_at,(o.pf).win_policy_type,(o.pf).win_premium,(o.pf).win_premium_snapshot,(o.pf).estimate_id,(o.pf).estimate_status,(o.pf).first_year_cents,(o.pf).product_carrier,(o.pf).product_name,(o.pf).capture_status,(o.pf).contact_visible,(o.pf).contact_name,(o.pf).source,(o.pf).carrier,(o.pf).policy_type,(o.pf).premium_text,(o.pf).effective_date,(o.pf).payment_frequency)::policy_commission_reporting.policy_fact) AS shown_carrier,
           policy_commission_insights.policy_category(ROW((o.pf).policy_id,(o.pf).win_id,(o.pf).client_id,(o.pf).sold_date,(o.pf).sale_created_at,(o.pf).win_policy_type,(o.pf).win_premium,(o.pf).win_premium_snapshot,(o.pf).estimate_id,(o.pf).estimate_status,(o.pf).first_year_cents,(o.pf).product_carrier,(o.pf).product_name,(o.pf).capture_status,(o.pf).contact_visible,(o.pf).contact_name,(o.pf).source,(o.pf).carrier,(o.pf).policy_type,(o.pf).premium_text,(o.pf).effective_date,(o.pf).payment_frequency)::policy_commission_reporting.policy_fact) AS category
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
    SELECT * FROM policy_commission_scoped.installments(p_agent_scope,p_agent_ids, v.today, (SELECT coalesce(array_agg((g.pf).policy_id),'{}'::uuid[]) FROM page g))),
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
    'rows', (SELECT coalesce(jsonb_agg((CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('credited_agent_id',(g.pf).credited_agent_id,'agent_name',(g.pf).agent_name) END) || jsonb_build_object('policy_id', (g.pf).policy_id, 'setup', g.setup,
                 'contact', policy_commission_reporting.contact_json(ROW((g.pf).policy_id,(g.pf).win_id,(g.pf).client_id,(g.pf).sold_date,(g.pf).sale_created_at,(g.pf).win_policy_type,(g.pf).win_premium,(g.pf).win_premium_snapshot,(g.pf).estimate_id,(g.pf).estimate_status,(g.pf).first_year_cents,(g.pf).product_carrier,(g.pf).product_name,(g.pf).capture_status,(g.pf).contact_visible,(g.pf).contact_name,(g.pf).source,(g.pf).carrier,(g.pf).policy_type,(g.pf).premium_text,(g.pf).effective_date,(g.pf).payment_frequency)::policy_commission_reporting.policy_fact), 'source', (g.pf).source, 'carrier', g.shown_carrier,
                 'product', coalesce(nullif(btrim((g.pf).product_name), ''), nullif(btrim((g.pf).policy_type), '')),
                 'category', g.category, 'sold_date', (g.pf).sold_date,
                 'effective_date', policy_commission_reporting.iso_or_null((g.pf).effective_date),
                 'estimate_cents', (g.pf).first_year_cents, 'received_cents', a.received, 'remaining_cents', a.remaining,
                 'excess_cents', a.excess, 'date_needed_count', coalesce(a.date_needed, 0), 'next_payment', nx.next_payment)
               ORDER BY (g.pf).sold_date DESC NULLS LAST, (g.pf).sale_created_at DESC, (g.pf).policy_id), '[]'::jsonb)
               FROM page g LEFT JOIN agg a ON a.policy_id = (g.pf).policy_id LEFT JOIN nxt nx ON nx.policy_id = (g.pf).policy_id))
    INTO v_out;
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_policy_list(p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_category text DEFAULT NULL::text, p_period text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_policy_list('me',NULL,p_setup,p_carrier,p_carrier_unknown,p_category,p_period,p_from,p_to,p_limit,p_offset,true);
END $function$;

CREATE FUNCTION public.get_scoped_commission_policy_list(p_agent_scope text,p_agent_ids uuid[],p_setup text DEFAULT 'all'::text, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_category text DEFAULT NULL::text, p_period text DEFAULT 'all'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT policy_commission_scoped.read_policy_list(p_agent_scope,p_agent_ids,p_setup,p_carrier,p_carrier_unknown,p_category,p_period,p_from,p_to,p_limit,p_offset,false)
$function$;

CREATE FUNCTION policy_commission_scoped.read_receipt_list(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; p record; v_carrier text := policy_commission_insights.carrier_key(p_carrier); v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
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
           r.policy_id, r.installment_id, r.estimate_id, r.credited_agent_id,
           coalesce(nullif(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),'Unnamed agent') AS agent_name, i.kind, e.status AS estimate_status, e.product_carrier, e.product_name,
           nullif(btrim(e.product_carrier), '') AS shown_carrier
      FROM public.policy_commission_receipts r
      JOIN public.profiles pr ON pr.id=r.credited_agent_id AND pr.organization_id=r.organization_id
      JOIN public.policy_commission_installments i
        ON i.id = r.installment_id AND i.estimate_id = r.estimate_id AND i.organization_id = r.organization_id AND i.organization_id=v.org AND i.credited_agent_id IS NOT DISTINCT FROM r.credited_agent_id AND i.credited_agent_id=ANY(v.agent_ids) AND i.policy_id IS NOT DISTINCT FROM r.policy_id
      JOIN public.policy_commission_estimates e ON e.id = r.estimate_id AND e.organization_id = r.organization_id AND e.organization_id=v.org AND e.credited_agent_id IS NOT DISTINCT FROM r.credited_agent_id AND e.credited_agent_id=ANY(v.agent_ids) AND e.policy_id IS NOT DISTINCT FROM r.policy_id
     WHERE r.organization_id = v.org AND r.credited_agent_id = ANY(v.agent_ids)),
  rows AS (
    SELECT * FROM mine m
     WHERE m.received_on BETWEEN p.from_on AND p.to_on AND (p_include_voided OR m.voided_at IS NULL)
       AND (v_carrier IS NULL OR policy_commission_insights.carrier_key(m.shown_carrier) = v_carrier)
       AND (NOT p_carrier_unknown OR m.shown_carrier IS NULL)),
  page_base AS MATERIALIZED (SELECT * FROM rows x ORDER BY x.received_on DESC,x.recorded_at DESC,x.id LIMIT p_limit OFFSET p_offset),
  page_pol AS MATERIALIZED (SELECT * FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids,NULL,(SELECT coalesce(array_agg(x.policy_id),'{}'::uuid[]) FROM page_base x))),
  page AS (
    SELECT x.*, (SELECT n.id FROM public.policy_commission_receipts n
      WHERE n.replaces_receipt_id=x.id AND n.organization_id=v.org AND n.credited_agent_id=ANY(v.agent_ids)
        AND n.credited_agent_id=x.credited_agent_id AND n.policy_id=x.policy_id) AS replaced_by,
      policy_commission_reporting.contact_json(ROW((pf).policy_id,(pf).win_id,(pf).client_id,(pf).sold_date,(pf).sale_created_at,(pf).win_policy_type,(pf).win_premium,(pf).win_premium_snapshot,(pf).estimate_id,(pf).estimate_status,(pf).first_year_cents,(pf).product_carrier,(pf).product_name,(pf).capture_status,(pf).contact_visible,(pf).contact_name,(pf).source,(pf).carrier,(pf).policy_type,(pf).premium_text,(pf).effective_date,(pf).payment_frequency)::policy_commission_reporting.policy_fact) AS contact
    FROM page_base x LEFT JOIN page_pol pf ON pf.policy_id=x.policy_id AND pf.credited_agent_id=x.credited_agent_id)
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
    'rows', (SELECT coalesce(jsonb_agg((CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('credited_agent_id',g.credited_agent_id,'agent_name',g.agent_name) END) || jsonb_build_object('receipt_id', g.id, 'received_on', g.received_on,
                 'recorded_at', g.recorded_at, 'amount_cents', g.amount_cents, 'voided', g.voided_at IS NOT NULL,
                 'void_reason', g.void_reason, 'replaces_receipt_id', g.replaces_receipt_id, 'replaced_by_receipt_id', g.replaced_by,
                 'policy_id', g.policy_id, 'installment_id', g.installment_id, 'estimate_id', g.estimate_id, 'kind', g.kind,
                 'estimate_status', g.estimate_status, 'carrier', g.product_carrier, 'product', g.product_name,
                 'contact', g.contact)
               ORDER BY g.received_on DESC, g.recorded_at DESC, g.id), '[]'::jsonb) FROM page g))
    INTO v_out;
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_commission_receipt_list(p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_receipt_list('me',NULL,p_period,p_from,p_to,p_include_voided,p_carrier,p_carrier_unknown,p_limit,p_offset,true);
END $function$;

CREATE FUNCTION public.get_scoped_commission_receipt_list(p_agent_scope text,p_agent_ids uuid[],p_period text DEFAULT 'this_month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_voided boolean DEFAULT false, p_carrier text DEFAULT NULL::text, p_carrier_unknown boolean DEFAULT false, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT policy_commission_scoped.read_receipt_list(p_agent_scope,p_agent_ids,p_period,p_from,p_to,p_include_voided,p_carrier,p_carrier_unknown,p_limit,p_offset,false)
$function$;

CREATE FUNCTION policy_commission_scoped.read_policy_detail(p_agent_scope text,p_agent_ids uuid[],p_policy_id uuid,p_legacy boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE v record; f policy_commission_scoped.policy_fact; v_est jsonb; v_cap jsonb; v_state text; v_basis jsonb;
  v_pp text; v_type text; v_carrier text; v_eff text; v_out jsonb;
BEGIN
  SELECT * INTO v FROM policy_commission_scoped.viewer(p_agent_scope,p_agent_ids);
  IF NOT coalesce(p_legacy,false) AND p_policy_id IS NULL THEN
    RAISE EXCEPTION 'Choose a policy' USING ERRCODE='22023';
  END IF;
  SELECT * INTO f FROM policy_commission_scoped.policies(p_agent_scope,p_agent_ids, p_policy_id);
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
                 FROM public.policy_commission_receipts r WHERE r.installment_id = i.id AND r.organization_id=v.org AND r.credited_agent_id=f.credited_agent_id AND r.credited_agent_id=ANY(v.agent_ids) AND r.policy_id=p_policy_id AND r.estimate_id=e.id)) ORDER BY i.sequence), '[]'::jsonb)
             FROM public.policy_commission_installments i WHERE i.estimate_id = e.id AND i.organization_id=v.org AND i.credited_agent_id=f.credited_agent_id AND i.credited_agent_id=ANY(v.agent_ids) AND i.policy_id=p_policy_id))
    INTO v_est
    FROM public.policy_commission_estimates e
    LEFT JOIN public.policy_commission_captures cp ON cp.id = e.capture_id AND cp.organization_id=v.org AND cp.credited_agent_id=f.credited_agent_id AND cp.credited_agent_id=ANY(v.agent_ids) AND cp.policy_id=p_policy_id
   WHERE e.organization_id = v.org AND e.policy_id = p_policy_id AND e.credited_agent_id=f.credited_agent_id AND e.credited_agent_id=ANY(v.agent_ids) AND e.status IN ('active', 'on_hold');
  SELECT jsonb_build_object('id', cp.id, 'status', cp.status, 'attention_code', cp.attention_code,
           'first_year_cents', cp.first_year_cents, 'advance_cents', cp.advance_cents, 'captured_by', cp.captured_by,
           'captured_at', cp.captured_at, 'product_id', cp.product_id, 'insured_age', cp.insured_age,
           'term_years', cp.term_years)
    INTO v_cap
    FROM public.policy_commission_captures cp
   WHERE cp.organization_id = v.org AND cp.policy_id = p_policy_id AND cp.credited_agent_id=f.credited_agent_id AND cp.credited_agent_id=ANY(v.agent_ids) AND cp.status IN ('awaiting_confirmation', 'needs_attention');
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
  v_out := jsonb_build_object(
    'policy', jsonb_build_object('policy_id', f.policy_id, 'source', f.source, 'state', v_state,
      'access', CASE WHEN p_agent_scope='me' THEN policy_commission_authz.access(v.uid) ELSE 'read' END, 'credited_agent_id', f.credited_agent_id, 'win_id', f.win_id, 'basis', v_basis,
      'estimate', v_est, 'capture', v_cap) || CASE WHEN p_legacy THEN '{}'::jsonb ELSE jsonb_build_object('agent_name',f.agent_name) END,
    'contact', policy_commission_reporting.contact_json(ROW((f).policy_id,(f).win_id,(f).client_id,(f).sold_date,(f).sale_created_at,(f).win_policy_type,(f).win_premium,(f).win_premium_snapshot,(f).estimate_id,(f).estimate_status,(f).first_year_cents,(f).product_carrier,(f).product_name,(f).capture_status,(f).contact_visible,(f).contact_name,(f).source,(f).carrier,(f).policy_type,(f).premium_text,(f).effective_date,(f).payment_frequency)::policy_commission_reporting.policy_fact),
    'meta', jsonb_build_object('today', v.today, 'time_zone', v.time_zone, 'as_of', now()));
  IF NOT coalesce(p_legacy,false) THEN
    v_out := jsonb_set(v_out,'{meta,agent_scope}',jsonb_build_object('mode',v.mode,'agent_ids',to_jsonb(v.agent_ids),'revision',v.revision));
  END IF;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_policy_commission(p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RETURN policy_commission_scoped.read_policy_detail('me',NULL,p_policy_id,true);
END $function$;

CREATE FUNCTION public.get_scoped_policy_commission(p_agent_scope text,p_agent_ids uuid[],p_policy_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
 SELECT policy_commission_scoped.read_policy_detail(p_agent_scope,p_agent_ids,p_policy_id,false)
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='policy_commission_scoped' OR (n.nspname='public' AND p.proname IN (
      'get_commission_agent_scope','get_scoped_commission_overview','get_scoped_commission_installments',
      'get_scoped_commission_receipt_list','get_scoped_commission_policy_list','get_scoped_commission_breakdown','get_scoped_policy_commission'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role',r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.fn);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN commission_scoped_preexisting b USING(oid)
    WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.metadata) THEN
    RAISE EXCEPTION 'Team Commissions altered existing function metadata' USING ERRCODE='55000';
  END IF;
END $grants$;
REVOKE ALL ON TYPE policy_commission_scoped.policy_fact,policy_commission_scoped.installment_fact FROM PUBLIC,anon,service_role;
GRANT USAGE ON TYPE policy_commission_scoped.policy_fact,policy_commission_scoped.installment_fact TO authenticated;
NOTIFY pgrst, 'reload schema';
