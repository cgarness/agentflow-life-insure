-- =====================================================================================================
-- Reports: secured, scope-enforced, canonical report RPCs (replaces the four legacy rpc_report_*)
-- =====================================================================================================
-- STATUS: AUTHORED 2026-09-28 on branch claude/reports-analytics-overnight-c69826 under Chris's
-- approval of plan rev 2 (docs/plans/2026-09-28-reports-analytics/implementation_plan.md) for BRANCH
-- IMPLEMENTATION AND TESTING ONLY. Applied only to disposable localhost databases. NOT APPLIED to
-- jncvvsvckxhqgqvkppmj or any hosted project. Production apply is separately gated (AGENT_RULES #28).
-- apply_migration stamps its own version: reconcile the FILENAME afterwards, never these bytes.
--
-- WHY
--   The four legacy functions public.rpc_report_{call_summary,call_volume_timeseries,
--   disposition_breakdown,campaign_performance}(uuid,timestamptz,timestamptz,uuid) are SECURITY
--   DEFINER, take the tenant from a caller-supplied p_org_id, never read auth.uid(), and are
--   EXECUTE-able by anon (read-only production catalog check 2026-09-28). Any holder of the public anon
--   key can read any organization's call aggregates and agent names. They also deviate from the
--   metric canon, and one of them reads a column that does not exist (campaigns.campaign_type).
--
-- WHAT THIS MIGRATION DOES
--   1. Preflight: refuses unless the legacy bodies are the audited production preimages (prosrc
--      md5), owned by postgres, SECURITY DEFINER, with no unexpected grantee; refuses a replay.
--   2. Creates private helpers (REVOKEd from PUBLIC/anon/authenticated) and seven public RPCs:
--        get_report_scope()
--        get_report_call_summary(date, date, uuid)
--        get_report_call_volume(date, date, uuid)
--        get_report_disposition_breakdown(date, date, uuid)
--        get_report_campaign_performance(date, date, uuid)
--        get_report_lead_source_performance(date, date, uuid)
--      EXECUTE: authenticated + service_role only.
--   3. REVOKEs EXECUTE on the four legacy functions from PUBLIC, anon and authenticated. They are
--      kept (postgres + service_role) so nothing needs reconstructing; no rollback may re-grant them.
--   No table, column, index, RLS policy, trigger, or grant on any table is created or changed.
--
-- SECURITY MODEL (every public RPC)
--   * Actor from private.campaign_actor(): requires auth.uid() and organization context, reads role /
--     organization / is_super_admin / status from public.profiles (never the JWT role claim), requires
--     the profile org to equal public.get_org_id() and status = 'Active'; raises 42501 otherwise.
--   * NO organization parameter exists. The tenant is always the actor's database-resolved org, so a
--     forged org cannot even be expressed. Admin / Super Admin see their HOME organization only.
--   * Agent / Team Leader scope comes from the existing configurable permissions stored in
--     public.role_permissions (page "Reports", features "View Own Reports" / "View Team Reports" /
--     "Export Reports", data scope "Dashboard & Reports"), with defaults mirroring
--     src/config/permissionDefaults.ts (pinned by src/lib/__tests__/reportsContracts.test.ts).
--   * p_agent_id may only NARROW the resolved scope; outside it -> 42501. NULL never widens.
--   * SECURITY DEFINER bypasses RLS by design; each function authorizes before any business read and
--     returns aggregates plus agent display names only (no phone, email, notes, lead/contact ids).
--   * search_path = pg_catalog, pg_temp; every non-catalog object is schema-qualified.
--
-- REPORTING TIME ZONE (plan rev 2 R2.1)
--   The agency time zone is resolved on the server from public.company_settings.timezone for the
--   actor's organization; callers pass LOCAL AGENCY CALENDAR DATES, never a zone. The window is the
--   half-open [p_start_date 00:00, (p_end_date + 1) 00:00) in that zone (IANA rules handle DST).
--   Every bucket (day / hour / day-of-week / heatmap) uses the same zone, and every payload returns it.
--   No settings row or a NULL zone -> the platform agency default 'America/Chicago' (the column default
--   and BrandingContext DEFAULTS), labelled time_zone_source = 'default'. An invalid stored zone fails.
--
-- METRIC CANON (AGENT_RULES #8, #12, #13, #17, #23; plan rev 2 D-2..D-6)
--   Calls Made      outbound (lower(coalesce(direction,'')) IN ('outbound','outgoing')), calls.created_at.
--   Talk Time       SUM(greatest(coalesce(calls.duration,0),0)) over Calls Made (Twilio-written only).
--   Contacted       outbound AND NOT resolved-name 'no answer' AND (duration > 45 OR the disposition's
--                   counts_as_contacted, by disposition_id, else org-scoped lower(name) fallback).
--   Converted       DISTINCT contacts (campaign lead, else contact, else call) with >= 1 outbound call
--                   whose disposition's pipeline stage has convert_to_client = true.
--   Policies Sold   COUNT(wins) by wins.created_at, attributed to wins.agent_id. Never clients.
--   Appointments    appointments by created_at, attributed COALESCE(created_by, user_id), no status filter.
--   Session time    server-timestamped dialer_sessions only, each session CLIPPED to the window
--                   (overlap, including sessions that began before it).
--   Rates           contact_rate_pct = contacted / calls_made; NULL (never 0) when the denominator is 0.
--                   There is deliberately NO conversion rate of any kind (plan rev 2 R2.2).
-- =====================================================================================================

SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------------------------
-- 0. PREFLIGHT — refuse on drift or replay. Nothing below runs if this raises.
-- -----------------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_expected constant jsonb := pg_catalog.jsonb_build_object(
    'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)',           'eb741e0d0ea2d5dc8395f92a27a38d87',
    'public.rpc_report_call_volume_timeseries(uuid,timestamptz,timestamptz,uuid)', '7d17e968c40deabf9cd2e3412138560f',
    'public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid)',   '521abcbc1a86c9928d244d049c25da0e',
    'public.rpc_report_disposition_breakdown(uuid,timestamptz,timestamptz,uuid)',  '9dc9273f525647ffbead6caa9bfedfc0'
  );
  v_sig        text;
  v_md5        text;
  v_oid        oid;
  v_unexpected text[];
BEGIN
  FOR v_sig, v_md5 IN SELECT e.key, e.value #>> '{}' FROM pg_catalog.jsonb_each(v_expected) e LOOP
    v_oid := pg_catalog.to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'reports preflight: % is missing; refusing', v_sig;
    END IF;
    IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> v_md5 THEN
      RAISE EXCEPTION 'reports preflight: % no longer matches the audited production body; refusing', v_sig;
    END IF;
    IF (SELECT p.proowner <> 'postgres'::regrole OR NOT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION 'reports preflight: % owner or security mode changed; refusing', v_sig;
    END IF;
    SELECT pg_catalog.array_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'))
      INTO v_unexpected
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
     WHERE p.oid = v_oid
       AND coalesce(r.rolname, 'PUBLIC') NOT IN ('postgres', 'anon', 'authenticated', 'service_role', 'PUBLIC');
    IF v_unexpected IS NOT NULL THEN
      RAISE EXCEPTION 'reports preflight: % has unexpected grantees %; refusing', v_sig, v_unexpected;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'public'  AND p.proname LIKE 'get\_report\_%')
        OR (n.nspname = 'private' AND p.proname LIKE 'report\_%')
  ) THEN
    RAISE EXCEPTION 'reports preflight: report objects already exist; refusing replay';
  END IF;

  IF pg_catalog.to_regprocedure('private.campaign_actor()') IS NULL
     OR pg_catalog.to_regprocedure('private.resolve_downline_ids(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'reports preflight: private.campaign_actor / private.resolve_downline_ids missing; refusing';
  END IF;
  IF pg_catalog.to_regclass('public.company_settings') IS NULL
     OR pg_catalog.to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'reports preflight: company_settings / role_permissions missing; refusing';
  END IF;
END
$preflight$;

-- -----------------------------------------------------------------------------------------------
-- 1. private.report_agency_time_zone(org) — the ONE reporting-zone resolver.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_agency_time_zone(p_org uuid)
RETURNS TABLE (time_zone text, time_zone_source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT cs.timezone
    INTO v_tz
    FROM public.company_settings cs
   WHERE cs.organization_id = p_org;

  IF NOT FOUND OR v_tz IS NULL OR btrim(v_tz) = '' THEN
    -- Platform agency default: company_settings.timezone column default and BrandingContext DEFAULTS.
    RETURN QUERY SELECT 'America/Chicago'::text, 'default'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tz) THEN
    RAISE EXCEPTION 'reports: the agency time zone setting is not a valid IANA zone'
      USING ERRCODE = 'P0001', HINT = 'Fix the time zone in Settings > Company Branding.';
  END IF;

  RETURN QUERY SELECT v_tz, 'agency_settings'::text;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- 2. private.report_permission_flags(org, role) — mirror of usePermissions for Agent / Team Leader.
--    Stored row: role_permissions (UNIQUE organization_id, role). The row for role R is read with
--    key 'agent' (Agent) or 'teamLeader' (Team Leader), exactly as usePermissions does.
--    A missing row / non-object / non-array block -> the permissionDefaults.ts defaults.
--    FAIL CLOSED where the browser is lenient: a non-boolean flag is false; a scope outside
--    own|team|all is 'own'. Defaults are pinned equal to permissionDefaults.ts by a vitest contract.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_permission_flags(p_org uuid, p_role text)
RETURNS TABLE (page_access boolean, view_own boolean, view_team boolean, can_export boolean, data_scope text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_key    text;
  v_perm   jsonb;
  v_page   boolean;
  v_own    boolean;
  v_team   boolean;
  v_export boolean;
  v_scope  text;
  v_val    jsonb;
BEGIN
  IF p_role = 'Agent' THEN
    v_key := 'agent';
    -- REPORTS_DEFAULTS agent: page=false own=true team=false export=false scope=own
    v_page := false; v_own := true; v_team := false; v_export := false; v_scope := 'own';
  ELSIF p_role = 'Team Leader' THEN
    v_key := 'teamLeader';
    -- REPORTS_DEFAULTS teamLeader: page=true own=true team=true export=true scope=team
    v_page := true; v_own := true; v_team := true; v_export := true; v_scope := 'team';
  ELSE
    RAISE EXCEPTION 'reports: role has no configurable report permissions' USING ERRCODE = '42501';
  END IF;

  SELECT rp.permissions
    INTO v_perm
    FROM public.role_permissions rp
   WHERE rp.organization_id = p_org
     AND rp.role = p_role;

  IF NOT FOUND OR v_perm IS NULL OR jsonb_typeof(v_perm) <> 'object' THEN
    RETURN QUERY SELECT v_page, v_own, v_team, v_export, v_scope;
    RETURN;
  END IF;

  -- Page access: first p[] element named 'Reports'; absent -> false (hasPageAccess).
  IF jsonb_typeof(v_perm -> 'p') = 'array' THEN
    v_val := NULL;
    SELECT e.el -> v_key INTO v_val
      FROM jsonb_array_elements(v_perm -> 'p') WITH ORDINALITY e(el, ord)
     WHERE jsonb_typeof(e.el) = 'object' AND e.el ->> 'name' = 'Reports'
     ORDER BY e.ord
     LIMIT 1;
    v_page := (jsonb_typeof(v_val) = 'boolean' AND v_val = 'true'::jsonb);
    v_page := coalesce(v_page, false);
  END IF;

  -- Features: first match across categories in order; absent -> false (hasFeatureAccess).
  IF jsonb_typeof(v_perm -> 'f') = 'array' THEN
    SELECT
      coalesce(bool_or(x.name = 'View Own Reports'  AND x.val), false),
      coalesce(bool_or(x.name = 'View Team Reports' AND x.val), false),
      coalesce(bool_or(x.name = 'Export Reports'    AND x.val), false)
      INTO v_own, v_team, v_export
      FROM (
        SELECT DISTINCT ON (f.ft ->> 'name')
               f.ft ->> 'name' AS name,
               (jsonb_typeof(f.ft -> v_key) = 'boolean' AND (f.ft -> v_key) = 'true'::jsonb) AS val
          FROM jsonb_array_elements(v_perm -> 'f') WITH ORDINALITY c(cat, ci)
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.cat -> 'features') = 'array' THEN c.cat -> 'features' ELSE '[]'::jsonb END
          ) WITH ORDINALITY f(ft, fi)
         WHERE jsonb_typeof(f.ft) = 'object'
           AND f.ft ->> 'name' IN ('View Own Reports', 'View Team Reports', 'Export Reports')
         ORDER BY f.ft ->> 'name', c.ci, f.fi
      ) x;
  END IF;

  -- Data scope: first d[] element labelled 'Dashboard & Reports'; absent -> 'own' (getDataScope).
  IF jsonb_typeof(v_perm -> 'd') = 'array' THEN
    v_val := NULL;
    SELECT e.el -> v_key INTO v_val
      FROM jsonb_array_elements(v_perm -> 'd') WITH ORDINALITY e(el, ord)
     WHERE jsonb_typeof(e.el) = 'object' AND e.el ->> 'label' = 'Dashboard & Reports'
     ORDER BY e.ord
     LIMIT 1;
    v_scope := CASE
                 WHEN jsonb_typeof(v_val) = 'string' AND (v_val #>> '{}') IN ('own', 'team', 'all')
                   THEN v_val #>> '{}'
                 ELSE 'own'
               END;
  END IF;

  RETURN QUERY SELECT v_page, v_own, v_team, v_export, v_scope;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- 3. private.report_access(p_agent_id) — the ONE authorization + scope resolver. Raises 42501.
--    scope 'organization' -> agent_ids NULL (every call in the actor's org, incl. unattributed).
--    scope 'team'         -> self + private.resolve_downline_ids (upline_id walk, org-constrained).
--    scope 'own'          -> self.
--    p_agent_id narrows to exactly one agent inside that scope; anything else is refused.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_access(p_agent_id uuid)
RETURNS TABLE (uid uuid, org_id uuid, actor_role text, scope text, can_export boolean,
               agent_ids uuid[], filter_agent_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor  RECORD;
  v_flags  RECORD;
  v_scope  text;
  v_ids    uuid[];
  v_export boolean;
BEGIN
  -- Raises 42501: unauthenticated / no org context / missing profile / org mismatch / not Active.
  SELECT * INTO v_actor FROM private.campaign_actor();

  IF v_actor.is_super OR v_actor.actor_role IN ('Admin', 'Super Admin') THEN
    -- Locked full access, bound to the actor's HOME organization (campaign_actor proved it).
    v_scope  := 'organization';
    v_ids    := NULL;
    v_export := true;
  ELSIF v_actor.actor_role IN ('Agent', 'Team Leader') THEN
    SELECT * INTO v_flags FROM private.report_permission_flags(v_actor.org_id, v_actor.actor_role);

    IF NOT coalesce(v_flags.page_access, false) THEN
      RAISE EXCEPTION 'reports: Reports access is not enabled for your role' USING ERRCODE = '42501';
    END IF;
    v_export := coalesce(v_flags.can_export, false);

    IF v_flags.data_scope IN ('team', 'all') AND coalesce(v_flags.view_team, false) THEN
      IF v_flags.data_scope = 'all' THEN
        v_scope := 'organization';
        v_ids   := NULL;
      ELSE
        v_scope := 'team';
        SELECT array_agg(d.agent_id ORDER BY d.agent_id)
          INTO v_ids
          FROM private.resolve_downline_ids(v_actor.uid, v_actor.org_id) d;
        IF v_ids IS NULL OR NOT (v_actor.uid = ANY (v_ids)) THEN
          v_ids := array_append(coalesce(v_ids, ARRAY[]::uuid[]), v_actor.uid);
        END IF;
      END IF;
    ELSIF coalesce(v_flags.view_own, false) THEN
      v_scope := 'own';
      v_ids   := ARRAY[v_actor.uid];
    ELSE
      RAISE EXCEPTION 'reports: no report scope is enabled for your role' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'reports: unsupported role' USING ERRCODE = '42501';
  END IF;

  IF p_agent_id IS NOT NULL THEN
    IF v_scope = 'organization' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = p_agent_id AND p.organization_id = v_actor.org_id
      ) THEN
        RAISE EXCEPTION 'reports: agent is outside your report scope' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT (p_agent_id = ANY (v_ids)) THEN
      RAISE EXCEPTION 'reports: agent is outside your report scope' USING ERRCODE = '42501';
    END IF;
    v_ids := ARRAY[p_agent_id];
  END IF;

  RETURN QUERY SELECT v_actor.uid, v_actor.org_id, v_actor.actor_role, v_scope, v_export, v_ids, p_agent_id;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- 4. private.report_window(org, start_date, end_date) — agency-zone half-open window. 22023 on bad input.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_window(p_org uuid, p_start_date date, p_end_date date)
RETURNS TABLE (time_zone text, time_zone_source text, start_date date, end_date date,
               start_at timestamptz, end_at timestamptz, day_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tz RECORD;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'reports: start and end dates are required' USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'reports: end date is before start date' USING ERRCODE = '22023';
  END IF;
  IF (p_end_date - p_start_date) + 1 > 366 THEN
    RAISE EXCEPTION 'reports: date range is longer than 366 days' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_tz FROM private.report_agency_time_zone(p_org);

  RETURN QUERY SELECT
    v_tz.time_zone,
    v_tz.time_zone_source,
    p_start_date,
    p_end_date,
    (p_start_date::timestamp)     AT TIME ZONE v_tz.time_zone,
    ((p_end_date + 1)::timestamp) AT TIME ZONE v_tz.time_zone,
    (p_end_date - p_start_date) + 1;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- 5. private.report_call_facts(org, start, end, agent_ids) — one row per call in scope, with the
--    canonical classification computed ONCE for every Reports RPC.
--    Disposition: by disposition_id (org-guarded); else org-scoped lower(name) fallback, only when
--    disposition_id IS NULL (unique index dispositions_org_lower_name_unique keeps it to one row).
--    Contacted mirrors get_campaign_card_stats / get_trusted_today_dialer_stats exactly.
--    Campaign: calls.campaign_id (else the campaign lead's campaign), org-guarded; the campaign lead
--    counts only when it belongs to that campaign. Lead: AGENT_RULES §5 compatibility relation.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_call_facts(p_org uuid, p_start timestamptz, p_end timestamptz, p_agent_ids uuid[])
RETURNS TABLE (
  call_id              uuid,
  agent_id             uuid,
  direction_class      text,
  created_at           timestamptz,
  duration_seconds     bigint,
  campaign_id          uuid,
  campaign_lead_id     uuid,
  converted_key        text,
  lead_id              uuid,
  lead_source          text,
  disposition_key      text,
  disposition_name     text,
  disposition_color    text,
  disp_counts_contacted boolean,
  disp_converts        boolean,
  disp_dnc             boolean,
  disp_callback        boolean,
  disp_appointment     boolean,
  is_contacted         boolean,
  is_converting        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH base AS (
    SELECT
      c.id,
      c.agent_id,
      CASE
        WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['outbound', 'outgoing']) THEN 'outbound'
        WHEN lower(coalesce(c.direction, '')) = ANY (ARRAY['inbound', 'incoming'])  THEN 'inbound'
        ELSE 'other'
      END                                                     AS direction_class,
      c.created_at,
      greatest(coalesce(c.duration, 0), 0)::bigint           AS duration_seconds,
      cmp.id                                                  AS campaign_id,
      CASE WHEN cl.campaign_id = cmp.id THEN cl.id END        AS campaign_lead_id,
      c.contact_id,
      coalesce(l1.id, l2.id)                                  AS lead_id,
      coalesce(l1.lead_source, l2.lead_source)                AS raw_lead_source,
      c.disposition_id,
      c.disposition_name                                      AS raw_disposition_name,
      coalesce(di.id, dn.id)                                  AS resolved_disposition_id,
      coalesce(di.name, dn.name)                              AS resolved_disposition_name,
      coalesce(di.color, dn.color)                            AS resolved_color,
      coalesce(di.counts_as_contacted, dn.counts_as_contacted, false) AS counts_contacted,
      coalesce(ps.convert_to_client, false)                   AS converts,
      coalesce(di.dnc_auto_add, dn.dnc_auto_add, false)       AS dnc,
      coalesce(di.callback_scheduler, dn.callback_scheduler, false) AS callback,
      coalesce(di.appointment_scheduler, dn.appointment_scheduler, false) AS appointment
    FROM public.calls c
    LEFT JOIN public.dispositions di
           ON di.id = c.disposition_id
          AND di.organization_id = p_org
    LEFT JOIN public.dispositions dn
           ON c.disposition_id IS NULL
          AND c.disposition_name IS NOT NULL
          AND lower(dn.name) = lower(c.disposition_name)
          AND dn.organization_id = p_org
    LEFT JOIN public.pipeline_stages ps
           ON ps.id = coalesce(di.pipeline_stage_id, dn.pipeline_stage_id)
          AND ps.organization_id = p_org
    LEFT JOIN public.campaign_leads cl
           ON cl.id = c.campaign_lead_id
    LEFT JOIN public.campaigns cmp
           ON cmp.id = coalesce(c.campaign_id, cl.campaign_id)
          AND cmp.organization_id = p_org
    LEFT JOIN public.leads l1
           ON l1.id = c.lead_id
          AND l1.organization_id = p_org
    LEFT JOIN public.leads l2
           ON c.lead_id IS NULL
          AND l2.id = c.contact_id
          AND (c.contact_type = 'lead' OR c.contact_type IS NULL)
          AND l2.organization_id = p_org
    WHERE c.organization_id = p_org
      AND c.created_at >= p_start
      AND c.created_at <  p_end
      AND (p_agent_ids IS NULL OR c.agent_id = ANY (p_agent_ids))
  )
  SELECT
    b.id,
    b.agent_id,
    b.direction_class,
    b.created_at,
    b.duration_seconds,
    b.campaign_id,
    b.campaign_lead_id,
    coalesce(b.campaign_lead_id::text, b.contact_id::text, b.id::text),
    b.lead_id,
    coalesce(nullif(btrim(b.raw_lead_source), ''), '(No source)'),
    CASE
      WHEN b.resolved_disposition_id IS NOT NULL THEN b.resolved_disposition_id::text
      WHEN nullif(btrim(b.raw_disposition_name), '') IS NOT NULL
        THEN 'name:' || lower(btrim(b.raw_disposition_name))
      ELSE 'none'
    END,
    coalesce(b.resolved_disposition_name, nullif(btrim(b.raw_disposition_name), ''), '(No disposition)'),
    coalesce(b.resolved_color, '#6B7280'),
    b.counts_contacted,
    b.converts,
    b.dnc,
    b.callback,
    b.appointment,
    -- Canonical Contacted (outbound only). No Answer is tested first, on the resolved name.
    CASE
      WHEN b.direction_class <> 'outbound' THEN false
      WHEN lower(coalesce(b.resolved_disposition_name, b.raw_disposition_name, '')) = 'no answer' THEN false
      WHEN b.duration_seconds > 45 THEN true
      WHEN b.counts_contacted THEN true
      ELSE false
    END,
    (b.direction_class = 'outbound' AND b.converts)
  FROM base b;
$$;

-- -----------------------------------------------------------------------------------------------
-- 6. private.report_session_seconds(org, start, end, agent_ids) — trusted session time.
--    Server-timestamped dialer_sessions ONLY (never browser timers, never dialer_daily_stats).
--    Effective end (AGENT_RULES #12/#14 span rule): ended_at; else now() for an active session with
--    no ended_at; else coalesce(last_heartbeat_at, started_at). Every session that OVERLAPS
--    [start, end) counts, CLIPPED to the window — including sessions that began before it.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_session_seconds(p_org uuid, p_start timestamptz, p_end timestamptz, p_agent_ids uuid[])
RETURNS TABLE (agent_id uuid, session_seconds bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.agent_id,
         sum(
           greatest(
             0::numeric,
             floor(extract(epoch FROM (least(e.effective_end, p_end) - greatest(s.started_at, p_start))))
           )
         )::bigint
    FROM public.dialer_sessions s
    CROSS JOIN LATERAL (
      SELECT coalesce(
               s.ended_at,
               CASE
                 WHEN s.status = 'active' AND s.ended_at IS NULL THEN now()
                 ELSE coalesce(s.last_heartbeat_at, s.started_at)
               END
             ) AS effective_end
    ) e
   WHERE s.organization_id = p_org
     AND s.started_at < p_end
     AND e.effective_end > p_start
     AND (p_agent_ids IS NULL OR s.agent_id = ANY (p_agent_ids))
   GROUP BY s.agent_id;
$$;

-- -----------------------------------------------------------------------------------------------
-- 7. private.report_agent_name(first, last) — display name only; never an email fallback.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_agent_name(p_first text, p_last text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(p_first), ''), nullif(btrim(p_last), ''))), ''), 'Unnamed agent');
$$;

-- -----------------------------------------------------------------------------------------------
-- 8. private.report_meta(...) — the metadata block every payload carries.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_meta(p_scope text, p_filter_agent uuid, p_time_zone text, p_time_zone_source text,
                                    p_start_date date, p_end_date date, p_start_at timestamptz, p_end_at timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  -- Instants are rendered explicitly in UTC so the payload never depends on the session TimeZone.
  SELECT jsonb_build_object(
    'scope',           p_scope,
    'filter_agent_id', p_filter_agent,
    'window', jsonb_build_object(
      'time_zone',        p_time_zone,
      'time_zone_source', p_time_zone_source,
      'start_date',       to_char(p_start_date, 'YYYY-MM-DD'),
      'end_date',         to_char(p_end_date, 'YYYY-MM-DD'),
      'start_at',         to_char(p_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'end_at',           to_char(p_end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  );
$$;

-- =====================================================================================================
-- PUBLIC RPCs
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------
-- get_report_scope() — who may see what, the agency zone and today; the ONLY source of the
-- agent selector. Names only (no email). Own -> self; team -> resolved set; org -> non-Deleted roster.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_scope()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_tz     RECORD;
  v_agents jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(NULL);
  SELECT * INTO v_tz FROM private.report_agency_time_zone(v_access.org_id);

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',     p.id,
               'name',   private.report_agent_name(p.first_name, p.last_name),
               'status', p.status
             )
             ORDER BY lower(private.report_agent_name(p.first_name, p.last_name)), p.id
           ),
           '[]'::jsonb)
    INTO v_agents
    FROM public.profiles p
   WHERE p.organization_id = v_access.org_id
     AND (
           (v_access.agent_ids IS NULL AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted')
        OR (v_access.agent_ids IS NOT NULL AND p.id = ANY (v_access.agent_ids))
         );

  RETURN jsonb_build_object(
    'scope',            v_access.scope,
    'role',             v_access.actor_role,
    'can_export',       v_access.can_export,
    'self_id',          v_access.uid,
    'time_zone',        v_tz.time_zone,
    'time_zone_source', v_tz.time_zone_source,
    'today',            (now() AT TIME ZONE v_tz.time_zone)::date,
    'max_range_days',   366,
    'agents',           v_agents
  );
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_call_summary(start_date, end_date, agent_id)
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_call_summary(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT * FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
  ),
  w AS (
    SELECT wn.agent_id
      FROM public.wins wn
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
  ),
  ap AS (
    SELECT coalesce(a.created_by, a.user_id) AS agent_id
      FROM public.appointments a
     WHERE a.organization_id = v_access.org_id
       AND a.created_at >= v_win.start_at
       AND a.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR coalesce(a.created_by, a.user_id) = ANY (v_access.agent_ids))
  ),
  s AS (
    SELECT * FROM private.report_session_seconds(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
  ),
  call_agg AS (
    SELECT f.agent_id,
           count(*) FILTER (WHERE f.direction_class = 'outbound')                        AS calls_made,
           count(*) FILTER (WHERE f.direction_class = 'inbound')                         AS inbound_calls,
           count(*) FILTER (WHERE f.direction_class = 'other')                           AS other_calls,
           count(*) FILTER (WHERE f.is_contacted)                                        AS contacted,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.direction_class = 'outbound'), 0) AS talk_time_seconds,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.direction_class = 'inbound'), 0)  AS inbound_talk_seconds,
           count(DISTINCT f.converted_key) FILTER (WHERE f.is_converting)                AS converted,
           count(*) FILTER (WHERE f.direction_class = 'outbound' AND f.disp_dnc)         AS dnc_calls,
           count(*) FILTER (WHERE f.direction_class = 'outbound' AND f.disp_callback)    AS callback_calls
      FROM f
     GROUP BY f.agent_id
  ),
  win_agg  AS (SELECT w.agent_id,  count(*) AS policies_sold    FROM w  GROUP BY w.agent_id),
  appt_agg AS (SELECT ap.agent_id, count(*) AS appointments_set FROM ap GROUP BY ap.agent_id),
  roster AS (
    SELECT p.id AS agent_id
      FROM public.profiles p
     WHERE p.organization_id = v_access.org_id
       AND (
             (v_access.agent_ids IS NULL AND p.status = 'Active' AND v_access.filter_agent_id IS NULL)
          OR (v_access.agent_ids IS NOT NULL AND p.id = ANY (v_access.agent_ids)
              AND coalesce(p.status, '') IS DISTINCT FROM 'Deleted')
           )
    UNION
    SELECT agent_id FROM call_agg WHERE agent_id IS NOT NULL
    UNION
    SELECT agent_id FROM win_agg  WHERE agent_id IS NOT NULL
    UNION
    SELECT agent_id FROM appt_agg WHERE agent_id IS NOT NULL
    UNION
    SELECT agent_id FROM s        WHERE agent_id IS NOT NULL
  ),
  per_agent AS (
    SELECT r.agent_id,
           private.report_agent_name(p.first_name, p.last_name) AS name,
           p.status,
           coalesce(ca.calls_made, 0)           AS calls_made,
           coalesce(ca.inbound_calls, 0)        AS inbound_calls,
           coalesce(ca.contacted, 0)            AS contacted,
           coalesce(ca.talk_time_seconds, 0)    AS talk_time_seconds,
           coalesce(ca.converted, 0)            AS converted,
           coalesce(wa.policies_sold, 0)        AS policies_sold,
           coalesce(aa.appointments_set, 0)     AS appointments_set,
           coalesce(ss.session_seconds, 0)      AS session_seconds
      FROM roster r
      LEFT JOIN public.profiles p ON p.id = r.agent_id AND p.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.agent_id = r.agent_id
      LEFT JOIN win_agg  wa ON wa.agent_id = r.agent_id
      LEFT JOIN appt_agg aa ON aa.agent_id = r.agent_id
      LEFT JOIN s        ss ON ss.agent_id = r.agent_id
  ),
  totals AS (
    SELECT
      (SELECT count(*) FROM f WHERE f.direction_class = 'outbound')                          AS calls_made,
      (SELECT count(*) FROM f WHERE f.direction_class = 'inbound')                           AS inbound_calls,
      (SELECT count(*) FROM f WHERE f.direction_class = 'other')                             AS other_calls,
      (SELECT count(*) FROM f)                                                               AS total_calls,
      (SELECT count(*) FROM f WHERE f.is_contacted)                                          AS contacted,
      (SELECT coalesce(sum(f.duration_seconds), 0) FROM f WHERE f.direction_class = 'outbound') AS talk_time_seconds,
      (SELECT coalesce(sum(f.duration_seconds), 0) FROM f WHERE f.direction_class = 'inbound')  AS inbound_talk_seconds,
      (SELECT count(DISTINCT f.converted_key) FROM f WHERE f.is_converting)                  AS converted,
      (SELECT count(*) FROM w)                                                               AS policies_sold,
      (SELECT count(*) FROM ap)                                                              AS appointments_set,
      (SELECT count(*) FROM f WHERE f.direction_class = 'outbound' AND f.disp_dnc)           AS dnc_calls,
      (SELECT count(*) FROM f WHERE f.direction_class = 'outbound' AND f.disp_callback)      AS callback_calls,
      (SELECT coalesce(sum(s.session_seconds), 0) FROM s)                                    AS session_seconds
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'totals', jsonb_build_object(
        'calls_made',                t.calls_made,
        'inbound_calls',             t.inbound_calls,
        'other_calls',               t.other_calls,
        'total_calls',               t.total_calls,
        'contacted',                 t.contacted,
        'contact_rate_pct',          CASE WHEN t.calls_made > 0 THEN round(100.0 * t.contacted / t.calls_made, 1) END,
        'talk_time_seconds',         t.talk_time_seconds,
        'avg_talk_per_dial_seconds', CASE WHEN t.calls_made > 0 THEN round(t.talk_time_seconds::numeric / t.calls_made, 1) END,
        'inbound_talk_seconds',      t.inbound_talk_seconds,
        'converted',                 t.converted,
        'policies_sold',             t.policies_sold,
        'appointments_set',          t.appointments_set,
        'dnc_calls',                 t.dnc_calls,
        'callback_calls',            t.callback_calls,
        'session_seconds',           t.session_seconds
      ),
      'by_agent', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'agent_id',          pa.agent_id,
                   'name',              pa.name,
                   'status',            pa.status,
                   'calls_made',        pa.calls_made,
                   'inbound_calls',     pa.inbound_calls,
                   'contacted',         pa.contacted,
                   'contact_rate_pct',  CASE WHEN pa.calls_made > 0 THEN round(100.0 * pa.contacted / pa.calls_made, 1) END,
                   'talk_time_seconds', pa.talk_time_seconds,
                   'converted',         pa.converted,
                   'policies_sold',     pa.policies_sold,
                   'appointments_set',  pa.appointments_set,
                   'session_seconds',   pa.session_seconds
                 )
                 ORDER BY pa.calls_made DESC, lower(pa.name), pa.agent_id
               )
          FROM per_agent pa
      ), '[]'::jsonb),
      'unattributed', jsonb_build_object(
        'calls_made',        coalesce((SELECT ca.calls_made        FROM call_agg ca WHERE ca.agent_id IS NULL), 0),
        'inbound_calls',     coalesce((SELECT ca.inbound_calls     FROM call_agg ca WHERE ca.agent_id IS NULL), 0),
        'talk_time_seconds', coalesce((SELECT ca.talk_time_seconds FROM call_agg ca WHERE ca.agent_id IS NULL), 0),
        'policies_sold',     coalesce((SELECT wa.policies_sold     FROM win_agg  wa WHERE wa.agent_id IS NULL), 0),
        'appointments_set',  coalesce((SELECT aa.appointments_set  FROM appt_agg aa WHERE aa.agent_id IS NULL), 0)
      )
    )
    INTO v_result
    FROM totals t;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_call_volume(start_date, end_date, agent_id) — agency-zone local buckets, zero-filled.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_call_volume(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT fc.*, (fc.created_at AT TIME ZONE v_win.time_zone) AS local_ts
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids) fc
  ),
  w AS (
    SELECT (wn.created_at AT TIME ZONE v_win.time_zone)::date AS local_date
      FROM public.wins wn
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
  ),
  days AS (
    SELECT d::date AS local_date
      FROM generate_series(v_win.start_date::timestamp, v_win.end_date::timestamp, interval '1 day') d
  ),
  day_calls AS (
    SELECT f.local_ts::date AS local_date,
           count(*) FILTER (WHERE f.direction_class = 'outbound') AS calls_made,
           count(*) FILTER (WHERE f.is_contacted)                 AS contacted,
           count(*) FILTER (WHERE f.direction_class = 'inbound')  AS inbound_calls,
           coalesce(sum(f.duration_seconds) FILTER (WHERE f.direction_class = 'outbound'), 0) AS talk_time_seconds
      FROM f
     GROUP BY 1
  ),
  day_wins AS (SELECT w.local_date, count(*) AS policies_sold FROM w GROUP BY 1),
  hours AS (SELECT h FROM generate_series(0, 23) h),
  dows  AS (SELECT d FROM generate_series(0, 6) d),
  cells AS (
    SELECT extract(dow  FROM f.local_ts)::int AS dow,
           extract(hour FROM f.local_ts)::int AS hour_of_day,
           count(*)                            AS calls_made,
           count(*) FILTER (WHERE f.is_contacted) AS contacted
      FROM f
     WHERE f.direction_class = 'outbound'
     GROUP BY 1, 2
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'by_date', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'date',              to_char(dy.local_date, 'YYYY-MM-DD'),
                   'calls_made',        coalesce(dc.calls_made, 0),
                   'contacted',         coalesce(dc.contacted, 0),
                   'inbound_calls',     coalesce(dc.inbound_calls, 0),
                   'talk_time_seconds', coalesce(dc.talk_time_seconds, 0),
                   'policies_sold',     coalesce(dw.policies_sold, 0)
                 )
                 ORDER BY dy.local_date
               )
          FROM days dy
          LEFT JOIN day_calls dc ON dc.local_date = dy.local_date
          LEFT JOIN day_wins  dw ON dw.local_date = dy.local_date
      ),
      'by_hour', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'hour',       hr.h,
                   'calls_made', coalesce((SELECT sum(c.calls_made) FROM cells c WHERE c.hour_of_day = hr.h), 0),
                   'contacted',  coalesce((SELECT sum(c.contacted)  FROM cells c WHERE c.hour_of_day = hr.h), 0)
                 )
                 ORDER BY hr.h
               )
          FROM hours hr
      ),
      'by_day_of_week', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'dow',        dw.d,
                   'dow_name',   (ARRAY['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[dw.d + 1],
                   'calls_made', coalesce((SELECT sum(c.calls_made) FROM cells c WHERE c.dow = dw.d), 0),
                   'contacted',  coalesce((SELECT sum(c.contacted)  FROM cells c WHERE c.dow = dw.d), 0)
                 )
                 ORDER BY dw.d
               )
          FROM dows dw
      ),
      'heatmap', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'dow',        dw.d,
                   'hour',       hr.h,
                   'calls_made', coalesce(cell.calls_made, 0),
                   'contacted',  coalesce(cell.contacted, 0)
                 )
                 ORDER BY dw.d, hr.h
               )
          FROM dows dw
          CROSS JOIN hours hr
          LEFT JOIN cells cell ON cell.dow = dw.d AND cell.hour_of_day = hr.h
      )
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_disposition_breakdown(start_date, end_date, agent_id) — outbound calls (D-3).
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_disposition_breakdown(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT *
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
     WHERE direction_class = 'outbound'
  ),
  disp AS (
    SELECT f.disposition_key,
           max(f.disposition_name)          AS name,
           max(f.disposition_color)         AS color,
           count(*)                         AS calls,
           round(avg(f.duration_seconds), 1) AS avg_duration_seconds,
           bool_or(f.disp_counts_contacted) AS counts_as_contacted,
           bool_or(f.disp_converts)         AS converts,
           bool_or(f.disp_dnc)              AS dnc,
           bool_or(f.disp_callback)         AS callback,
           bool_or(f.disp_appointment)      AS appointment
      FROM f
     GROUP BY f.disposition_key
  ),
  by_agent AS (
    SELECT x.agent_id,
           private.report_agent_name(p.first_name, p.last_name) AS name,
           jsonb_object_agg(x.disposition_key, x.calls) AS counts,
           sum(x.calls) AS total
      FROM (SELECT f.agent_id, f.disposition_key, count(*) AS calls
              FROM f WHERE f.agent_id IS NOT NULL GROUP BY 1, 2) x
      LEFT JOIN public.profiles p ON p.id = x.agent_id AND p.organization_id = v_access.org_id
     GROUP BY x.agent_id, p.first_name, p.last_name
  ),
  by_campaign AS (
    SELECT x.campaign_id,
           max(cmp.name) AS name,
           jsonb_object_agg(x.disposition_key, x.calls) AS counts,
           sum(x.calls) AS total
      FROM (SELECT f.campaign_id, f.disposition_key, count(*) AS calls
              FROM f WHERE f.campaign_id IS NOT NULL GROUP BY 1, 2) x
      JOIN public.campaigns cmp ON cmp.id = x.campaign_id AND cmp.organization_id = v_access.org_id
     GROUP BY x.campaign_id
  ),
  buckets AS (
    SELECT * FROM (VALUES
      (1, '0-30s',  0::bigint,   30::bigint),
      (2, '30s-1m', 30::bigint,  60::bigint),
      (3, '1-2m',   60::bigint,  120::bigint),
      (4, '2-5m',   120::bigint, 300::bigint),
      (5, '5m+',    300::bigint, NULL::bigint)
    ) v(ord, label, lo, hi)
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'total_calls', (SELECT count(*) FROM f),
      'by_disposition', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'key',                 d.disposition_key,
                   'name',                d.name,
                   'color',               d.color,
                   'calls',               d.calls,
                   'avg_duration_seconds', d.avg_duration_seconds,
                   'counts_as_contacted', d.counts_as_contacted,
                   'converts',            d.converts,
                   'dnc',                 d.dnc,
                   'callback',            d.callback,
                   'appointment',         d.appointment
                 )
                 ORDER BY d.calls DESC, lower(d.name), d.disposition_key
               )
          FROM disp d
      ), '[]'::jsonb),
      'by_agent', coalesce((
        SELECT jsonb_agg(jsonb_build_object('agent_id', a.agent_id, 'name', a.name, 'total', a.total, 'counts', a.counts)
                         ORDER BY a.total DESC, lower(a.name), a.agent_id)
          FROM by_agent a
      ), '[]'::jsonb),
      'by_campaign', coalesce((
        SELECT jsonb_agg(jsonb_build_object('campaign_id', c.campaign_id, 'name', c.name, 'total', c.total, 'counts', c.counts)
                         ORDER BY c.total DESC, lower(c.name), c.campaign_id)
          FROM by_campaign c
      ), '[]'::jsonb),
      'duration_histogram', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'range', b.label,
                   'calls', (SELECT count(*) FROM f
                              WHERE f.duration_seconds >= b.lo
                                AND (b.hi IS NULL OR f.duration_seconds < b.hi))
                 )
                 ORDER BY b.ord
               )
          FROM buckets b
      )
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_campaign_performance(start_date, end_date, agent_id)
--   Only campaigns with an in-scope outbound call or win in the window; no all-time / org-wide size.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_campaign_performance(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT *
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
     WHERE direction_class = 'outbound'
  ),
  call_agg AS (
    SELECT f.campaign_id,
           count(*)                                                        AS calls_made,
           count(*) FILTER (WHERE f.is_contacted)                          AS contacted_calls,
           count(DISTINCT f.campaign_lead_id)                              AS leads_dialed,
           count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_contacted)  AS contacted_leads,
           count(DISTINCT f.campaign_lead_id) FILTER (WHERE f.is_converting) AS converted_leads
      FROM f
     WHERE f.campaign_id IS NOT NULL
     GROUP BY f.campaign_id
  ),
  win_agg AS (
    SELECT wn.campaign_id, count(*) AS policies_sold
      FROM public.wins wn
      JOIN public.campaigns cmp ON cmp.id = wn.campaign_id AND cmp.organization_id = v_access.org_id
     WHERE wn.organization_id = v_access.org_id
       AND wn.created_at >= v_win.start_at
       AND wn.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR wn.agent_id = ANY (v_access.agent_ids))
     GROUP BY wn.campaign_id
  ),
  ids AS (
    SELECT campaign_id FROM call_agg UNION SELECT campaign_id FROM win_agg
  ),
  rows_ AS (
    SELECT i.campaign_id,
           cmp.name,
           cmp.type,
           coalesce(ca.calls_made, 0)      AS calls_made,
           coalesce(ca.contacted_calls, 0) AS contacted_calls,
           coalesce(ca.leads_dialed, 0)    AS leads_dialed,
           coalesce(ca.contacted_leads, 0) AS contacted_leads,
           coalesce(ca.converted_leads, 0) AS converted_leads,
           coalesce(wa.policies_sold, 0)   AS policies_sold
      FROM ids i
      JOIN public.campaigns cmp ON cmp.id = i.campaign_id AND cmp.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.campaign_id = i.campaign_id
      LEFT JOIN win_agg  wa ON wa.campaign_id = i.campaign_id
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'campaigns', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'campaign_id',      r.campaign_id,
                   'name',             r.name,
                   'type',             r.type,
                   'calls_made',       r.calls_made,
                   'contacted_calls',  r.contacted_calls,
                   'contact_rate_pct', CASE WHEN r.calls_made > 0 THEN round(100.0 * r.contacted_calls / r.calls_made, 1) END,
                   'leads_dialed',     r.leads_dialed,
                   'contacted_leads',  r.contacted_leads,
                   'converted_leads',  r.converted_leads,
                   'policies_sold',    r.policies_sold
                 )
                 ORDER BY r.calls_made DESC, lower(r.name), r.campaign_id
               )
          FROM rows_ r
      ), '[]'::jsonb),
      'unattributed_calls', (SELECT count(*) FROM f WHERE f.campaign_id IS NULL)
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_lead_source_performance(start_date, end_date, agent_id)
--   Attribution through CURRENT leads only (AGENT_RULES §5 relation). Converted-by-source is NOT
--   available: conversion deletes the source lead and clients carry no lead_source (plan D-6).
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_report_lead_source_performance(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_access RECORD;
  v_win    RECORD;
  v_result jsonb;
BEGIN
  SELECT * INTO v_access FROM private.report_access(p_agent_id);
  SELECT * INTO v_win FROM private.report_window(v_access.org_id, p_start_date, p_end_date);

  WITH f AS (
    SELECT *
      FROM private.report_call_facts(v_access.org_id, v_win.start_at, v_win.end_at, v_access.agent_ids)
     WHERE direction_class = 'outbound'
  ),
  call_agg AS (
    SELECT f.lead_source,
           count(*)                                         AS calls_made,
           count(*) FILTER (WHERE f.is_contacted)           AS contacted_calls,
           count(DISTINCT f.lead_id)                        AS leads_dialed,
           count(DISTINCT f.lead_id) FILTER (WHERE f.is_contacted) AS contacted_leads
      FROM f
     WHERE f.lead_id IS NOT NULL
     GROUP BY f.lead_source
  ),
  new_leads AS (
    SELECT coalesce(nullif(btrim(l.lead_source), ''), '(No source)') AS lead_source,
           count(*) AS new_leads
      FROM public.leads l
     WHERE l.organization_id = v_access.org_id
       AND l.created_at >= v_win.start_at
       AND l.created_at <  v_win.end_at
       AND (v_access.agent_ids IS NULL OR l.assigned_agent_id = ANY (v_access.agent_ids))
     GROUP BY 1
  ),
  sources AS (
    SELECT lead_source FROM call_agg UNION SELECT lead_source FROM new_leads
  ),
  rows_ AS (
    SELECT s.lead_source,
           coalesce(ca.calls_made, 0)      AS calls_made,
           coalesce(ca.contacted_calls, 0) AS contacted_calls,
           coalesce(ca.leads_dialed, 0)    AS leads_dialed,
           coalesce(ca.contacted_leads, 0) AS contacted_leads,
           coalesce(nl.new_leads, 0)       AS new_leads
      FROM sources s
      LEFT JOIN call_agg  ca ON ca.lead_source = s.lead_source
      LEFT JOIN new_leads nl ON nl.lead_source = s.lead_source
  )
  SELECT
    private.report_meta(v_access.scope, v_access.filter_agent_id, v_win.time_zone, v_win.time_zone_source,
                        v_win.start_date, v_win.end_date, v_win.start_at, v_win.end_at)
    || jsonb_build_object(
      'sources', coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'lead_source',      r.lead_source,
                   'calls_made',       r.calls_made,
                   'contacted_calls',  r.contacted_calls,
                   'contact_rate_pct', CASE WHEN r.calls_made > 0 THEN round(100.0 * r.contacted_calls / r.calls_made, 1) END,
                   'leads_dialed',     r.leads_dialed,
                   'contacted_leads',  r.contacted_leads,
                   'new_leads',        r.new_leads,
                   'converted',        NULL
                 )
                 ORDER BY r.calls_made DESC, r.new_leads DESC, lower(r.lead_source)
               )
          FROM rows_ r
      ), '[]'::jsonb),
      'converted_available', false,
      'converted_unavailable_reason',
        'Conversion removes the source lead and clients carry no lead source, so conversions cannot be attributed to a lead source.',
      'unattributed_calls', (SELECT count(*) FROM f WHERE f.lead_id IS NULL)
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

