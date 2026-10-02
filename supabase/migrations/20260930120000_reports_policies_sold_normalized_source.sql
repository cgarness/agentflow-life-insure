-- =====================================================================================================
-- Reports: Policies Sold from NORMALIZED STORED POLICIES, never from wins (BUGFIX, 2026-09-30)
-- Plan: implementation_plan.md §20 (rev 2 approved for branch implementation + isolated testing).
-- =====================================================================================================
-- WHY
--   The applied Reports RPCs (20260929152553_reports_secure_scoped_rpcs.sql — NOT edited here) count
--   Policies Sold as COUNT(wins). wins is a sale-EVENT / celebration log: a conversion carrying N policies
--   writes ONE win, manually created and imported clients write NONE, and editing a client never updates
--   its win (AGENT_RULES #34). Production, Chris's organization, 2026-09-01..29: 4 stored policies sold,
--   2 wins, so Reports under-counted by half.
--
-- WHAT A POLICY IS (mirrored from public.get_profile_book_stats — the server canon — not redefined)
--   PRIMARY     a clients row with policy evidence: nonblank carrier OR nonblank policy_number OR
--               premium > 0 OR face_amount > 0 OR sold_date IS NOT NULL. Sale date = clients.sold_date.
--   ADDITIONAL  each jsonb OBJECT element of clients.custom_fields.additional_policies (a non-array
--               container yields none, read through the empty-array-inside-LATERAL guard). Sale date =
--               private.profile_parse_iso_date(coalesce(soldDate, issueDate)) — the legacy issueDate is
--               used only when soldDate is ABSENT (a present-but-invalid soldDate does not fall back).
--   MALFORMED   a container that is present and not an array (JSON null included) counts 1; each
--               non-object element counts 1. Never a policy; reported as a data-quality signal.
--   These two edge rules differ from src/lib/profile/normalized-policy.ts; aligning the TypeScript
--   module is a separate follow-up. Profile behaviour is not changed by this migration.
--
-- DATE SEMANTICS
--   A policy counts in a report when its sale DATE lies within the agency calendar dates of the window
--   (private.report_window start_date..end_date). A sale date is a DATE, so there is no time-zone
--   conversion. A policy with no usable sale date is never dated by created_at or any guess: it is
--   excluded from every dated count and reported in policy_quality.undated_policies, which is
--   SCOPE-WIDE AND ALL-TIME (basis 'scope_wide_all_time') — never implied to belong to the period.
--
-- AGENT ATTRIBUTION (a documented limitation, not seller credit)
--   Policies are credited to the client's CURRENT clients.assigned_agent_id (the column
--   get_profile_book_stats and clients RLS use). It is mutable: reassigning a client moves its
--   policies — including past periods — to the new agent. wins.agent_id is sale-time but exists only
--   for policies that have a win, so it cannot be the source. Payload: policy_basis.agent_attribution
--   = 'current_assignment'. Scope is the SAME agent_ids private.report_access already resolved, so a
--   policy query can never widen own/team/organization scope or an agent filter.
--
-- CAMPAIGN ATTRIBUTION (conversion lineage only)
--   clients has no campaign_id. A client's policies are attributed to campaign X only when, among the
--   same-organization wins whose contact_id is the client and whose campaign_id is set, exactly one is
--   the client's conversion win (idempotency_key = 'conversion:' || clients.lead_id), every one names X,
--   and X is a campaign of the same organization. Anything else — no lineage, conflicting campaigns, a
--   foreign-organization campaign, a manual/imported client (lead_id NULL) — is counted in
--   policies_without_campaign and never inferred. The only writer of an additional_policies array is
--   that same conversion (src/lib/supabase-conversion.ts mergeCustomFieldsOnConversion), so a
--   converted client's additional policies share its lineage. This is NOT complete campaign sales
--   attribution and NOT proof a campaign caused a sale. The COUNT(wins) policies_sold campaign field is
--   REMOVED; campaign rows carry attributed_policies.
--
-- WHAT THIS DOES
--   1. Preflight: exact live bodies (md5 of prosrc read from production 2026-09-30), owner, security
--      metadata and ACL of the three RPCs replaced; dependencies present; refuses replay.
--   2. Four private helpers (client-inaccessible): policy facts, quality, campaign lineage,
--      and caller-authorized campaign visibility shared by campaign/disposition breakdowns.
--   3. CREATE OR REPLACE of get_report_call_summary / get_report_call_volume /
--      get_report_campaign_performance with identical signatures, owner, SECURITY DEFINER, STABLE,
--      search_path and ACL. Each is its applied body with only the wins source replaced, plus
--      policy_source = 'normalized_policies' (the new frontend refuses any payload without it).
--   4. Postconditions: ACL exactly as found (an enabled Reports stays enabled; a DISABLED Reports stays
--      disabled — this migration never re-enables), helpers unreachable by clients, legacy
--      rpc_report_* still sealed, no replaced body references public.wins.
--   No table, column, index, RLS policy, trigger, data row or grant on any table is created or changed.
--   get_report_scope / lead-source RPCs are untouched. Disposition totals stay unchanged; its
--   campaign breakdown now enforces the same campaign visibility. Dialer, Leaderboard and Dashboard
--   keep their event (wins) semantics.
--
-- RECOVERY (fail closed — see implementation_plan.md §20.11.4)
--   Never restore the win-based bodies while Reports is enabled: an older browser tab would render win
--   counts as policy totals. (a) supabase/ops/reports_disable.sql first; (b) only then, optionally, the
--   preimage fixture supabase/migrations/rollback/20260930120000_…rollback.sql (it refuses unless
--   disabled and leaves everything disabled); (c) supabase/ops/reports_enable.sql refuses unless these
--   policy-based bodies are installed. Legacy rpc_report_* stay sealed throughout.
-- =====================================================================================================

