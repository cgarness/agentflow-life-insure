-- P0 dialer reliability. Review/apply separately from the frontend release.
-- No duration/disposition/queue/lock changes. Signed admissions remain authoritative.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $preimage$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('public.start_dialer_session(uuid)') AND md5(p.prosrc)='46b60b52c623b6825ccfa70076801b20' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: public.start_dialer_session'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz)') AND md5(p.prosrc)='361906f79d4b6a80f681b9fe0cf4db2a' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: public.get_trusted_today_dialer_stats'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure('public.get_trusted_today_dialer_stats_v2(uuid,timestamptz,timestamptz,date)') AND md5(p.prosrc)='b00c02b0e1bab7d57ddd273dc720d1ca' AND p.proowner='postgres'::regrole AND p.prosecdef IS true AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'Dialer hotfix preimage drift: public.get_trusted_today_dialer_stats_v2'; END IF;
END $preimage$;
ALTER TABLE public.calls ADD COLUMN dialer_provider_admitted boolean;
ALTER TABLE public.calls ADD COLUMN dialer_dispatch_error text
  CHECK (dialer_dispatch_error IN ('not_sent', 'unconfirmed'));

CREATE FUNCTION private.sync_dialer_provider_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Browser values are never trusted. Runs AFTER calls_guard_dialer_core by name.
  NEW.dialer_provider_admitted := CASE WHEN NEW.dialer_admission_required THEN EXISTS (
    SELECT 1 FROM private.dialer_outbound_admissions a
    WHERE a.organization_id=NEW.organization_id AND a.call_id=NEW.id AND a.admitted
  ) ELSE NULL END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.sync_dialer_provider_admission() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER calls_zz_sync_provider_admission BEFORE INSERT OR UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION private.sync_dialer_provider_admission();
-- Exact projection of existing signed evidence; does not infer history from CallSid.
UPDATE public.calls c SET dialer_provider_admitted = a.admitted
  FROM private.dialer_outbound_admissions a
  WHERE c.organization_id=a.organization_id AND c.id=a.call_id AND c.dialer_admission_required;