-- =====================================================================================================
-- GRANTS
-- =====================================================================================================
REVOKE ALL ON FUNCTION private.report_agency_time_zone(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_permission_flags(uuid, text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_access(uuid)                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_window(uuid, date, date)                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_call_facts(uuid, timestamptz, timestamptz, uuid[])  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_session_seconds(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_agent_name(text, text)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_meta(text, uuid, text, text, date, date, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_report_scope()                                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_call_summary(date, date, uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_call_volume(date, date, uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_disposition_breakdown(date, date, uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_campaign_performance(date, date, uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_report_lead_source_performance(date, date, uuid)        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_report_scope()                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_call_summary(date, date, uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_call_volume(date, date, uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_disposition_breakdown(date, date, uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_campaign_performance(date, date, uuid)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_lead_source_performance(date, date, uuid) TO authenticated, service_role;

-- Seal the four known-vulnerable legacy functions. Kept (postgres + service_role) so nothing has to be
-- reconstructed; NO rollback, inverse or recovery procedure may re-grant them (plan rev 2 R2.3).
REVOKE EXECUTE ON FUNCTION public.rpc_report_call_summary(uuid, timestamptz, timestamptz, uuid)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_report_call_volume_timeseries(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_report_campaign_performance(uuid, timestamptz, timestamptz, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_report_disposition_breakdown(uuid, timestamptz, timestamptz, uuid)  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.get_report_scope() IS
  'Reports scope for auth.uid(): own | team | organization (home org only), export flag, agency time zone and today, and the ONLY allowed agent list (names only). Raises 42501 when Reports is not permitted.';
COMMENT ON FUNCTION private.report_access(uuid) IS
  'Reports authorization: actor via private.campaign_actor(); Admin/Super Admin -> home organization; Agent/Team Leader -> role_permissions (page Reports, View Own/Team Reports, Dashboard & Reports scope) with permissionDefaults.ts defaults. p_agent_id only narrows. Raises 42501.';

-- =====================================================================================================
-- POSTCONDITIONS — abort the whole migration unless the security contract holds.
-- =====================================================================================================
DO $post$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_report_scope()',
    'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)',
    'public.get_report_disposition_breakdown(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)',
    'public.get_report_lead_source_performance(date,date,uuid)'
  ] LOOP
    IF NOT (SELECT p.prosecdef AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
              FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) THEN
      RAISE EXCEPTION 'reports postcondition: % metadata wrong', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports postcondition: anon can execute %', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports postcondition: authenticated cannot execute %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_call_volume_timeseries(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_campaign_performance(uuid,timestamptz,timestamptz,uuid)',
    'public.rpc_report_disposition_breakdown(uuid,timestamptz,timestamptz,uuid)'
  ] LOOP
    IF pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports postcondition: legacy % is still executable by a client role', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'private.report_access(uuid)',
    'private.report_call_facts(uuid,timestamptz,timestamptz,uuid[])',
    'private.report_permission_flags(uuid,text)',
    'private.report_agency_time_zone(uuid)'
  ] LOOP
    IF pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports postcondition: % is executable by a client role', v_sig;
    END IF;
  END LOOP;
END
$post$;