SET LOCAL lock_timeout = '5s';

-- Final review: campaign metadata is constrained to campaigns the actual caller may read, including
-- Disposition Deep Dive. Hidden/unknown links retain only non-identifying unavailable counts.

-- -----------------------------------------------------------------------------------------------
-- 0. PREFLIGHT — refuse on drift or replay. Nothing below runs if this raises.
-- -----------------------------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_expected constant jsonb := pg_catalog.jsonb_build_object(
    'public.get_report_call_summary(date,date,uuid)',         'f221e1d470fc70ec92937be66be56e69',
    'public.get_report_call_volume(date,date,uuid)',          '604abca3774fc10daa2c86faa9ff7524',
    'public.get_report_campaign_performance(date,date,uuid)', '9d151bf9ce31bd602af8317f2dd8e124',
    'private.report_access(uuid)',                            '27116a40687390dd31b93848446a2702',
    'private.report_window(uuid,date,date)',                  '1107da185bfc1a3089b27e125c74646d',
    'public.get_report_disposition_breakdown(date,date,uuid)', '38f1b5c0e0e4e3187423639d03db3019',
    'private.profile_parse_iso_date(text)',                   'be24ed08bb42a71b29e3c44abebfd0c9'
  );
  v_sig      text;
  v_md5      text;
  v_oid      oid;
  v_grantees text[];
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private'
       AND p.proname IN ('report_policy_facts', 'report_policy_quality', 'report_policy_campaign_lineage', 'report_visible_campaigns')
  ) THEN
    RAISE EXCEPTION 'reports policy preflight: policy helpers already exist; refusing replay';
  END IF;

  FOR v_sig, v_md5 IN SELECT e.key, e.value #>> '{}' FROM pg_catalog.jsonb_each(v_expected) e LOOP
    v_oid := pg_catalog.to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'reports policy preflight: % is missing; refusing', v_sig;
    END IF;
    IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> v_md5 THEN
      RAISE EXCEPTION 'reports policy preflight: % no longer matches the audited production body; refusing', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)',
    'public.get_report_disposition_breakdown(date,date,uuid)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_sig);
    IF NOT (SELECT p.proowner = 'postgres'::regrole AND p.prosecdef AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
              FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION 'reports policy preflight: % owner or security metadata changed; refusing', v_sig;
    END IF;
    SELECT pg_catalog.array_agg(DISTINCT coalesce(r.rolname, 'PUBLIC') ORDER BY coalesce(r.rolname, 'PUBLIC'))
      INTO v_grantees
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
     WHERE p.oid = v_oid;
    -- Enabled (the release state) or disabled by supabase/ops/reports_disable.sql. Anything else is drift.
    IF v_grantees IS DISTINCT FROM ARRAY['authenticated', 'postgres', 'service_role']
       AND v_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role'] THEN
      RAISE EXCEPTION 'reports policy preflight: % has unexpected grantees %; refusing', v_sig, v_grantees;
    END IF;
    -- Remember the exact ACL: the postcondition requires it unchanged (never re-enabled, never widened).
    PERFORM pg_catalog.set_config('reports_policy.acl_' || pg_catalog.md5(v_sig),
              (SELECT coalesce(p.proacl::text, '') FROM pg_catalog.pg_proc p WHERE p.oid = v_oid), true);
  END LOOP;

  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'campaigns'
        AND column_name IN ('id', 'organization_id', 'user_id', 'type', 'assigned_agent_ids')) <> 5 THEN
    RAISE EXCEPTION 'reports policy preflight: campaign visibility columns are missing';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'clients'
         AND column_name IN ('organization_id', 'assigned_agent_id', 'lead_id', 'carrier', 'policy_number',
                             'premium', 'face_amount', 'sold_date', 'custom_fields')) <> 9
     OR (SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'sold_date') <> 'date'
     OR (SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'custom_fields') <> 'jsonb'
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'wins'
            AND column_name IN ('organization_id', 'contact_id', 'campaign_id', 'idempotency_key')) <> 4 THEN
    RAISE EXCEPTION 'reports policy preflight: clients / wins columns are not the audited shape; refusing';
  END IF;
