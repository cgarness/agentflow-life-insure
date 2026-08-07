-- ============================================================================
-- start_dialer_session: reject Dialer sessions for campaigns the caller may not dial.
--
-- Before this migration the function validated only get_org_id() and auth.uid(); the
-- supplied p_campaign_id was inserted verbatim and never joined to public.campaigns.
-- Combined with campaigns_select's Admin/Team-Leader role short-circuit, a direct
-- /dialer?campaign=<another agent's Personal campaign> URL had no server-side gate.
--
-- This is the INDEPENDENT database enforcement of the Personal-owner-only dialing rule.
-- The frontend additionally gates every entry point on public.can_dial_campaign(uuid),
-- but this function must refuse on its own.
--
-- Everything else is preserved verbatim: org/uid validation, the stale-session cleanup
-- call, the active-session reuse branch, the insert columns, and the return shape.
--
-- SEARCH_PATH HARDENING (review item 4). The prior definition used
--     SET search_path TO 'public', 'private', 'pg_temp'
-- which places two writable schemas ahead of the temp schema in an explicit path. This version
-- uses the restrictive pattern every other function in this change set uses:
--     SET search_path = pg_catalog, pg_temp
-- This is behaviour-preserving because EVERY application object the body touches is already
-- schema-qualified:
--     public.dialer_sessions            (SELECT, INSERT, and the %ROWTYPE declaration)
--     public.get_org_id()
--     public.can_dial_campaign(uuid)
--     private.close_stale_dialer_sessions(uuid, uuid, int)
--     auth.uid()
-- and the only remaining unqualified references — now() and jsonb_build_object() — are now
-- written as pg_catalog.now() / pg_catalog.jsonb_build_object() so no reasoning about implicit
-- pg_catalog precedence is required. There is therefore NO unqualified name an attacker could
-- resolve through this function's search path. No dialer behaviour changes.
--
-- ROLLBACK: executable script at
--   supabase/rollback/20260807_import_campaign_attachment_rollback.sql
-- It contains the VERBATIM pre-change definition of public.start_dialer_session(uuid) captured from
-- production via pg_get_functiondef BEFORE this migration (md5-verified identical), and restores the
-- pre-change ACL (PUBLIC and anon DID hold EXECUTE before this work).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_dialer_session(p_campaign_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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

  -- NEW: a campaign-scoped session requires dial authorization for THIS caller.
  -- Personal campaigns are owner-only; management/view-all permissions do not apply.
  IF p_campaign_id IS NOT NULL AND NOT public.can_dial_campaign(p_campaign_id) THEN
    RAISE EXCEPTION 'not authorized to dial campaign %', p_campaign_id USING ERRCODE = '42501';
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
    RETURN pg_catalog.jsonb_build_object(
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
    pg_catalog.now(),
    pg_catalog.now(),
    'active'
  )
  RETURNING * INTO v_session;

  RETURN pg_catalog.jsonb_build_object(
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

-- ---------------------------------------------------------------------------
-- Grants.
--
-- CREATE OR REPLACE FUNCTION does NOT reset a function's ACL, and the live
-- pre-existing ACL for this function was:
--     =X/postgres            <-- PUBLIC had EXECUTE
--     postgres=X/postgres
--     anon=X/postgres
--     authenticated=X/postgres
--     service_role=X/postgres
-- so without the explicit REVOKE below the replaced body would remain callable by
-- PUBLIC and anon. The body already fails closed for an unauthenticated caller
-- ('authentication required'), so no working path depends on those grants — this is a
-- defence-in-depth tightening, and it brings the function in line with every other
-- privileged RPC in this change set.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.start_dialer_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_dialer_session(uuid) TO authenticated, service_role;
