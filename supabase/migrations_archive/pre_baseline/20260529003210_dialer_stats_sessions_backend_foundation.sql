-- =============================================================
-- Migration: P1 Build 1 — Backend Stats + Server Session Foundation
-- Date: 2026-05-28
-- Purpose:
--   1. Harden dialer_daily_stats tenant isolation (organization_id + RLS)
--   2. Harden increment_dialer_stats (legacy/display only — not trusted stats)
--   3. Repair dialer_sessions for server-timestamped session lifecycle
--   4. Add session RPCs with opportunistic stale cleanup (private helper)
-- Audit (pre-apply, project jncvvsvckxhqgqvkppmj):
--   dialer_daily_stats rows = 4, orphan organization_id = 0
--   dialer_sessions rows = 0
--   increment_dialer_stats: 2 overloads, no org/auth validation, granted to PUBLIC/anon
-- Does NOT touch: calls.duration, twilio-voice-status, twilio-voice-webhook
-- Depends on: public.get_org_id(), public.update_updated_at()
-- =============================================================

CREATE SCHEMA IF NOT EXISTS private;

-- =============================================================
-- 1. dialer_daily_stats — organization_id + tenant RLS
-- =============================================================

ALTER TABLE public.dialer_daily_stats
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

UPDATE public.dialer_daily_stats d
SET organization_id = p.organization_id
FROM public.profiles p
WHERE p.id = d.agent_id
  AND d.organization_id IS NULL;

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.dialer_daily_stats
  WHERE organization_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot SET NOT NULL on dialer_daily_stats.organization_id: % orphan row(s). Backfill first.',
      orphan_count;
  END IF;
END$$;

ALTER TABLE public.dialer_daily_stats
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dialer_daily_stats_org_agent_date
  ON public.dialer_daily_stats (organization_id, agent_id, stat_date);

ALTER TABLE public.dialer_daily_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_select_own ON public.dialer_daily_stats;
DROP POLICY IF EXISTS agent_insert_own ON public.dialer_daily_stats;
DROP POLICY IF EXISTS agent_update_own ON public.dialer_daily_stats;
DROP POLICY IF EXISTS agent_delete_own ON public.dialer_daily_stats;
DROP POLICY IF EXISTS admin_select_all ON public.dialer_daily_stats;
DROP POLICY IF EXISTS dialer_daily_stats_agent_select ON public.dialer_daily_stats;
DROP POLICY IF EXISTS dialer_daily_stats_agent_insert ON public.dialer_daily_stats;
DROP POLICY IF EXISTS dialer_daily_stats_agent_update ON public.dialer_daily_stats;
DROP POLICY IF EXISTS dialer_daily_stats_agent_delete ON public.dialer_daily_stats;
DROP POLICY IF EXISTS dialer_daily_stats_manager_select ON public.dialer_daily_stats;

CREATE POLICY dialer_daily_stats_agent_select ON public.dialer_daily_stats
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_daily_stats_agent_insert ON public.dialer_daily_stats
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_daily_stats_agent_update ON public.dialer_daily_stats
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_daily_stats_agent_delete ON public.dialer_daily_stats
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_daily_stats_manager_select ON public.dialer_daily_stats
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('Admin', 'Team Leader')
    )
  );

-- =============================================================
-- 2. increment_dialer_stats — legacy/display only (hardened)
--    NOT trusted for talk time, connected counts, billing, or manager reporting.
-- =============================================================

DROP FUNCTION IF EXISTS public.increment_dialer_stats(
  uuid, integer, integer, integer, integer, timestamptz, integer
);

DROP FUNCTION IF EXISTS public.increment_dialer_stats(
  uuid, integer, integer, integer, integer, timestamptz, integer, integer
);