END
$preflight$;

-- -----------------------------------------------------------------------------------------------
-- 1. private.report_policy_facts(org, agent_ids) — one row per NORMALIZED STORED POLICY in scope.
--    p_agent_ids is private.report_access's resolved scope: NULL only for organization scope (then
--    every client of the organization, including unassigned ones, which surface as unattributed).
--    Rows carry the client's CURRENT assigned agent and the policy's sale date (NULL = undated).
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_policy_facts(p_org uuid, p_agent_ids uuid[])
RETURNS TABLE (client_id uuid, agent_id uuid, source text, sold_date date)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH scoped_clients AS (
    SELECT c.id,
           c.assigned_agent_id,
           c.carrier,
           c.policy_number,
           c.premium,
           c.face_amount,
           c.sold_date,
           c.custom_fields
      FROM public.clients c
     WHERE c.organization_id = p_org
       AND (p_agent_ids IS NULL OR c.assigned_agent_id = ANY (p_agent_ids))
  ),
  primary_policies AS (
    SELECT sc.id                AS client_id,
           sc.assigned_agent_id AS agent_id,
           'primary'::text      AS source,
           sc.sold_date         AS sold_date
      FROM scoped_clients sc
     -- Evidence-based (get_profile_book_stats D-3b): import defaults (policy_type 'Term', premium 0,
     -- face 0, blank carrier/number, no sale date) are a CLIENT, not a policy.
     WHERE nullif(pg_catalog.btrim(sc.carrier), '')       IS NOT NULL
        OR nullif(pg_catalog.btrim(sc.policy_number), '') IS NOT NULL
        OR sc.premium     > 0
        OR sc.face_amount > 0
        OR sc.sold_date   IS NOT NULL
  ),
  additional_policies AS (
    SELECT sc.id                AS client_id,
           sc.assigned_agent_id AS agent_id,
           'additional'::text   AS source,
           -- Legacy tolerance exactly as get_profile_book_stats: issueDate only when soldDate is absent.
           private.profile_parse_iso_date(
             coalesce(e.entry ->> 'soldDate', e.entry ->> 'issueDate')
           )                    AS sold_date
      FROM scoped_clients sc
     -- jsonb_array_elements() raises on a non-array; the guard lives INSIDE the argument (AGENT_RULES #34).
     CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
       CASE
         WHEN pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') = 'array'
         THEN sc.custom_fields -> 'additional_policies'
         ELSE '[]'::jsonb
       END
     ) AS e(entry)
     WHERE pg_catalog.jsonb_typeof(e.entry) = 'object'
  )
  SELECT pp.client_id, pp.agent_id, pp.source, pp.sold_date FROM primary_policies pp
  UNION ALL
  SELECT ap.client_id, ap.agent_id, ap.source, ap.sold_date FROM additional_policies ap;
