-- =====================================================================================================
-- ROLLBACK — Import campaign ownership / attachment / retry / dial-scope (2026-08-07)
-- =====================================================================================================
-- Reverses, in reverse dependency order:
--   20260807165620_dialer_session_campaign_access.sql
--   20260807165610_import_campaign_creation_and_retry.sql
--   20260807165600_campaign_leads_membership_uniqueness_and_attachment_core.sql
--
-- Every replaced function body below was captured VERBATIM from production via
-- `pg_get_functiondef(oid)` on 2026-08-07, BEFORE any migration was applied. This file is the
-- reviewable artifact those definitions live in — rollback is executable, not descriptive.
--
-- Pre-change production facts captured at the same time (for grant restoration):
--   public.add_leads_to_campaign(uuid,uuid[],uuid)  owner postgres  SECURITY DEFINER
--       search_path = pg_catalog, pg_temp
--       acl = postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres   (no PUBLIC)
--   public.finalize_contact_import(uuid)            owner postgres  SECURITY DEFINER
--       search_path = pg_catalog, pg_temp
--       acl = postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres   (no PUBLIC)
--   public.start_dialer_session(uuid)               owner postgres  SECURITY DEFINER
--       search_path = public, private, pg_temp
--       acl = =X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
--             service_role=X/postgres                                  (PUBLIC *and* anon HAD execute)
--
-- DATA SAFETY: no migration in this change set performs an UPDATE or DELETE against
-- public.campaign_leads, so rollback destroys no data. The only data-affecting object is a
-- unique INDEX, dropped below.
--
-- USAGE (transactional; run the whole file):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20260807_import_campaign_attachment_rollback.sql
--
-- MIGRATION HISTORY IS **NOT** TOUCHED BY THIS SCRIPT.
-- This file restores application schema and function state ONLY. It contains no INSERT,
-- UPDATE or DELETE against supabase_migrations.schema_migrations. History reconciliation is a
-- SEPARATE, OPERATOR-APPROVED step — see the footer of this file.
-- =====================================================================================================

BEGIN;

-- -----------------------------------------------------------------------------------------------------
-- 1. Drop the functions introduced by this change set (safe if already absent).
-- -----------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.retry_import_campaign_attachment(uuid);
DROP FUNCTION IF EXISTS public.create_import_campaign(text, text, text, uuid, uuid[], text);
DROP FUNCTION IF EXISTS public.can_dial_campaign(uuid);
DROP FUNCTION IF EXISTS private.import_attachment_status(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS private.assert_may_assign_to(uuid, text, boolean, uuid, uuid);
DROP FUNCTION IF EXISTS private.attach_leads_to_campaign_core(uuid, uuid[], uuid);
DROP FUNCTION IF EXISTS private.assert_import_set_campaign_compatible(uuid, uuid[]);
DROP FUNCTION IF EXISTS private.can_administer_campaign(uuid);
DROP FUNCTION IF EXISTS private.campaign_actor();

-- -----------------------------------------------------------------------------------------------------
-- 2. Restore public.start_dialer_session(uuid) — VERBATIM pre-change definition.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_dialer_session(p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_agent uuid;
  v_session public.dialer_sessions%ROWTYPE;
BEGIN
  v_org := public.get_org_id();
  v_agent := auth.uid();

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'organization context required';
  END IF;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  PERFORM private.close_stale_dialer_sessions(v_org, v_agent, 3);

  SELECT *
  INTO v_session
  FROM public.dialer_sessions
  WHERE organization_id = v_org
    AND agent_id = v_agent
    AND status = 'active'
  ORDER BY started_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_session.id,
      'organization_id', v_session.organization_id,
      'agent_id', v_session.agent_id,
      'campaign_id', v_session.campaign_id,
      'started_at', v_session.started_at,
      'last_heartbeat_at', v_session.last_heartbeat_at,
      'ended_at', v_session.ended_at,
      'status', v_session.status
    );
  END IF;

  INSERT INTO public.dialer_sessions (
    organization_id,
    agent_id,
    campaign_id,
    started_at,
    last_heartbeat_at,
    status
  )
  VALUES (
    v_org,
    v_agent,
    p_campaign_id,
    now(),
    now(),
    'active'
  )
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'id', v_session.id,
    'organization_id', v_session.organization_id,
    'agent_id', v_session.agent_id,
    'campaign_id', v_session.campaign_id,
    'started_at', v_session.started_at,
    'last_heartbeat_at', v_session.last_heartbeat_at,
    'ended_at', v_session.ended_at,
    'status', v_session.status
  );