CREATE OR REPLACE FUNCTION public.increment_dialer_stats(
  p_agent_id uuid,
  p_calls_made integer DEFAULT 0,
  p_calls_connected integer DEFAULT 0,
  p_total_talk_seconds integer DEFAULT 0,
  p_policies_sold integer DEFAULT 0,
  p_session_started_at timestamptz DEFAULT NULL,
  p_amd_skipped integer DEFAULT 0,
  p_session_duration_seconds integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  -- Legacy/display compatibility RPC — browser-derived increments only.
  -- Trusted talk time: calls.duration (twilio-voice-status).
  -- Trusted session duration: dialer_sessions server timestamps (Build 2 frontend).

  v_org := public.get_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'organization context required';
  END IF;

  IF p_agent_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'agents may only increment their own dialer stats';
  END IF;

  INSERT INTO public.dialer_daily_stats (
    organization_id,
    agent_id,
    stat_date,
    calls_made,
    calls_connected,
    total_talk_seconds,
    policies_sold,
    session_started_at,
    amd_skipped,
    session_duration_seconds,
    last_updated_at
  )
  VALUES (
    v_org,
    p_agent_id,
    CURRENT_DATE,
    p_calls_made,
    p_calls_connected,
    p_total_talk_seconds,
    p_policies_sold,
    p_session_started_at,
    p_amd_skipped,
    p_session_duration_seconds,
    now()
  )
  ON CONFLICT (agent_id, stat_date)
  DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    calls_made = dialer_daily_stats.calls_made + EXCLUDED.calls_made,
    calls_connected = dialer_daily_stats.calls_connected + EXCLUDED.calls_connected,
    total_talk_seconds = dialer_daily_stats.total_talk_seconds + EXCLUDED.total_talk_seconds,
    policies_sold = dialer_daily_stats.policies_sold + EXCLUDED.policies_sold,
    session_started_at = COALESCE(dialer_daily_stats.session_started_at, EXCLUDED.session_started_at),
    amd_skipped = dialer_daily_stats.amd_skipped + EXCLUDED.amd_skipped,
    session_duration_seconds = dialer_daily_stats.session_duration_seconds + EXCLUDED.session_duration_seconds,
    last_updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.increment_dialer_stats(
  uuid, integer, integer, integer, integer, timestamptz, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_dialer_stats(
  uuid, integer, integer, integer, integer, timestamptz, integer, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_dialer_stats(
  uuid, integer, integer, integer, integer, timestamptz, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_dialer_stats(
  uuid, integer, integer, integer, integer, timestamptz, integer, integer
) TO service_role;

-- =============================================================
-- 3. dialer_sessions — repair schema for server-timestamped sessions
--    Legacy aggregate columns retained for Reports backward compatibility.
-- =============================================================

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.dialer_sessions
SET
  last_heartbeat_at = COALESCE(last_heartbeat_at, started_at, now()),
  status = COALESCE(
    status,
    CASE WHEN ended_at IS NULL THEN 'active' ELSE 'ended' END
  ),
  updated_at = COALESCE(updated_at, created_at, now())
WHERE last_heartbeat_at IS NULL
   OR status IS NULL
   OR updated_at IS NULL;

ALTER TABLE public.dialer_sessions
  ALTER COLUMN last_heartbeat_at SET DEFAULT now(),
  ALTER COLUMN last_heartbeat_at SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'ended',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN started_at SET DEFAULT now(),
  ALTER COLUMN started_at SET NOT NULL;

DO $$
DECLARE
  null_agent_count integer;
  null_org_count integer;
BEGIN
  SELECT count(*) INTO null_agent_count
  FROM public.dialer_sessions
  WHERE agent_id IS NULL;

  IF null_agent_count > 0 THEN
    RAISE EXCEPTION
      'Cannot SET NOT NULL on dialer_sessions.agent_id: % row(s) have NULL agent_id.',
      null_agent_count;
  END IF;

  SELECT count(*) INTO null_org_count
  FROM public.dialer_sessions
  WHERE organization_id IS NULL;

  IF null_org_count > 0 THEN
    RAISE EXCEPTION
      'Cannot SET NOT NULL on dialer_sessions.organization_id: % row(s) have NULL organization_id.',
      null_org_count;
  END IF;
END$$;

ALTER TABLE public.dialer_sessions
  ALTER COLUMN agent_id SET NOT NULL,
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.dialer_sessions
  DROP CONSTRAINT IF EXISTS dialer_sessions_status_check;

ALTER TABLE public.dialer_sessions
  ADD CONSTRAINT dialer_sessions_status_check
  CHECK (status IN ('active', 'ended', 'abandoned'));

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_org_agent_started
  ON public.dialer_sessions (organization_id, agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_org_status_heartbeat
  ON public.dialer_sessions (organization_id, status, last_heartbeat_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_sessions_one_active_per_agent
  ON public.dialer_sessions (organization_id, agent_id)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS dialer_sessions_updated_at ON public.dialer_sessions;
CREATE TRIGGER dialer_sessions_updated_at
  BEFORE UPDATE ON public.dialer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.dialer_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialer_sessions_select_own ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_insert_own ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_update_own ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_admin_select ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_agent_select ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_agent_insert ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_agent_update ON public.dialer_sessions;
DROP POLICY IF EXISTS dialer_sessions_manager_select ON public.dialer_sessions;

CREATE POLICY dialer_sessions_agent_select ON public.dialer_sessions
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_sessions_agent_insert ON public.dialer_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_sessions_agent_update ON public.dialer_sessions
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

CREATE POLICY dialer_sessions_manager_select ON public.dialer_sessions
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('Admin', 'Team Leader')
    )
  );

-- =============================================================
-- 4. Session RPCs — server timestamps + opportunistic stale cleanup
--    private.close_stale_dialer_sessions is NOT granted to authenticated.
--    Stale cleanup scope: current org + current agent only.
-- =============================================================

CREATE OR REPLACE FUNCTION private.close_stale_dialer_sessions(
  p_organization_id uuid,
  p_agent_id uuid,
  p_stale_minutes integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed integer;
BEGIN
  IF p_organization_id IS NULL OR p_agent_id IS NULL THEN
    RAISE EXCEPTION 'organization_id and agent_id are required';
  END IF;

  IF p_stale_minutes IS NULL OR p_stale_minutes < 1 THEN
    RAISE EXCEPTION 'stale_minutes must be >= 1';
  END IF;

  UPDATE public.dialer_sessions
  SET
    status = 'abandoned',
    ended_at = last_heartbeat_at,
    updated_at = now()
  WHERE organization_id = p_organization_id
    AND agent_id = p_agent_id
    AND status = 'active'
    AND last_heartbeat_at < now() - (p_stale_minutes || ' minutes')::interval;

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION private.close_stale_dialer_sessions(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.close_stale_dialer_sessions(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION private.close_stale_dialer_sessions(uuid, uuid, integer) FROM authenticated;

CREATE OR REPLACE FUNCTION public.start_dialer_session(
  p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_dialer_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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

  UPDATE public.dialer_sessions
  SET
    last_heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_session_id
    AND organization_id = v_org
    AND agent_id = v_agent
    AND status = 'active'
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active dialer session not found or not owned by caller';
  END IF;

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
$$;

CREATE OR REPLACE FUNCTION public.end_dialer_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
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

  SELECT *
  INTO v_session
  FROM public.dialer_sessions
  WHERE id = p_session_id
    AND organization_id = v_org
    AND agent_id = v_agent;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dialer session not found or not owned by caller';
  END IF;

  IF v_session.status IN ('ended', 'abandoned') THEN
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

  UPDATE public.dialer_sessions
  SET
    status = 'ended',
    ended_at = now(),
    updated_at = now()
  WHERE id = p_session_id
    AND organization_id = v_org
    AND agent_id = v_agent
    AND status = 'active'
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
$$;

GRANT EXECUTE ON FUNCTION public.start_dialer_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_dialer_session(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.heartbeat_dialer_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_dialer_session(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.end_dialer_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_dialer_session(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