$$;

-- -----------------------------------------------------------------------------------------------
-- 2. private.report_policy_quality(org, agent_ids) — SCOPE-WIDE, ALL-TIME data-quality counts.
--    Not windowed: an undated policy cannot be placed in any period, so it is never implied to belong
--    to the selected one. Malformed = container present and not an array (JSON null included) + each
--    non-object element (the get_profile_book_stats formula).
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_policy_quality(p_org uuid, p_agent_ids uuid[])
RETURNS TABLE (undated_policies bigint, malformed_additional_policies bigint)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH scoped_clients AS (
    SELECT c.custom_fields
      FROM public.clients c
     WHERE c.organization_id = p_org
       AND (p_agent_ids IS NULL OR c.assigned_agent_id = ANY (p_agent_ids))
  )
  SELECT
    (SELECT pg_catalog.count(*)
       FROM private.report_policy_facts(p_org, p_agent_ids) pf
      WHERE pf.sold_date IS NULL)::bigint,
    ((SELECT pg_catalog.count(*)
        FROM scoped_clients sc
       WHERE sc.custom_fields ? 'additional_policies'
         AND pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') <> 'array')
     +
     (SELECT pg_catalog.count(*)
        FROM scoped_clients sc
       CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
         CASE
           WHEN pg_catalog.jsonb_typeof(sc.custom_fields -> 'additional_policies') = 'array'
           THEN sc.custom_fields -> 'additional_policies'
           ELSE '[]'::jsonb
         END
       ) AS e(entry)
       WHERE pg_catalog.jsonb_typeof(e.entry) <> 'object'))::bigint;
$$;

-- -----------------------------------------------------------------------------------------------
-- 3. private.report_policy_campaign_lineage(org, agent_ids) — AT MOST ONE ROW PER CLIENT (GROUP BY
--    the client), so joining it to policy facts can never multiply a policy. campaign_id is set only
--    when the evidence is unambiguous (see the header); NULL otherwise. Clients with no lineage row at
--    all (lead_id NULL, or no campaign-bearing win) are equally unattributed.
-- -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.report_policy_campaign_lineage(p_org uuid, p_agent_ids uuid[])
RETURNS TABLE (client_id uuid, campaign_id uuid)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.id AS client_id,
         CASE
           WHEN pg_catalog.count(*) FILTER (WHERE w.idempotency_key = 'conversion:' || c.lead_id::text) = 1
            AND pg_catalog.count(DISTINCT w.campaign_id) = 1
            AND pg_catalog.bool_and(cmp.id IS NOT NULL)
           THEN (pg_catalog.array_agg(DISTINCT w.campaign_id))[1]
         END AS campaign_id
    FROM public.clients c
    JOIN public.wins w
      ON w.organization_id = p_org
     AND w.contact_id      = c.id
     AND w.campaign_id IS NOT NULL
    LEFT JOIN public.campaigns cmp
      ON cmp.id = w.campaign_id
     AND cmp.organization_id = p_org
   WHERE c.organization_id = p_org
     AND c.lead_id IS NOT NULL
     AND (p_agent_ids IS NULL OR c.assigned_agent_id = ANY (p_agent_ids))
   GROUP BY c.id;
$$;

