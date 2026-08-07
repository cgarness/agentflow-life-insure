-- ============================================================================
-- Import-time campaign creation + campaign-attachment retry + truthful finalize
--
-- ROOT CAUSE (production, import_history d7811230-abf6-47b5-bf8b-6aacfac976ef):
-- the browser created the import campaign with a direct INSERT that never wrote
-- user_id. RLS campaigns_insert is WITH CHECK (organization_id = get_org_id()
-- AND user_id = auth.uid()), so a browser insert CANNOT create an agent-owned
-- campaign — the DEFAULT auth.uid() necessarily stamped the Admin importer.
-- add_leads_to_campaign then skipped all 106 leads (owned by a different agent)
-- and finalize_contact_import stamped 'completed_with_skips', which the UI read
-- as success.
--
-- This migration adds a narrowly-scoped SECURITY DEFINER creation RPC rather than
-- weakening campaigns_insert RLS (which is load-bearing for every other campaign
-- creation path), plus an idempotent retry, plus a finalize that derives status
-- from ACTUAL campaign_leads membership instead of metadata arithmetic.
--
-- ROLLBACK: executable script at
--   supabase/rollback/20260807_import_campaign_attachment_rollback.sql
-- It contains the VERBATIM pre-change definition of public.finalize_contact_import(uuid) captured
-- from production via pg_get_functiondef BEFORE this migration (md5-verified identical), plus the
-- DROPs for create_import_campaign / retry_import_campaign_attachment / can_dial_campaign and the
-- private helpers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. May the actor own / participate in a campaign this actor is creating?
--    D-1: role from public.profiles (active, authoritative org).
--    D-2: Team Leader authority via public.is_ancestor_of ONLY — fails closed
--         while profiles.hierarchy_path is unrepaired. No upline_id fallback.
--    The frontend's assignable-agent list is NEVER trusted as authorization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.assert_may_assign_to(p_actor_uid uuid, p_actor_role text,
                                                        p_actor_is_super boolean, p_org uuid,
                                                        p_target uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_t RECORD;
