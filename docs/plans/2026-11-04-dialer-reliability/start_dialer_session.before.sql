CREATE OR REPLACE FUNCTION public.start_dialer_session(p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
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

  -- A campaign-scoped session requires dial authorization for THIS caller.
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
    -- SAVED / RESUMED SESSION AUTHORIZATION.
    --
    -- Authorizing only p_campaign_id is not enough: this branch returns a session that already
    -- exists, whose own campaign_id may be something else entirely. Two concrete bypasses this
    -- closes:
    --   (a) start_dialer_session(NULL) — no campaign is supplied, so the guard above is skipped,
    --       and an active session for a Personal campaign the caller may NOT dial is resumed.
    --   (b) start_dialer_session(<authorized campaign>) — the guard passes, but the returned
    --       session belongs to a DIFFERENT, unauthorized campaign.
    --
    -- The session's OWN campaign is therefore re-authorized here, and a requested campaign that
    -- does not match the active session is refused rather than silently satisfied by the wrong
    -- session. Both paths FAIL CLOSED.
    --
    -- Deliberately NOT done: ending, abandoning, rewriting or replacing the session. That would
    -- mutate `dialer_sessions` telemetry (AGENT_RULES invariant #12 — server-timestamped session
    -- rows are the trusted source for reporting) purely as an authorization workaround. The
    -- session is left exactly as it is; the caller is refused. Ending a session remains an
    -- explicit lifecycle action via end_dialer_session.
    IF v_session.campaign_id IS NOT NULL
       AND NOT public.can_dial_campaign(v_session.campaign_id) THEN
      RAISE EXCEPTION 'not authorized to resume dialer session for campaign %',
        v_session.campaign_id USING ERRCODE = '42501';
    END IF;

    IF p_campaign_id IS NOT NULL
       AND v_session.campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION
        'active dialer session belongs to campaign %, not the requested campaign %; '
        'end the current session before starting one for another campaign',
        COALESCE(v_session.campaign_id::text, 'none'), p_campaign_id
        USING ERRCODE = '42501';
    END IF;

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
$function$