REVOKE ALL ON FUNCTION private.report_policy_facts(uuid, uuid[])            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_policy_quality(uuid, uuid[])          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.report_policy_campaign_lineage(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------------------------
-- get_report_call_summary — applied body with ONLY the wins CTE replaced by normalized policy facts,
-- plus policy_source / policy_basis / policy_quality in the payload.
-- -----------------------------------------------------------------------------------------------
-- Reports metadata visibility mirrors public.campaigns_select (read-only catalog verified 2026-10-02).
-- This is an intersection with report_access, not a new grant. Missing/malformed Team membership fails closed.
CREATE FUNCTION private.report_visible_campaigns(p_org uuid)
RETURNS TABLE (campaign_id uuid)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor RECORD;
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();
  IF v_actor.org_id IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'reports: campaign organization is outside your scope' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id
      FROM public.campaigns c
     WHERE c.organization_id = p_org
       AND (
         v_actor.is_super
         OR v_actor.actor_role IN ('Admin', 'Super Admin', 'Team Leader', 'Team Lead')
         OR upper(btrim(c.type)) IN ('OPEN POOL', 'OPEN')
         OR (upper(btrim(c.type)) = 'PERSONAL' AND c.user_id = v_actor.uid)
         OR (upper(btrim(c.type)) = 'TEAM' AND EXISTS (
           SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
             CASE WHEN pg_catalog.jsonb_typeof(c.assigned_agent_ids) = 'array'
                  THEN c.assigned_agent_ids ELSE '[]'::jsonb END
           ) AS member(agent_id) WHERE member.agent_id = v_actor.uid::text
         ))
       );
