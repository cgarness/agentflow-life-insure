-- =============================================================
-- Migration: Smart Queue Lock System
-- Date: 2026-04-05
-- Purpose: Prevent multiple agents from being served the same
--          lead simultaneously in Team and Open Pool campaigns.
--          Uses a single atomic fetch-and-lock RPC with SELECT
--          FOR UPDATE SKIP LOCKED to eliminate the race condition.
--
-- Tables Created:
--   public.dialer_lead_locks
--
-- Functions Created:
--   public.get_next_queue_lead(p_campaign_id, p_filters)
--   public.renew_lead_lock(p_lead_id)
--   public.release_lead_lock(p_lead_id)
--
-- Depends On:
--   public.get_org_id()          — 20260331200000_jwt_custom_claims.sql
--   public.get_user_role()       — 20260331200000_jwt_custom_claims.sql
--   public.is_super_admin()      — 20260331200000_jwt_custom_claims.sql
--   public.campaign_leads        — campaigns + campaign_leads tables
--   public.leads                 — master lead records
-- =============================================================


-- -------------------------------------------------------
-- PART 1 — TABLE: dialer_lead_locks
-- -------------------------------------------------------
-- NOTE: In this codebase, the dialer queue operates on
--       campaign_leads rows (the "contact in campaign" record).
--       lead_id here references campaign_leads.id, which is
--       the unique identifier the dialer uses for each queued lead.
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dialer_lead_locks (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         UUID        NOT NULL REFERENCES public.campaign_leads(id) ON DELETE CASCADE,
  agent_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id     UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL,
  locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_dialer_lead_locks_lead_id
  ON public.dialer_lead_locks(lead_id);

CREATE INDEX IF NOT EXISTS idx_dialer_lead_locks_campaign_id
  ON public.dialer_lead_locks(campaign_id);

CREATE INDEX IF NOT EXISTS idx_dialer_lead_locks_agent_id
  ON public.dialer_lead_locks(agent_id);

CREATE INDEX IF NOT EXISTS idx_dialer_lead_locks_expires_at
  ON public.dialer_lead_locks(expires_at);

CREATE INDEX IF NOT EXISTS idx_dialer_lead_locks_org_id
  ON public.dialer_lead_locks(organization_id);

-- Unique partial index: only ONE active lock per lead at any point in time.
-- Two rows with the same lead_id can coexist only if one has already expired.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_dialer_lead_locks_active_lead
  ON public.dialer_lead_locks(lead_id)
  WHERE (expires_at > now());


-- -------------------------------------------------------
-- PART 1b — RLS: dialer_lead_locks
-- -------------------------------------------------------

ALTER TABLE public.dialer_lead_locks ENABLE ROW LEVEL SECURITY;

-- Agents can see their own locks + admin/TL can see org locks
CREATE POLICY "dialer_lead_locks_select" ON public.dialer_lead_locks
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      agent_id = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- Agents can insert locks only within their own org
CREATE POLICY "dialer_lead_locks_insert" ON public.dialer_lead_locks
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND agent_id = auth.uid()
  );

-- Agents can update only their own locks (for heartbeat renewal)
CREATE POLICY "dialer_lead_locks_update" ON public.dialer_lead_locks
  FOR UPDATE TO authenticated
  USING (
    agent_id = auth.uid()
    AND organization_id = public.get_org_id()
  );

-- Agents can delete only their own locks (release on disposition/skip)
CREATE POLICY "dialer_lead_locks_delete" ON public.dialer_lead_locks
  FOR DELETE TO authenticated
  USING (
    agent_id = auth.uid()
    AND organization_id = public.get_org_id()
  );


