-- Contacts Build 5 — CP3B: backend enforcement for the Contacts permissions framework.
--
-- DRAFT — validated on a temporary Supabase dev branch only. NOT applied to production
-- in CP3B (production-apply is CP3C, gated). Scope is limited to:
--   1. public._contacts_permission_default(text, text)   — hardcoded default map (matches CP2 catalog)
--   2. public.has_contacts_permission(text)              — STABLE DEFINER permission reader
--   3. public.delete_contact(text, uuid)                 — DEFINER delete RPC (permission + org + ownership)
--   4. additive SELECT policy leads_select_unassigned_pool  (contacts.leads.view_unassigned)  [#APPROVE_RLS_CHANGE]
--   5. additive SELECT policy leads_select_view_all_pool    (contacts.leads.view_all)          [#APPROVE_RLS_CHANGE]
--   6. additive 'unassigned' scope branch in public._contacts_filtered_leads (canonical helper; Kanban shape unchanged)
--
-- Hard security boundaries (NON-configurable): tenant isolation by organization_id, no cross-org,
-- no service-role exposure to the frontend, telemetry/lineage integrity. Conversion is NOT touched
-- and has NO permission key. No least-privilege hardening is bundled here (tracked separately).

-- ===========================================================================
-- 1. Hardcoded default map — MUST match src/config/permissionDefaults.ts CONTACTS_PERMISSIONS.
--    Owner-only (invoked only by has_contacts_permission, a DEFINER owned by postgres).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._contacts_permission_default(p_role text, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT CASE p_role WHEN 'Agent' THEN d.agent WHEN 'Team Leader' THEN d.team_leader ELSE false END
     FROM (VALUES
       ('contacts.leads.view_assigned',   true,  true),
       ('contacts.leads.view_unassigned', false, true),
       ('contacts.leads.view_all',        false, false),
       ('contacts.leads.create',          true,  true),
       ('contacts.leads.edit',            true,  true),
       ('contacts.leads.delete',          false, false),
       ('contacts.leads.import',          false, true),
       ('contacts.leads.undo_own_import', false, true),
       ('contacts.leads.undo_team_import',false, true),
       ('contacts.leads.assign',          false, true),
       ('contacts.leads.bulk_assign',     false, true),
       ('contacts.leads.bulk_status',     true,  true),
       ('contacts.leads.update_status',   true,  true),
       ('contacts.leads.add_to_campaign', false, true),
       ('contacts.clients.view',          true,  true),
       ('contacts.clients.edit',          true,  true),
       ('contacts.clients.delete',        false, false),
       ('contacts.recruits.view',         true,  true),
       ('contacts.recruits.create',       true,  true),
       ('contacts.recruits.edit',         true,  true),
       ('contacts.recruits.delete',       false, false),
       ('contacts.notes.manage',          true,  true),
       ('contacts.tasks.manage',          true,  true),
       ('contacts.appointments.manage',   true,  true),
       ('contacts.messages.manage',       true,  true)
     ) AS d(key, agent, team_leader)
     WHERE d.key = p_key),
    false  -- unknown key → deny
  );
$$;
-- Owner-only: invoked solely by has_contacts_permission (DEFINER, owned by postgres). Revoke the
-- Supabase default-privilege grants too (PUBLIC alone isn't enough — anon/authenticated/service_role
-- get direct EXECUTE via ALTER DEFAULT PRIVILEGES), so no client role can call it directly.
REVOKE ALL ON FUNCTION public._contacts_permission_default(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 2. Permission reader. No caller-supplied identity; uid from auth.uid(), org from get_org_id().
--    Admin + Super Admin (home-org, enforced by the org-scoped profiles match) = full access.
--    Configurable roles: stored override wins, else hardcoded default. Unknown key → false.
--    Reads only profiles + role_permissions (never leads) → safe inside a leads RLS policy.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.has_contacts_permission(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_role text;
  v_is_super boolean;
  v_val jsonb;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.role, COALESCE(p.is_super_admin, false)
    INTO v_role, v_is_super
  FROM public.profiles p
  WHERE p.id = v_uid AND p.organization_id = v_org;

  IF NOT FOUND OR v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'Admin' OR v_is_super THEN
    RETURN true;  -- locked full-access (D-roles)
  END IF;

  SELECT rp.permissions -> 'contacts' -> p_key
    INTO v_val
  FROM public.role_permissions rp
  WHERE rp.organization_id = v_org AND rp.role = v_role;

  IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'boolean' THEN
    RETURN v_val::boolean;
  END IF;

  RETURN public._contacts_permission_default(v_role, p_key);
END;
$$;
REVOKE ALL ON FUNCTION public.has_contacts_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_contacts_permission(text) TO authenticated, service_role;

-- ===========================================================================
-- 3. Delete RPC — permission capability + same-org + existing ownership/downline/admin scope.
--    Hard-delete PARITY with the prior direct delete (telemetry FKs are ON DELETE SET NULL:
--    calls/campaign_leads/messages keep their rows; nothing references clients/recruits by FK).
--    No new cascade. DEFINER so it must enforce tenant + ownership itself (RLS is bypassed).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.delete_contact(p_contact_type text, p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_role text;
  v_is_super boolean;
  v_type text := lower(btrim(coalesce(p_contact_type, '')));
  v_perm_key text;
  v_owner uuid;
  v_row_org uuid;
  v_deleted int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_org' USING ERRCODE = '28000'; END IF;
  IF v_type NOT IN ('lead','client','recruit') THEN
    RAISE EXCEPTION 'invalid_contact_type:%', p_contact_type USING ERRCODE = '22023';
  END IF;

  SELECT p.role, COALESCE(p.is_super_admin, false) INTO v_role, v_is_super
  FROM public.profiles p WHERE p.id = v_uid AND p.organization_id = v_org;
  IF NOT FOUND OR v_role IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;

  v_perm_key := 'contacts.' || CASE v_type WHEN 'lead' THEN 'leads' WHEN 'client' THEN 'clients' ELSE 'recruits' END || '.delete';
  IF NOT public.has_contacts_permission(v_perm_key) THEN
    RAISE EXCEPTION 'permission_denied:%', v_perm_key USING ERRCODE = '42501';
  END IF;

  IF v_type = 'lead' THEN
    SELECT organization_id, user_id          INTO v_row_org, v_owner FROM public.leads    WHERE id = p_contact_id FOR UPDATE;
  ELSIF v_type = 'client' THEN
    SELECT organization_id, assigned_agent_id INTO v_row_org, v_owner FROM public.clients  WHERE id = p_contact_id FOR UPDATE;
  ELSE
    SELECT organization_id, assigned_agent_id INTO v_row_org, v_owner FROM public.recruits WHERE id = p_contact_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_row_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;

  IF NOT (
       v_role = 'Admin'
    OR v_is_super
    OR v_owner = v_uid
    OR (v_role IN ('Team Leader','Team Lead') AND v_owner IS NOT NULL AND public.is_ancestor_of(v_uid, v_owner))
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_type = 'lead' THEN
    -- Parity with leadsSupabaseApi.delete: remove the lead's campaign_leads queue rows first
    -- (org-scoped). This matches today's behavior exactly. Telemetry (calls/messages) is preserved
    -- via the existing ON DELETE SET NULL FKs — never deleted here.
    DELETE FROM public.campaign_leads WHERE lead_id = p_contact_id AND organization_id = v_org;
    DELETE FROM public.leads    WHERE id = p_contact_id AND organization_id = v_org;
  ELSIF v_type = 'client' THEN
    DELETE FROM public.clients  WHERE id = p_contact_id AND organization_id = v_org;
  ELSE
    DELETE FROM public.recruits WHERE id = p_contact_id AND organization_id = v_org;
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted > 0, 'contact_type', v_type, 'id', p_contact_id);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_contact(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_contact(text, uuid) TO authenticated, service_role;

-- ===========================================================================
-- 4 & 5. Additive, read-only SELECT policies (#APPROVE_RLS_CHANGE — additive Contacts SELECT only).
--    PERMISSIVE → OR with the existing "Leads Hierarchical Access" FOR ALL policy. SELECT-only:
--    they NEVER broaden UPDATE/DELETE. Never cross-org. The hierarchical policy is untouched.
-- ===========================================================================
DROP POLICY IF EXISTS leads_select_unassigned_pool ON public.leads;
CREATE POLICY leads_select_unassigned_pool ON public.leads
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND user_id IS NULL
    AND assigned_agent_id IS NULL
    AND public.has_contacts_permission('contacts.leads.view_unassigned')
  );

DROP POLICY IF EXISTS leads_select_view_all_pool ON public.leads;
CREATE POLICY leads_select_view_all_pool ON public.leads
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND public.has_contacts_permission('contacts.leads.view_all')
  );

-- ===========================================================================
-- 6. Canonical helper: add an ADDITIVE 'unassigned' scope branch so the Contacts list/Kanban
--    can surface the org pool explicitly. Reproduced verbatim from production with ONE added
--    branch in the scope WHERE block; every other clause (filters, sort, window) is unchanged,
--    so search_contacts_leads / get_contacts_lead_kanban keep their exact return contract.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._contacts_filtered_leads(p_filters jsonb)
 RETURNS TABLE(id uuid, ord bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH base AS (
    SELECT
      l.id,
      l.created_at,
      l.first_name, l.last_name, l.status, l.lead_source, l.state, l.phone, l.email,
      l.date_of_birth, l.best_time_to_call, l.last_contacted_at,
      CASE WHEN pa.id IS NULL THEN NULL
           ELSE lower(btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, ''))) END AS agent_sort,
      (
        SELECT count(DISTINCT c.id)
        FROM public.calls c
        WHERE c.direction = 'outbound'
          AND (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
          )
      ) AS attempt_count,
      (
        SELECT NULLIF(btrim(c.disposition_name), '')
        FROM public.calls c
        WHERE (
            c.lead_id = l.id
            OR (c.lead_id IS NULL AND c.contact_id = l.id AND (c.contact_type = 'lead' OR c.contact_type IS NULL))
          )
          AND (c.disposition_id IS NOT NULL OR btrim(coalesce(c.disposition_name, '')) <> '')
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC
        LIMIT 1
      ) AS last_disposition
    FROM public.leads l
    LEFT JOIN public.profiles pa ON pa.id = l.assigned_agent_id
    WHERE
      (
        (coalesce(p_filters->>'scope', 'mine') = 'mine'
          AND l.user_id = auth.uid())
        OR (p_filters->>'scope' = 'team'
          AND (l.user_id = auth.uid() OR public.is_ancestor_of(auth.uid(), l.user_id)))
        OR (p_filters->>'scope' = 'agency'
          AND l.organization_id = public.get_org_id())
        -- Contacts Build 5: explicit org-pool scope (RLS still gates visibility via
        -- leads_select_unassigned_pool, which requires contacts.leads.view_unassigned).
        OR (p_filters->>'scope' = 'unassigned'
          AND l.organization_id = public.get_org_id()
          AND l.user_id IS NULL AND l.assigned_agent_id IS NULL)
      )
      AND (
        p_filters->'agent_ids' IS NULL
        OR jsonb_typeof(p_filters->'agent_ids') <> 'array'
        OR l.user_id = ANY (ARRAY(SELECT (jsonb_array_elements_text(p_filters->'agent_ids'))::uuid))
      )
      AND (p_filters->>'status' IS NULL OR l.status = p_filters->>'status')
      AND (p_filters->>'source' IS NULL OR l.lead_source = p_filters->>'source')
      AND (p_filters->>'state'  IS NULL OR l.state = p_filters->>'state')
      AND (p_filters->>'created_start' IS NULL OR l.created_at >= (p_filters->>'created_start')::timestamptz)
      AND (p_filters->>'created_end'   IS NULL OR l.created_at <= (p_filters->>'created_end')::timestamptz)
      AND (
        p_filters->'timezone_states' IS NULL
        OR jsonb_typeof(p_filters->'timezone_states') <> 'array'
        OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'timezone_states')))
      )
      AND (
        p_filters->'callable_states' IS NULL
        OR jsonb_typeof(p_filters->'callable_states') <> 'array'
        OR l.state = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'callable_states')))
      )
      AND (
        p_filters->>'search' IS NULL
        OR l.first_name ILIKE '%' || (p_filters->>'search') || '%'
        OR l.last_name  ILIKE '%' || (p_filters->>'search') || '%'
        OR l.phone      ILIKE '%' || (p_filters->>'search') || '%'
        OR l.email      ILIKE '%' || (p_filters->>'search') || '%'
      )
  ),
  filtered AS (
    SELECT * FROM base b
    WHERE
      (
        p_filters->'attempt_buckets' IS NULL
        OR jsonb_typeof(p_filters->'attempt_buckets') <> 'array'
        OR (
          ('0'   = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count = 0)
          OR ('1-3' = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count BETWEEN 1 AND 3)
          OR ('4+'  = ANY (ARRAY(SELECT jsonb_array_elements_text(p_filters->'attempt_buckets'))) AND b.attempt_count >= 4)
        )
      )
      AND (
        p_filters->>'last_disposition' IS NULL
        OR (p_filters->>'last_disposition' = '__none__' AND b.last_disposition IS NULL)
        OR (
          p_filters->>'last_disposition' <> '__none__'
          AND lower(btrim(coalesce(b.last_disposition, ''))) = lower(btrim(p_filters->>'last_disposition'))
        )
      )
  ),
  keyed AS (
    SELECT
      f.id, f.created_at,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) IN ('asc', 'desc')) AS dir_ok,
      (lower(coalesce(p_filters->>'sort_direction', 'desc')) = 'asc')            AS asc_dir,
      CASE lower(coalesce(p_filters->>'sort_column', ''))
        WHEN 'name'             THEN lower(btrim(coalesce(f.last_name, ''))) || ' ' || lower(btrim(coalesce(f.first_name, '')))
        WHEN 'status'           THEN f.status
        WHEN 'lead_source'      THEN lower(btrim(coalesce(f.lead_source, '')))
        WHEN 'state'            THEN f.state
        WHEN 'phone'            THEN f.phone
        WHEN 'email'            THEN lower(btrim(coalesce(f.email, '')))
        WHEN 'dob'              THEN f.date_of_birth::text
        WHEN 'best_time'        THEN f.best_time_to_call
        WHEN 'last_contacted'   THEN f.last_contacted_at::text
        WHEN 'assigned_agent'   THEN f.agent_sort
        WHEN 'last_disposition' THEN lower(btrim(f.last_disposition))
        ELSE NULL
      END AS text_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'attempt_count' THEN f.attempt_count ELSE NULL END AS num_key,
      CASE WHEN lower(coalesce(p_filters->>'sort_column', '')) = 'created_at'     THEN f.created_at     ELSE NULL END AS ts_key
    FROM filtered f
  )
  SELECT
    k.id,
    row_number() OVER (
      ORDER BY
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.text_key END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.text_key END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.num_key  END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.num_key  END DESC NULLS LAST,
        CASE WHEN k.dir_ok AND k.asc_dir      THEN k.ts_key   END ASC  NULLS LAST,
        CASE WHEN k.dir_ok AND NOT k.asc_dir  THEN k.ts_key   END DESC NULLS LAST,
        k.created_at DESC, k.id DESC
    ) AS ord
  FROM keyed k;
$function$;

-- Reload PostgREST schema cache so the new RPCs are exposed.
NOTIFY pgrst, 'reload schema';