CREATE FUNCTION public.record_dialer_dispatch_failure(p_call_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; ca public.calls;
BEGIN
  IF p_reason NOT IN ('not_sent','unconfirmed') OR p_reason IS NULL THEN
    RAISE EXCEPTION 'Invalid dispatch failure' USING ERRCODE='22023';
  END IF;
  SELECT * INTO a FROM private.campaign_actor();
  SELECT * INTO ca FROM public.calls WHERE id=p_call_id AND organization_id=a.org_id AND agent_id=a.uid FOR UPDATE;
  IF NOT FOUND OR ca.direction<>'outbound' OR NOT ca.dialer_admission_required THEN
    RAISE EXCEPTION 'Call not permitted' USING ERRCODE='42501';
  END IF;
  -- Admission takes this same call-row lock. Provider evidence always wins the race.
  IF ca.twilio_call_sid IS NOT NULL OR EXISTS (SELECT 1 FROM private.dialer_outbound_admissions d
      WHERE d.organization_id=ca.organization_id AND d.call_id=ca.id) THEN RETURN; END IF;
  UPDATE public.calls SET dialer_dispatch_error=p_reason,
    status=CASE WHEN p_reason='not_sent' AND status='ringing' THEN 'failed' ELSE status END
    WHERE id=ca.id AND organization_id=a.org_id;
END $$;
REVOKE ALL ON FUNCTION public.record_dialer_dispatch_failure(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_dialer_dispatch_failure(uuid,text) TO authenticated;

CREATE FUNCTION public.set_dialer_session_mode(p_session_id uuid, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM private.campaign_actor();
  UPDATE public.dialer_sessions SET auto_dial_enabled=COALESCE(p_enabled,false)
    WHERE id=p_session_id AND organization_id=a.org_id AND agent_id=a.uid
      AND status='active' AND ended_at IS NULL
      AND (campaign_id IS NULL OR public.can_dial_campaign(campaign_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'Active campaign session not permitted' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_dialer_session_mode(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_dialer_session_mode(uuid,boolean) TO authenticated;

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
      'status', v_session.status, 'auto_dial_enabled', v_session.auto_dial_enabled
    );
  END IF;

  INSERT INTO public.dialer_sessions (
    organization_id,
    agent_id,
    campaign_id,
    started_at,
    last_heartbeat_at,
    status, auto_dial_enabled
  )
  VALUES (
    v_org,
    v_agent,
    p_campaign_id,
    pg_catalog.now(),
    pg_catalog.now(),
    'active', COALESCE((SELECT c.auto_dial_enabled FROM public.campaigns c WHERE c.id=p_campaign_id AND c.organization_id=v_org),false)
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
    'status', v_session.status, 'auto_dial_enabled', v_session.auto_dial_enabled
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.get_trusted_today_dialer_stats(p_campaign_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(calls_made integer, contacted_calls integer, total_talk_seconds integer, policies_sold integer, session_duration_seconds integer, closed_session_duration_seconds integer, active_session_id uuid, active_session_started_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT a.org_id, a.uid FROM private.campaign_actor() a
  ),
  call_facts AS (
    SELECT
      coalesce(ca.duration, 0) AS duration,
      CASE
        WHEN lower(coalesce(di.name, ca.disposition_name, '')) = 'no answer'
          THEN false
        WHEN coalesce(ca.duration, 0) > 45
          THEN true
        WHEN coalesce(di.counts_as_contacted, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(dn.counts_as_contacted, false)
          THEN true
        ELSE false
      END AS is_contacted
    FROM me
    JOIN public.calls ca
      ON ca.agent_id = me.uid
     AND ca.organization_id = me.org_id
     AND ca.campaign_id = p_campaign_id
     AND ca.created_at >= p_start
     AND ca.created_at < least(p_end,now())
     AND (NOT ca.dialer_admission_required OR ca.dialer_provider_admitted IS TRUE)
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
     AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=ca.organization_id AND d.kind='call' AND d.duplicate_id=ca.id)
    LEFT JOIN public.dispositions di ON di.id = ca.disposition_id AND di.organization_id=me.org_id
    LEFT JOIN LATERAL (SELECT bool_or(d.counts_as_contacted) AS counts_as_contacted
      FROM public.dispositions d WHERE ca.disposition_id IS NULL
        AND lower(d.name)=lower(ca.disposition_name) AND d.organization_id=me.org_id) dn ON true
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  sess AS (
    SELECT
      s.id,
      s.started_at,
      (s.status = 'active' AND s.ended_at IS NULL) AS is_active,
      GREATEST(0, floor(extract(epoch FROM (
        least(p_end, now(), coalesce(
          s.ended_at,
          CASE
            WHEN s.status = 'active' AND s.ended_at IS NULL THEN now()
            ELSE coalesce(s.last_heartbeat_at, s.started_at)
          END
        )) - s.started_at
      )))::int) AS span
    FROM me
    JOIN public.dialer_sessions s
      ON s.agent_id = me.uid
     AND s.organization_id = me.org_id
     AND s.campaign_id = p_campaign_id
     AND s.started_at >= p_start
     AND s.started_at < least(p_end,now())
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  active_sess AS (
    SELECT id, started_at FROM sess WHERE is_active ORDER BY started_at LIMIT 1
  )
  SELECT
    (SELECT count(*)::int FROM call_facts)                                  AS calls_made,
    (SELECT count(*)::int FROM call_facts WHERE is_contacted)               AS contacted_calls,
    (SELECT coalesce(sum(duration), 0)::int FROM call_facts)                AS total_talk_seconds,
    (SELECT count(*)::int
       FROM public.wins w, me
      WHERE w.agent_id = me.uid
        AND w.organization_id = me.org_id
        AND w.campaign_id = p_campaign_id
        AND w.created_at >= p_start
        AND w.created_at < least(p_end,now()))                                          AS policies_sold,
    (SELECT coalesce(sum(span), 0)::int FROM sess)                          AS session_duration_seconds,
    (SELECT coalesce(sum(span), 0)::int FROM sess WHERE NOT is_active)      AS closed_session_duration_seconds,
    (SELECT id FROM active_sess)                                            AS active_session_id,
    (SELECT started_at FROM active_sess)                                    AS active_session_started_at;
$function$

;

CREATE OR REPLACE FUNCTION public.get_trusted_today_dialer_stats_v2(p_campaign_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_sale_date date)
 RETURNS TABLE(calls_made integer, contacted_calls integer, total_talk_seconds integer, policies_sold integer, session_duration_seconds integer, closed_session_duration_seconds integer, active_session_id uuid, active_session_started_at timestamp with time zone, policy_date_basis text, policy_sale_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT a.org_id, a.uid FROM private.campaign_actor() a
  ),
  call_facts AS (
    SELECT
      coalesce(ca.duration, 0) AS duration,
      CASE
        WHEN lower(coalesce(di.name, ca.disposition_name, '')) = 'no answer'
          THEN false
        WHEN coalesce(ca.duration, 0) > 45
          THEN true
        WHEN coalesce(di.counts_as_contacted, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(dn.counts_as_contacted, false)
          THEN true
        ELSE false
      END AS is_contacted
    FROM me
    JOIN public.calls ca
      ON ca.agent_id = me.uid
     AND ca.organization_id = me.org_id
     AND ca.campaign_id = p_campaign_id
     AND ca.created_at >= p_start
     AND ca.created_at < least(p_end,now())
     AND (NOT ca.dialer_admission_required OR ca.dialer_provider_admitted IS TRUE)
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
     AND NOT EXISTS(SELECT 1 FROM private.performance_duplicate_rows d WHERE d.organization_id=ca.organization_id AND d.kind='call' AND d.duplicate_id=ca.id)
    LEFT JOIN public.dispositions di ON di.id = ca.disposition_id AND di.organization_id=me.org_id
    LEFT JOIN LATERAL (SELECT bool_or(d.counts_as_contacted) AS counts_as_contacted
      FROM public.dispositions d WHERE ca.disposition_id IS NULL
        AND lower(d.name)=lower(ca.disposition_name) AND d.organization_id=me.org_id) dn ON true
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  sess AS (
    SELECT
      s.id,
      s.started_at,
      (s.status = 'active' AND s.ended_at IS NULL) AS is_active,
      GREATEST(0, floor(extract(epoch FROM (
        least(p_end, now(), coalesce(
          s.ended_at,
          CASE
            WHEN s.status = 'active' AND s.ended_at IS NULL THEN now()
            ELSE coalesce(s.last_heartbeat_at, s.started_at)
          END
        )) - s.started_at
      )))::int) AS span
    FROM me
    JOIN public.dialer_sessions s
      ON s.agent_id = me.uid
     AND s.organization_id = me.org_id
     AND s.campaign_id = p_campaign_id
     AND s.started_at >= p_start
     AND s.started_at < least(p_end,now())
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  active_sess AS (
    SELECT id, started_at FROM sess WHERE is_active ORDER BY started_at LIMIT 1
  )
  SELECT
    (SELECT count(*)::int FROM call_facts)                                  AS calls_made,
    (SELECT count(*)::int FROM call_facts WHERE is_contacted)               AS contacted_calls,
    (SELECT coalesce(sum(duration), 0)::int FROM call_facts)                AS total_talk_seconds,
    (SELECT count(*)::int
       FROM public.wins w, me
      WHERE w.agent_id = me.uid
        AND w.organization_id = me.org_id
        AND w.campaign_id = p_campaign_id
        AND w.sold_date = p_sale_date)                                      AS policies_sold,
    (SELECT coalesce(sum(span), 0)::int FROM sess)                          AS session_duration_seconds,
    (SELECT coalesce(sum(span), 0)::int FROM sess WHERE NOT is_active)      AS closed_session_duration_seconds,
    (SELECT id FROM active_sess)                                            AS active_session_id,
    (SELECT started_at FROM active_sess)                                    AS active_session_started_at,
    'sold_date'::text                                                       AS policy_date_basis,
    p_sale_date                                                             AS policy_sale_date
  WHERE private.dialer_sale_day_check(p_start, p_end, p_sale_date);
$function$

;
NOTIFY pgrst, 'reload schema';
COMMIT;