END;
$$;
REVOKE ALL ON FUNCTION private.report_visible_campaigns(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_report_call_summary(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
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
  -- Policies Sold = normalized STORED policies (evidence-based primary + valid additional_policies
  -- objects) whose business sale date falls on an agency calendar date of the window. Never wins.
  pol AS (
    SELECT pf.agent_id
      FROM private.report_policy_facts(v_access.org_id, v_access.agent_ids) pf
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
  ),
  pq AS (
    SELECT * FROM private.report_policy_quality(v_access.org_id, v_access.agent_ids)
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
  pol_agg  AS (SELECT pol.agent_id, count(*) AS policies_sold    FROM pol GROUP BY pol.agent_id),
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
    SELECT agent_id FROM pol_agg  WHERE agent_id IS NOT NULL
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
      LEFT JOIN pol_agg  wa ON wa.agent_id = r.agent_id
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
      (SELECT count(*) FROM pol)                                                             AS policies_sold,
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
        'policies_sold',     coalesce((SELECT wa.policies_sold     FROM pol_agg  wa WHERE wa.agent_id IS NULL), 0),
        'appointments_set',  coalesce((SELECT aa.appointments_set  FROM appt_agg aa WHERE aa.agent_id IS NULL), 0)
      ),
      'policy_source', 'normalized_policies',
      'policy_basis', jsonb_build_object(
        'sale_date',         'policy_sold_date',
        'agent_attribution', 'current_assignment'
      ),
      'policy_quality', (
        SELECT jsonb_build_object(
                 'basis',                         'scope_wide_all_time',
                 'undated_policies',              pq.undated_policies,
                 'malformed_additional_policies', pq.malformed_additional_policies
               )
          FROM pq
      )
    )
    INTO v_result
    FROM totals t;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_call_volume — by_date[].policies_sold from policy sale DATES (no zone conversion).
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_call_volume(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
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
  -- A policy's sale date is already an agency CALENDAR date (a DATE, never a timestamp): it is bucketed
  -- on that date as-is, with no time-zone conversion and never by created_at.
  pol AS (
    SELECT pf.sold_date AS local_date
      FROM private.report_policy_facts(v_access.org_id, v_access.agent_ids) pf
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
  ),
  pq AS (
    SELECT * FROM private.report_policy_quality(v_access.org_id, v_access.agent_ids)
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
  day_pols AS (SELECT pol.local_date, count(*) AS policies_sold FROM pol GROUP BY 1),
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
          LEFT JOIN day_pols  dw ON dw.local_date = dy.local_date
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
      ),
      'policy_source', 'normalized_policies',
      'policy_quality', (
        SELECT jsonb_build_object(
                 'basis',                         'scope_wide_all_time',
                 'undated_policies',              pq.undated_policies,
                 'malformed_additional_policies', pq.malformed_additional_policies
               )
          FROM pq
      )
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------------------------
-- get_report_campaign_performance — Only campaigns with an in-scope outbound call or a
-- campaign-attributed policy in the window. The COUNT(wins) policies_sold field is REMOVED; campaign
-- rows carry attributed_policies (conversion-lineage attribution only).
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_campaign_performance(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
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

  WITH visible_campaigns AS MATERIALIZED (
    SELECT campaign_id FROM private.report_visible_campaigns(v_access.org_id)
  ),
  f AS (
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
       AND EXISTS (SELECT 1 FROM visible_campaigns vc WHERE vc.campaign_id = f.campaign_id)
     GROUP BY f.campaign_id
  ),
  -- In-scope normalized policies sold in the window, each carrying AT MOST ONE campaign: the client's
  -- conversion lineage (one row per client, so a join can never multiply a policy). NULL = no provable
  -- campaign; such a policy is counted in policies_attribution_unavailable and never inferred.
  pol AS (
    SELECT pf.client_id, vc.campaign_id
      FROM private.report_policy_facts(v_access.org_id, v_access.agent_ids) pf
      LEFT JOIN private.report_policy_campaign_lineage(v_access.org_id, v_access.agent_ids) l
        ON l.client_id = pf.client_id
      LEFT JOIN visible_campaigns vc ON vc.campaign_id = l.campaign_id
     WHERE pf.sold_date >= v_win.start_date
       AND pf.sold_date <= v_win.end_date
  ),
  pol_agg AS (
    SELECT pol.campaign_id, count(*) AS attributed_policies
      FROM pol
     WHERE pol.campaign_id IS NOT NULL
     GROUP BY pol.campaign_id
  ),
  ids AS (
    SELECT campaign_id FROM call_agg UNION SELECT campaign_id FROM pol_agg
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
           coalesce(wa.attributed_policies, 0) AS attributed_policies
      FROM ids i
      JOIN public.campaigns cmp ON cmp.id = i.campaign_id AND cmp.organization_id = v_access.org_id
      LEFT JOIN call_agg ca ON ca.campaign_id = i.campaign_id
      LEFT JOIN pol_agg  wa ON wa.campaign_id = i.campaign_id
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
                   'attributed_policies', r.attributed_policies
                 )
                 ORDER BY r.calls_made DESC, lower(r.name), r.campaign_id
               )
          FROM rows_ r
      ), '[]'::jsonb),
      'unattributed_calls', (SELECT count(*) FROM f WHERE f.campaign_id IS NULL),
      'calls_attribution_unavailable', (SELECT count(*) FROM f WHERE NOT EXISTS (
        SELECT 1 FROM visible_campaigns vc WHERE vc.campaign_id = f.campaign_id)),
      'campaign_visibility', 'caller_authorized',
      'policy_source',             'normalized_policies',
      'policy_attribution',        'conversion_lineage_only',
      'policies_in_period',        (SELECT count(*) FROM pol),
      'policies_attribution_unavailable', (SELECT count(*) FROM pol WHERE pol.campaign_id IS NULL)
    )
    INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_disposition_breakdown(p_start_date date, p_end_date date, p_agent_id uuid DEFAULT NULL)
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

  WITH visible_campaigns AS MATERIALIZED (
    SELECT campaign_id FROM private.report_visible_campaigns(v_access.org_id)
  ),
  f AS (
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
      JOIN visible_campaigns vc ON vc.campaign_id = x.campaign_id
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
      'campaign_visibility', 'caller_authorized',
      'campaign_attribution_unavailable_calls', (SELECT count(*) FROM f WHERE NOT EXISTS (
        SELECT 1 FROM visible_campaigns vc WHERE vc.campaign_id = f.campaign_id)),
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

COMMENT ON FUNCTION private.report_policy_facts(uuid, uuid[]) IS
  'Reports: one row per normalized STORED policy (evidence-based primary on clients + object elements of custom_fields.additional_policies), mirroring get_profile_book_stats. agent_id = CURRENT clients.assigned_agent_id (not seller credit). sold_date = business sale date; NULL = undated (never created_at). Never reads wins.';
COMMENT ON FUNCTION private.report_policy_quality(uuid, uuid[]) IS
  'Reports: scope-wide, all-time data-quality counts — undated policies and malformed additional_policies (non-array container incl. JSON null, non-object elements). Not windowed.';
COMMENT ON FUNCTION private.report_policy_campaign_lineage(uuid, uuid[]) IS
  'Reports: at most one row per client; campaign_id only when the same-org conversion-keyed win (conversion:<lead_id>) and every same-org campaign-bearing win of the client agree on one same-org campaign. Conversion-lineage attribution only.';
COMMENT ON FUNCTION public.get_report_call_summary(date, date, uuid) IS
  'Reports summary. Policies Sold = normalized stored policies by sale date (policy_source normalized_policies), credited to the client''s current assigned agent; never wins.';
COMMENT ON FUNCTION public.get_report_call_volume(date, date, uuid) IS
  'Reports volume. by_date[].policies_sold = normalized stored policies on their sale date (a DATE, no zone conversion); never wins.';
COMMENT ON FUNCTION public.get_report_campaign_performance(date, date, uuid) IS
  'Reports campaign performance. attributed_policies = normalized policies attributed by conversion lineage only; policies_without_campaign counts the rest. No COUNT(wins) field.';

-- =====================================================================================================
-- POSTCONDITIONS — abort the whole migration unless the contract holds.
-- =====================================================================================================
DO $post$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_report_call_summary(date,date,uuid)',
    'public.get_report_call_volume(date,date,uuid)',
    'public.get_report_campaign_performance(date,date,uuid)'
  ] LOOP
    IF NOT (SELECT p.proowner = 'postgres'::regrole AND p.prosecdef AND p.provolatile = 's'
                   AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
              FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) THEN
      RAISE EXCEPTION 'reports policy postcondition: % metadata wrong', v_sig;
    END IF;
    IF (SELECT coalesce(p.proacl::text, '') FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig))
       IS DISTINCT FROM pg_catalog.current_setting('reports_policy.acl_' || pg_catalog.md5(v_sig), true) THEN
      RAISE EXCEPTION 'reports policy postcondition: % ACL changed', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports policy postcondition: anon can execute %', v_sig;
    END IF;
    IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) LIKE '%public.wins%'
       OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) NOT LIKE '%private.report_policy_facts%'
       OR (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig)) NOT LIKE '%''normalized_policies''%' THEN
      RAISE EXCEPTION 'reports policy postcondition: % is not the normalized-policy implementation', v_sig;
    END IF;
  END LOOP;


  v_sig := 'public.get_report_disposition_breakdown(date,date,uuid)';
  IF NOT (SELECT p.proowner = 'postgres'::regrole AND p.prosecdef AND p.provolatile = 's'
                  AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
             FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig))
     OR (SELECT coalesce(p.proacl::text, '') FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig))
        IS DISTINCT FROM pg_catalog.current_setting('reports_policy.acl_' || pg_catalog.md5(v_sig), true) THEN
    RAISE EXCEPTION 'reports policy postcondition: disposition metadata or ACL changed';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'private.report_visible_campaigns(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'private.report_visible_campaigns(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'private.report_visible_campaigns(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reports policy postcondition: campaign visibility helper is client-executable';
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'private.report_policy_facts(uuid,uuid[])',
    'private.report_policy_quality(uuid,uuid[])',
    'private.report_policy_campaign_lineage(uuid,uuid[])'
  ] LOOP
    IF pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'reports policy postcondition: % is executable by a client role', v_sig;
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
      RAISE EXCEPTION 'reports policy postcondition: legacy % is executable by a client role', v_sig;
    END IF;
  END LOOP;
END
$post$;