END;
$function$;

-- DELIBERATE SECURITY EXCEPTION TO BYTE-IDENTICAL RESTORATION.
--
-- The pre-change ACL was:
--     =X/postgres            <-- PUBLIC had EXECUTE
--     anon=X/postgres
--     authenticated=X/postgres
--     service_role=X/postgres
--
-- Rollback restores the previous function BODY but intentionally does NOT restore PUBLIC or
-- anon EXECUTE. Re-opening a privileged SECURITY DEFINER function to unauthenticated roles
-- during an incident response would be a security regression, and nothing depends on those
-- grants: the restored body still raises 'authentication required' when auth.uid() IS NULL,
-- so no working caller loses access. The permission hardening from M3 is preserved.
REVOKE ALL ON FUNCTION public.start_dialer_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_dialer_session(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 3. Restore public.finalize_contact_import(uuid) — VERBATIM pre-change definition.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_contact_import(p_import_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c          RECORD;
  v_meta     jsonb;
  v_tagged   int := 0;
  v_attempted int := 0;
  v_added    int := 0;
  v_skipped  int := 0;
  v_status   text;
BEGIN
  SELECT * INTO c FROM public._import_undo_context(p_import_id);
  IF c.reason IS NOT NULL THEN
    RETURN jsonb_build_object('finalized', false, 'reason', c.reason);
  END IF;

  IF c.undo_status = 'undone'
     OR (c.completion_status IS NOT NULL AND c.completion_status <> 'pending_campaign') THEN
    RETURN jsonb_build_object('finalized', true, 'status', c.completion_status, 'idempotent', true);
  END IF;

  IF c.campaign_id IS NULL THEN
    v_status := 'completed';
  ELSE
    SELECT import_completion_metadata INTO v_meta FROM public.import_history WHERE id = p_import_id;
    SELECT count(*) INTO v_tagged FROM public.campaign_leads WHERE import_history_id = p_import_id;
    v_attempted := COALESCE((v_meta->>'attempted')::int, 0);
    v_added     := COALESCE((v_meta->>'added')::int, 0);
    v_skipped   := COALESCE((v_meta->>'skipped')::int, 0);

    IF v_meta IS NULL OR v_attempted = 0 THEN
      v_status := 'campaign_failed';
    ELSIF v_attempted < c.imported_count THEN
      v_status := 'campaign_partial';
    ELSIF v_tagged = v_added AND (v_added + v_skipped) = v_attempted THEN
      v_status := CASE WHEN v_skipped = 0 THEN 'completed' ELSE 'completed_with_skips' END;
    ELSE
      v_status := 'campaign_partial';
    END IF;
  END IF;

  UPDATE public.import_history
     SET import_completion_status   = v_status,
         import_completion_metadata = COALESCE(import_completion_metadata, '{}'::jsonb)
           || jsonb_build_object('finalized_at', to_jsonb(now()), 'tagged', v_tagged)
   WHERE id = p_import_id
     AND (import_completion_status IS NULL OR import_completion_status = 'pending_campaign');

  RETURN jsonb_build_object(
    'finalized', true,
    'status', v_status,
    'idempotent', false,
    'imported_count', c.imported_count,
    'attempted', v_attempted,
    'added', v_added,
    'skipped', v_skipped,
    'tagged_count', v_tagged
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_contact_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_contact_import(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 4. Restore public.add_leads_to_campaign(uuid,uuid[],uuid) — VERBATIM pre-change definition.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_leads_to_campaign(p_campaign_id uuid, p_lead_ids uuid[], p_import_history_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_campaign RECORD;
  v_campaign_type TEXT;
  v_campaign_user_id UUID;
  v_lead RECORD;
  v_lead_id UUID;
  v_valid_leads JSONB := '[]'::JSONB;
  v_skipped_ids UUID[] := ARRAY[]::UUID[];
  v_added INT := 0;
  v_skipped INT := 0;
  v_attempted INT := COALESCE(array_length(p_lead_ids, 1), 0);
  v_already_exists BOOLEAN;
  v_ctx RECORD;
BEGIN
  IF p_import_history_id IS NOT NULL THEN
    SELECT * INTO v_ctx FROM public._import_undo_context(p_import_history_id);
    IF v_ctx.reason IS NOT NULL THEN
      RAISE EXCEPTION 'import provenance rejected: %', v_ctx.reason USING ERRCODE = '42501';
    END IF;
    IF NOT v_ctx.authorized THEN
      RAISE EXCEPTION 'not authorized for import %', p_import_history_id USING ERRCODE = '42501';
    END IF;
    IF v_ctx.already_undone THEN
      RAISE EXCEPTION 'import % already undone', p_import_history_id USING ERRCODE = '22023';
    END IF;
    IF v_ctx.campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'import % campaign mismatch', p_import_history_id USING ERRCODE = '22023';
    END IF;
    IF v_ctx.completion_status IS NOT NULL AND v_ctx.completion_status <> 'pending_campaign' THEN
      RAISE EXCEPTION 'import % already finalized (%)', p_import_history_id, v_ctx.completion_status USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_lead_ids) x WHERE x <> ALL (v_ctx.validated_ids)) THEN
      RAISE EXCEPTION 'lead id outside import % set', p_import_history_id USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND organization_id = public.get_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  v_campaign_type := v_campaign.type;
  v_campaign_user_id := v_campaign.user_id;

  FOREACH v_lead_id IN ARRAY p_lead_ids
  LOOP
    SELECT * INTO v_lead
    FROM public.leads
    WHERE id = v_lead_id
      AND organization_id = public.get_org_id();

    IF NOT FOUND THEN
      v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.campaign_leads
      WHERE campaign_id = p_campaign_id
        AND lead_id = v_lead_id
    ) INTO v_already_exists;

    IF v_already_exists THEN
      v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_campaign_type = 'Personal' THEN
      IF v_lead.assigned_agent_id IS DISTINCT FROM v_campaign_user_id THEN
        v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

    ELSIF v_campaign_type = 'Team' THEN
      IF NOT (
        v_lead.assigned_agent_id = v_campaign_user_id
        OR public.is_ancestor_of(v_campaign_user_id, v_lead.assigned_agent_id)
      ) THEN
        v_skipped_ids := array_append(v_skipped_ids, v_lead_id);
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

    ELSIF v_campaign_type IN ('Open', 'Open Pool') THEN
      NULL;
    END IF;

    v_valid_leads := v_valid_leads || jsonb_build_object(
      'campaign_id', p_campaign_id,
      'lead_id', v_lead_id,
      'first_name', v_lead.first_name,
      'last_name', v_lead.last_name,
      'phone', v_lead.phone,
      'email', v_lead.email,
      'state', public.normalize_us_state(v_lead.state),
      'age', v_lead.age,
      'status', 'Queued',
      'organization_id', public.get_org_id()
    );
    v_added := v_added + 1;
  END LOOP;

  IF v_added > 0 THEN
    INSERT INTO public.campaign_leads (
      campaign_id, lead_id, first_name, last_name,
      phone, email, state, age, status, organization_id, import_history_id
    )
    SELECT
      (el->>'campaign_id')::UUID,
      (el->>'lead_id')::UUID,
      el->>'first_name',
      el->>'last_name',
      el->>'phone',
      el->>'email',
      el->>'state',
      NULLIF(el->>'age', '')::INTEGER,
      el->>'status',
      (el->>'organization_id')::UUID,
      p_import_history_id
    FROM jsonb_array_elements(v_valid_leads) AS el;
  END IF;

  IF p_import_history_id IS NOT NULL THEN
    UPDATE public.import_history
       SET import_completion_metadata = jsonb_build_object(
             'attempted', COALESCE((import_completion_metadata->>'attempted')::int, 0) + v_attempted,
             'added',     COALESCE((import_completion_metadata->>'added')::int, 0) + v_added,
             'skipped',   COALESCE((import_completion_metadata->>'skipped')::int, 0) + v_skipped,
             'batches',   COALESCE((import_completion_metadata->>'batches')::int, 0) + 1,
             'last_attempt_at', to_jsonb(now())
           )
     WHERE id = p_import_history_id;
  END IF;

  RETURN jsonb_build_object(
    'added', v_added,
    'skipped', v_skipped,
    'skipped_ids', to_jsonb(v_skipped_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_leads_to_campaign(uuid, uuid[], uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 5. Drop the unique index added by M1.
--    Destroys no rows. Takes ACCESS EXCLUSIVE on public.campaign_leads only for the drop.
-- -----------------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS public.campaign_leads_campaign_lead_unique;

-- -----------------------------------------------------------------------------------------------------
-- 6. Post-rollback verification (raises if anything is left behind).
-- -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.create_import_campaign(text,text,text,uuid,uuid[],text)') IS NOT NULL
     OR to_regprocedure('public.retry_import_campaign_attachment(uuid)') IS NOT NULL
     OR to_regprocedure('public.can_dial_campaign(uuid)') IS NOT NULL
     OR to_regprocedure('private.attach_leads_to_campaign_core(uuid,uuid[],uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: a new function still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname='public' AND indexname='campaign_leads_campaign_lead_unique') THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETE: campaign_leads_campaign_lead_unique still exists';
  END IF;

  -- The M3 permission hardening is DELIBERATELY preserved through rollback.
  IF has_function_privilege('anon', 'public.start_dialer_session(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK UNSAFE: anon regained EXECUTE on start_dialer_session';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.start_dialer_session(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK BROKEN: authenticated lost EXECUTE on start_dialer_session';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.add_leads_to_campaign(uuid,uuid[],uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLBACK BROKEN: authenticated lost EXECUTE on add_leads_to_campaign';
  END IF;

  RAISE NOTICE 'Rollback complete: prior function bodies restored, new objects removed, '
               'start_dialer_session permission hardening preserved.';
END $$;

COMMIT;

-- =====================================================================================================
-- OPERATOR STEP — MIGRATION HISTORY RECONCILIATION (SEPARATE, NOT PART OF THIS TRANSACTION)
-- =====================================================================================================
-- Nothing above touches supabase_migrations.schema_migrations. Reconcile the recorded history ONLY
-- after ALL of the following are true:
--
--   1. The schema rollback transaction above COMMITTED successfully.
--   2. The post-rollback verification block raised no exception.
--   3. The ACTUAL remote migration list has been inspected, e.g.
--          supabase migration list --linked
--      (or the Supabase MCP `list_migrations`) — confirm which of the three versions are
--      genuinely recorded as applied remotely. Do not assume.
--   4. The operator has EXPLICITLY APPROVED reconciliation.
--
-- Then, using the supported CLI command (one per version actually recorded remotely):
--
--   supabase migration repair --status reverted 20260807165620
--   supabase migration repair --status reverted 20260807165610
--   supabase migration repair --status reverted 20260807165600
--
-- Exact versions to reconcile (reverse apply order):
--   20260807165620   dialer_session_campaign_access
--   20260807165610   import_campaign_creation_and_retry
--   20260807165600   campaign_leads_membership_uniqueness_and_attachment_core
--
-- DO NOT hand-edit supabase_migrations.schema_migrations. DO NOT run these commands as part of
-- the rollback transaction. They are listed here for the operator; this file does not execute them.
-- =====================================================================================================