BEGIN
  IF p_target IS NULL THEN
    RAISE EXCEPTION 'target user is required' USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.organization_id, p.status INTO v_t
    FROM public.profiles p WHERE p.id = p_target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target user % not found', p_target USING ERRCODE = '42501';
  END IF;
  IF v_t.organization_id IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'target user % is outside your organization', p_target USING ERRCODE = '42501';
  END IF;
  IF v_t.status IS DISTINCT FROM 'Active' THEN
    RAISE EXCEPTION 'target user % is not active', p_target USING ERRCODE = '42501';
  END IF;

  -- Self is always permitted.
  IF p_target = p_actor_uid THEN RETURN; END IF;

  IF p_actor_role = 'Admin' OR p_actor_is_super THEN RETURN; END IF;

  IF p_actor_role IN ('Team Leader', 'Team Lead')
     AND public.is_ancestor_of(p_actor_uid, p_target) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'not authorized to create a campaign for user %', p_target USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.assert_may_assign_to(uuid, text, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_import_campaign — the ONLY path that may create an agent-owned campaign.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_import_campaign(
  p_name                text,
  p_type                text,
  p_description         text    DEFAULT ''::text,
  p_owner_id            uuid    DEFAULT NULL::uuid,
  p_participant_ids     uuid[]  DEFAULT NULL::uuid[],
  p_assignment_strategy text    DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor        RECORD;
  v_type         text;
  v_strategy     text;
  v_owner        uuid;
  v_participants uuid[];
  v_pid          uuid;
  v_name         text;
  v_campaign     public.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();

  v_name := btrim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'campaign name is required' USING ERRCODE = '22023';
  END IF;

  -- Canonical type strings, matching campaigns_type_check.
  v_type := CASE upper(btrim(COALESCE(p_type, '')))
              WHEN 'PERSONAL'  THEN 'Personal'
              WHEN 'TEAM'      THEN 'Team'
              WHEN 'OPEN POOL' THEN 'Open Pool'
              WHEN 'OPEN'      THEN 'Open Pool'
              ELSE NULL
            END;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'invalid campaign type %', p_type USING ERRCODE = '22023';
  END IF;

  v_strategy := lower(btrim(COALESCE(p_assignment_strategy, 'myself')));
  IF v_strategy NOT IN ('myself', 'specific_agent', 'round_robin', 'unassigned') THEN
    RAISE EXCEPTION 'invalid assignment strategy %', p_assignment_strategy USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[])
    INTO v_participants
    FROM unnest(COALESCE(p_participant_ids, ARRAY[]::uuid[])) AS x
   WHERE x IS NOT NULL;

  -- ---- Type/strategy compatibility, enforced server-side so a stale or
  -- ---- manipulated client cannot bypass the UI rules. -----------------------
  IF v_type = 'Personal' AND v_strategy = 'round_robin' THEN
    RAISE EXCEPTION 'round robin imports cannot use a Personal campaign'
      USING ERRCODE = '22023';
  END IF;
  IF v_type = 'Personal' AND v_strategy = 'unassigned' THEN
    RAISE EXCEPTION 'unassigned imports cannot use a Personal campaign'
      USING ERRCODE = '22023';
  END IF;

  -- ---- Ownership + participants ------------------------------------------
  IF v_type = 'Personal' THEN
    v_owner := COALESCE(p_owner_id, v_actor.uid);
    IF v_strategy = 'specific_agent' AND p_owner_id IS NULL THEN
      RAISE EXCEPTION 'a Personal campaign for a specific agent requires an owner'
        USING ERRCODE = '22023';
    END IF;
    PERFORM private.assert_may_assign_to(v_actor.uid, v_actor.actor_role, v_actor.is_super,
                                         v_actor.org_id, v_owner);
    v_participants := ARRAY[v_owner];

  ELSIF v_type = 'Team' THEN
    -- Existing owner semantics preserved: a Team campaign is owned by its creator.
    v_owner := v_actor.uid;
    IF v_strategy = 'unassigned' OR COALESCE(array_length(v_participants, 1), 0) = 0 THEN
      -- D-3: never leave assigned_agent_ids empty — a Team campaign with no
      -- participants is invisible to every Agent under campaigns_select.
      v_participants := ARRAY[v_actor.uid];
    END IF;
    FOREACH v_pid IN ARRAY v_participants LOOP
      PERFORM private.assert_may_assign_to(v_actor.uid, v_actor.actor_role, v_actor.is_super,
                                           v_actor.org_id, v_pid);
    END LOOP;

  ELSE -- Open Pool: organization-wide by type; no participants.
    v_owner := v_actor.uid;
    v_participants := ARRAY[]::uuid[];
  END IF;

  INSERT INTO public.campaigns (
    name, type, description, status,
    organization_id, created_by, user_id, assigned_agent_ids
  )
  VALUES (
    v_name,
    v_type,
    COALESCE(p_description, ''),
    'Active',
    v_actor.org_id,               -- database-authoritative, never from the request
    v_actor.uid,                  -- audit: who ran the import
    v_owner,                      -- operational owner (the selected agent for Personal)
    COALESCE(to_jsonb(v_participants), '[]'::jsonb)
  )
  RETURNING * INTO v_campaign;

  RETURN jsonb_build_object(
    'id',                 v_campaign.id,
    'type',               v_campaign.type,
    'user_id',            v_campaign.user_id,
    'created_by',         v_campaign.created_by,
    'assigned_agent_ids', v_campaign.assigned_agent_ids,
    'organization_id',    v_campaign.organization_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_import_campaign(text, text, text, uuid, uuid[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_import_campaign(text, text, text, uuid, uuid[], text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Shared truthful status derivation — from ACTUAL rows, never from client input
--    and never from metadata arithmetic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.import_attachment_status(
  p_import_id   uuid,
  p_campaign_id uuid,
  p_lead_ids    uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_total     int := COALESCE(array_length(p_lead_ids, 1), 0);
  v_attached  int := 0;
  v_remaining int := 0;
  v_eligible_remaining int := 0;
  v_campaign  public.campaigns%ROWTYPE;
  v_type      text;
  v_status    text;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN jsonb_build_object('status', 'completed', 'imported_count', v_total,
                              'attached_count', 0, 'remaining_count', 0, 'ineligible_count', 0);
  END IF;

  SELECT count(*) INTO v_attached
    FROM public.campaign_leads cl
   WHERE cl.campaign_id = p_campaign_id
     AND cl.lead_id = ANY (p_lead_ids);

  v_remaining := v_total - v_attached;

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    -- Campaign deleted after the import (import_history.campaign_id is ON DELETE SET NULL).
    RETURN jsonb_build_object('status', 'campaign_failed', 'imported_count', v_total,
                              'attached_count', v_attached, 'remaining_count', v_remaining,
                              'ineligible_count', 0);
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));

  -- How many of the not-yet-attached leads could still legitimately attach?
  SELECT count(*) INTO v_eligible_remaining
    FROM public.leads l
   WHERE l.id = ANY (p_lead_ids)
     AND l.organization_id = v_campaign.organization_id
     AND NOT EXISTS (SELECT 1 FROM public.campaign_leads cl
                      WHERE cl.campaign_id = p_campaign_id AND cl.lead_id = l.id)
     AND (
       CASE
         WHEN v_type = 'PERSONAL' THEN l.assigned_agent_id IS NOT DISTINCT FROM v_campaign.user_id
         WHEN v_type = 'TEAM' THEN
           l.assigned_agent_id IS NULL
           OR l.assigned_agent_id::text IN (
                SELECT jsonb_array_elements_text(COALESCE(v_campaign.assigned_agent_ids, '[]'::jsonb)))
         WHEN v_type IN ('OPEN POOL', 'OPEN') THEN true
         ELSE false
       END
     );

  v_status := CASE
    WHEN v_total = 0                    THEN 'completed'
    WHEN v_attached >= v_total          THEN 'completed'
    WHEN v_eligible_remaining > 0 AND v_attached = 0 THEN 'campaign_failed'
    WHEN v_eligible_remaining > 0       THEN 'campaign_partial'
    WHEN v_attached = 0                 THEN 'campaign_failed'
    ELSE 'completed_with_skips'
  END;

  RETURN jsonb_build_object(
    'status',           v_status,
    'imported_count',   v_total,
    'attached_count',   v_attached,
    'remaining_count',  v_remaining,
    'ineligible_count', v_remaining - v_eligible_remaining,
    'eligible_remaining', v_eligible_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION private.import_attachment_status(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. finalize_contact_import — status now derived from actual membership.
--    Previously: 106 attempted / 0 added / 106 skipped satisfied
--      (tagged = added) AND (added + skipped = attempted)
--    and produced 'completed_with_skips' — a total failure that read as a benign
--    partial. A 0/N attachment must be 'campaign_failed'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_contact_import(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c        RECORD;
  v_calc   jsonb;
  v_status text;
  v_tagged int := 0;
BEGIN
  SELECT * INTO c FROM public._import_undo_context(p_import_id);
  IF c.reason IS NOT NULL THEN
    RETURN jsonb_build_object('finalized', false, 'reason', c.reason);
  END IF;

  IF c.undo_status = 'undone'
     OR (c.completion_status IS NOT NULL AND c.completion_status <> 'pending_campaign') THEN
    RETURN jsonb_build_object('finalized', true, 'status', c.completion_status, 'idempotent', true);
  END IF;

  v_calc   := private.import_attachment_status(p_import_id, c.campaign_id, c.validated_ids);
  v_status := v_calc->>'status';

  SELECT count(*) INTO v_tagged
    FROM public.campaign_leads WHERE import_history_id = p_import_id;

  UPDATE public.import_history
     SET import_completion_status   = v_status,
         import_completion_metadata = COALESCE(import_completion_metadata, '{}'::jsonb)
           || jsonb_build_object(
                'finalized_at',     to_jsonb(now()),
                'tagged',           v_tagged,
                'attached_count',   (v_calc->>'attached_count')::int,
                'remaining_count',  (v_calc->>'remaining_count')::int,
                'ineligible_count', (v_calc->>'ineligible_count')::int
              )
   WHERE id = p_import_id
     AND (import_completion_status IS NULL OR import_completion_status = 'pending_campaign');

  RETURN jsonb_build_object(
    'finalized',        true,
    'status',           v_status,
    'idempotent',       false,
    'imported_count',   (v_calc->>'imported_count')::int,
    'attached_count',   (v_calc->>'attached_count')::int,
    'remaining_count',  (v_calc->>'remaining_count')::int,
    'ineligible_count', (v_calc->>'ineligible_count')::int,
    'tagged_count',     v_tagged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_contact_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_contact_import(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. retry_import_campaign_attachment
--    The client supplies ONLY the import id. The retry set is derived server-side
--    from import_history.imported_lead_ids minus actual membership, so forged or
--    unrelated lead ids are structurally unreachable. Never re-runs the lead import.
--    D-4: deliberately NOT gated on the 24h `expired` flag — that window bounds UNDO
--    (which deletes leads). Retry is additive and idempotent.
--    Also deliberately NOT gated on the stored completion status: the pre-fix finalize
--    arithmetic mis-stamped total failures as 'completed_with_skips', and the brief
--    requires recomputing from actual rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_import_campaign_attachment(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  c          RECORD;
  v_imp      public.import_history%ROWTYPE;
  v_campaign public.campaigns%ROWTYPE;
  v_type     text;
  v_retry    uuid[];
  v_attach   jsonb;
  v_calc     jsonb;
  v_status   text;
  v_tagged   int := 0;
BEGIN
  SELECT * INTO v_actor FROM private.campaign_actor();

  SELECT * INTO c FROM public._import_undo_context(p_import_id);
  IF c.reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', c.reason);
  END IF;
  IF NOT c.authorized THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;
  IF c.already_undone THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_undone');
  END IF;
  IF c.campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_campaign');
  END IF;

  -- Short lock on the audit row for the duration of the mutation. No external calls
  -- are made while it is held.
  SELECT * INTO v_imp FROM public.import_history WHERE id = p_import_id FOR UPDATE;

  IF v_imp.campaign_id IS DISTINCT FROM c.campaign_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_mismatch');
  END IF;

  SELECT * INTO v_campaign
    FROM public.campaigns
   WHERE id = v_imp.campaign_id
     AND organization_id = v_actor.org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_not_found');
  END IF;
  IF v_campaign.organization_id IS DISTINCT FROM c.org_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cross_org');
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));
  IF v_type NOT IN ('PERSONAL', 'TEAM', 'OPEN POOL', 'OPEN') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'incompatible_campaign_type');
  END IF;

  IF NOT private.can_administer_campaign(v_campaign.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  -- Retry set = provenance MINUS actual current membership. Deterministic order.
  SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[])
    INTO v_retry
    FROM unnest(c.validated_ids) AS x
   WHERE NOT EXISTS (
     SELECT 1 FROM public.campaign_leads cl
      WHERE cl.campaign_id = v_campaign.id AND cl.lead_id = x
   );

  IF COALESCE(array_length(v_retry, 1), 0) > 0 THEN
    v_attach := private.attach_leads_to_campaign_core(v_campaign.id, v_retry, p_import_id);
  ELSE
    v_attach := jsonb_build_object('added', 0, 'skipped', 0);
  END IF;

  -- Recompute completion from ACTUAL rows.
  v_calc   := private.import_attachment_status(p_import_id, v_campaign.id, c.validated_ids);
  v_status := v_calc->>'status';

  SELECT count(*) INTO v_tagged
    FROM public.campaign_leads WHERE import_history_id = p_import_id;

  UPDATE public.import_history
     SET import_completion_status   = v_status,
         import_completion_metadata = COALESCE(import_completion_metadata, '{}'::jsonb)
           || jsonb_build_object(
                'last_retry_at',    to_jsonb(now()),
                'last_retry_by',    to_jsonb(v_actor.uid),
                'retries',          COALESCE((import_completion_metadata->>'retries')::int, 0) + 1,
                'tagged',           v_tagged,
                'attached_count',   (v_calc->>'attached_count')::int,
                'remaining_count',  (v_calc->>'remaining_count')::int,
                'ineligible_count', (v_calc->>'ineligible_count')::int
              )
   WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'ok',               true,
    'status',           v_status,
    'imported_count',   (v_calc->>'imported_count')::int,
    'attached_count',   (v_calc->>'attached_count')::int,
    'newly_attached',   COALESCE((v_attach->>'added')::int, 0),
    'already_present',  COALESCE((v_attach->>'skipped_already_present')::int, 0),
    'ineligible_count', (v_calc->>'ineligible_count')::int,
    'remaining_count',  (v_calc->>'remaining_count')::int
  );
END;
$$;

REVOKE ALL ON FUNCTION public.retry_import_campaign_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_import_campaign_attachment(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. can_dial_campaign — SERVER-AUTHORITATIVE Dialer authorization.
--
--    Personal is OWNER-ONLY. An Admin's "view all campaigns" / management permission
--    must NOT grant Personal dialing access, so no role branch appears here at all.
--
--    LIMITATION (documented, deliberate): this is the authorization DECISION. Dialer
--    SESSIONS are independently enforced in start_dialer_session. The Campaign Detail
--    quick-call path does not pass through start_dialer_session, so for that path this
--    is a server-authoritative answer consumed by a cooperating client — NOT a
--    database-level block. Closing that requires tightening campaign_leads_select,
--    which is a separate approved security task.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_dial_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  v_campaign public.campaigns%ROWTYPE;
  v_type     text;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    SELECT * INTO v_actor FROM private.campaign_actor();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;  -- unauthenticated / inactive / no-org / org mismatch → fail closed
  END;

  SELECT * INTO v_campaign
    FROM public.campaigns
   WHERE id = p_campaign_id
     AND organization_id = v_actor.org_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_type := upper(btrim(COALESCE(v_campaign.type, '')));

  IF v_type IN ('OPEN POOL', 'OPEN') THEN
    RETURN true;
  END IF;

  IF v_type = 'PERSONAL' THEN
    RETURN v_campaign.user_id = v_actor.uid;   -- owner only. No admin/viewAll escape.
  END IF;

  IF v_type = 'TEAM' THEN
    RETURN v_actor.uid::text IN (
      SELECT jsonb_array_elements_text(COALESCE(v_campaign.assigned_agent_ids, '[]'::jsonb))
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_dial_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_dial_campaign(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_dial_campaign(uuid) IS
  'Server-authoritative Dialer authorization for one campaign. Personal is owner-only; '
  'no admin/view-all branch exists. Dialer SESSIONS are independently enforced by '
  'start_dialer_session. Campaign Detail quick-call consumes this decision but is not '
  'blocked at the database layer — see AGENT_RULES.';