-- -------------------------------------------------------
-- PART 2 — FUNCTION: get_next_queue_lead
-- -------------------------------------------------------
-- Atomically fetches + locks the next eligible lead for a
-- Team or Open Pool campaign. SECURITY DEFINER is required
-- so this function can read all campaign_leads in the pool
-- (not just the calling agent's own rows) and issue the
-- database-level row lock via FOR UPDATE SKIP LOCKED.
--
-- Steps (all in one transaction):
--   1. Purge expired locks for this campaign
--   2. Read campaign type + metadata
--   3. Build eligible pool (Team or Open Pool)
--   4. Apply p_filters dynamically
--   5. Lock first eligible row atomically (FOR UPDATE SKIP LOCKED)
--   6. Insert application-level lock into dialer_lead_locks
--   7. Return full campaign_leads row
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_next_queue_lead(
  p_campaign_id UUID,
  p_filters     JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign      RECORD;
  v_locked_id     UUID;
  v_result        public.campaign_leads;
  v_team_agents   UUID[];
  v_filter_status     TEXT;
  v_filter_state      TEXT;
  v_filter_source     TEXT;
  v_filter_max_att    INTEGER;
  v_filter_min_score  INTEGER;
  v_filter_max_score  INTEGER;
BEGIN
  -- ── Step 1: Delete stale locks for this campaign ──────────────────
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND expires_at <= now();

  -- ── Step 2: Fetch campaign record ────────────────────────────────
  SELECT type, assigned_agent_ids, organization_id
  INTO v_campaign
  FROM public.campaigns
  WHERE id = p_campaign_id
    AND organization_id = public.get_org_id();

  -- Campaign not found or not in caller's org → return empty
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- ── Step 3: Extract filter values (only apply if key present + non-null)
  v_filter_status    := p_filters->>'status';
  v_filter_state     := p_filters->>'state';
  v_filter_source    := p_filters->>'lead_source';
  v_filter_max_att   := (p_filters->>'max_attempts')::INTEGER;
  v_filter_min_score := (p_filters->>'min_score')::INTEGER;
  v_filter_max_score := (p_filters->>'max_score')::INTEGER;

  -- ── Step 4: Build team agent array for Team campaigns ─────────────
  -- campaigns.assigned_agent_ids is a JSONB array of UUID strings.
  -- For Team campaigns we scope to leads assigned to those agents.
  IF upper(v_campaign.type) = 'TEAM' THEN
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids)::UUID
    ) INTO v_team_agents;
  END IF;

  -- ── Step 5: Atomic fetch-and-lock ────────────────────────────────
  -- SELECT … FOR UPDATE OF cl SKIP LOCKED ensures that if two agents
  -- call this function at the same millisecond they will each grab a
  -- different row rather than blocking or colliding.
  --
  -- Additional NOT IN (active dialer_lead_locks) guard handles leads
  -- that are locked by connections that have already committed.
  IF upper(v_campaign.type) = 'TEAM' THEN
    SELECT cl.id INTO v_locked_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = public.get_org_id()
      AND cl.assigned_agent_id::UUID = ANY(v_team_agents)
      AND cl.status NOT IN ('DNC', 'Completed', 'Removed')
      AND cl.id NOT IN (
        SELECT dll.lead_id
        FROM public.dialer_lead_locks dll
        WHERE dll.expires_at > now()
      )
      -- Dynamic filter: status
      AND (v_filter_status IS NULL OR cl.status = v_filter_status)
      -- Dynamic filter: state (stored on campaign_leads; fall back to leads.state)
      AND (v_filter_state IS NULL
           OR cl.state = v_filter_state
           OR (cl.state IS NULL AND l.state = v_filter_state))
      -- Dynamic filter: lead_source (on leads table)
      AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
      -- Dynamic filter: max call attempts
      AND (v_filter_max_att IS NULL OR cl.call_attempts <= v_filter_max_att)
      -- Dynamic filter: min lead score (on leads table)
      AND (v_filter_min_score IS NULL OR l.lead_score >= v_filter_min_score)
      -- Dynamic filter: max lead score
      AND (v_filter_max_score IS NULL OR l.lead_score <= v_filter_max_score)
    ORDER BY cl.created_at ASC
    LIMIT 1
    FOR UPDATE OF cl SKIP LOCKED;

  ELSE
    -- Open Pool (type = 'Open Pool' or 'Open') — all org leads in campaign
    SELECT cl.id INTO v_locked_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = public.get_org_id()
      AND cl.status NOT IN ('DNC', 'Completed', 'Removed')
      AND cl.id NOT IN (
        SELECT dll.lead_id
        FROM public.dialer_lead_locks dll
        WHERE dll.expires_at > now()
      )
      -- Dynamic filters
      AND (v_filter_status IS NULL OR cl.status = v_filter_status)
      AND (v_filter_state IS NULL
           OR cl.state = v_filter_state
           OR (cl.state IS NULL AND l.state = v_filter_state))
      AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
      AND (v_filter_max_att IS NULL OR cl.call_attempts <= v_filter_max_att)
      AND (v_filter_min_score IS NULL OR l.lead_score >= v_filter_min_score)
      AND (v_filter_max_score IS NULL OR l.lead_score <= v_filter_max_score)
    ORDER BY cl.created_at ASC
    LIMIT 1
    FOR UPDATE OF cl SKIP LOCKED;
  END IF;

  -- Queue empty — return null row, not an error
  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  -- ── Step 6: Insert application-level lock ─────────────────────────
  -- ON CONFLICT DO NOTHING: if another transaction somehow committed
  -- the same lock in the nanosecond between our check and insert, we
  -- gracefully no-op (the unique partial index enforces uniqueness).
  INSERT INTO public.dialer_lead_locks
    (lead_id, agent_id, campaign_id, organization_id, expires_at)
  VALUES
    (v_locked_id, auth.uid(), p_campaign_id, public.get_org_id(), now() + INTERVAL '5 minutes')
  ON CONFLICT DO NOTHING;

  -- ── Step 7: Return the full campaign_leads row ────────────────────
  SELECT * INTO v_result
  FROM public.campaign_leads
  WHERE id = v_locked_id;

  RETURN NEXT v_result;
  RETURN;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(UUID, JSONB) TO authenticated;


-- -------------------------------------------------------
-- PART 3 — FUNCTION: renew_lead_lock
-- -------------------------------------------------------
-- Extends the lock expiry by 5 minutes. Called by the
-- frontend every 30 seconds while the agent is active on
-- the current lead. Returns TRUE if the lock was renewed,
-- FALSE if the lock no longer belongs to this agent
-- (expired or claimed by auto-expiry).
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.renew_lead_lock(p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_affected INTEGER;
BEGIN
  UPDATE public.dialer_lead_locks
  SET expires_at = now() + INTERVAL '5 minutes'
  WHERE lead_id   = p_lead_id
    AND agent_id  = auth.uid()
    AND expires_at > now();

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.renew_lead_lock(UUID) TO authenticated;


-- -------------------------------------------------------
-- PART 4 — FUNCTION: release_lead_lock
-- -------------------------------------------------------
-- Deletes the lock held by the current agent on a lead.
-- Called on: skip, disposition save, session end,
-- and beforeunload event in the browser.
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_lead_lock(p_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE lead_id  = p_lead_id
    AND agent_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_lead_lock(UUID) TO authenticated;


-- -------------------------------------------------------
-- Refresh PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
