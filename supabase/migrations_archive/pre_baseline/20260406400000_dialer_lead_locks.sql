-- =============================================================
-- Migration: Atomic Queue Lock RPC — fetch_and_lock_next_lead
-- Date: 2026-04-06
-- Purpose: Add a 90-second TTL lock RPC for DialerPage campaign
--          type routing, plus a bulk lock release RPC for session
--          end / browser unload cleanup.
--
-- ⚠️  IMPORTANT — TWO LOCK RPCs NOW COEXIST:
--
--   1. get_next_queue_lead  (20260405100000_smart_queue_lock_system.sql)
--      - 5-minute TTL, JOINs leads table for lead_score/lead_source filters
--      - Used by: useLeadLock.ts hook (legacy path)
--
--   2. fetch_and_lock_next_lead  (THIS migration)
--      - 90-second TTL, NO JOIN to leads table (avoids deadlock risk)
--      - Filters only on campaign_leads columns (state, status, call_attempts)
--      - lead_score and lead_source filters are NOT supported here by design
--      - Used by: DialerPage.tsx via src/lib/dialer-queue.ts
--
--   DO NOT consolidate these into one function without understanding
--   the TTL and JOIN differences. The 90-second window matches the
--   lock timer arc shown in the dialer UI for Team/Open campaigns.
--
-- Functions Created:
--   public.fetch_and_lock_next_lead(p_campaign_id, p_filters)
--   public.release_all_agent_locks(p_campaign_id)
--
-- Indexes Added:
--   idx_dialer_lead_locks_campaign_expires (campaign_id, expires_at)
--
-- Depends On:
--   public.dialer_lead_locks       — 20260405100000
--   public.campaign_leads           — existing table
--   public.campaigns                — existing table
--   public.get_org_id()             — 20260331200000
-- =============================================================


-- -------------------------------------------------------
-- 1. Composite index for fast queue lookups
--    (campaign_id, expires_at) is the hot path in both
--    the expired-lock cleanup and the NOT EXISTS subquery.
-- -------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_dialer_lead_locks_campaign_expires
  ON public.dialer_lead_locks(campaign_id, expires_at);


-- -------------------------------------------------------
-- 2. RPC: fetch_and_lock_next_lead
-- -------------------------------------------------------
-- Atomically fetches the next Queued lead for a campaign
-- and inserts a 90-second lock. Filters operate ONLY on
-- campaign_leads columns — no JOIN to leads table.
--
-- Supported p_filters keys (all optional):
--   state        TEXT  → cl.state
--   max_attempts INT   → cl.call_attempts <= value
--
-- NOT supported (by design — see header comment):
--   lead_source  — lives on leads table, JOIN adds deadlock risk
--   min_score    — lives on leads table
--   max_score    — lives on leads table
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fetch_and_lock_next_lead(
  p_campaign_id UUID,
  p_filters     JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter_state      TEXT;
  v_filter_max_att    INTEGER;
  v_result            public.campaign_leads;
  v_locked_id         UUID;
BEGIN
  -- ── Step 1: Delete expired locks for this campaign ───────────────
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND expires_at < now();

  -- ── Step 2: Extract filter values (only apply if key present) ───
  v_filter_state   := p_filters->>'state';
  v_filter_max_att := (p_filters->>'max_attempts')::INTEGER;

  -- ── Step 3: Atomic fetch — SELECT FOR UPDATE SKIP LOCKED ────────
  SELECT cl.id INTO v_locked_id
  FROM public.campaign_leads cl
  WHERE cl.campaign_id = p_campaign_id
    AND cl.organization_id = public.get_org_id()
    AND cl.status = 'Queued'
    AND NOT EXISTS (
      SELECT 1 FROM public.dialer_lead_locks dll
      WHERE dll.lead_id = cl.id
    )
    -- Dynamic filter: state
    AND (v_filter_state IS NULL OR cl.state = v_filter_state)
    -- Dynamic filter: max call attempts
    AND (v_filter_max_att IS NULL OR cl.call_attempts <= v_filter_max_att)
  ORDER BY cl.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- ── Step 4: Queue empty → return nothing ────────────────────────
  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  -- ── Step 5: Insert 90-second lock ──────────────────────────────
  INSERT INTO public.dialer_lead_locks
    (lead_id, agent_id, campaign_id, organization_id, expires_at)
  VALUES
    (v_locked_id, auth.uid(), p_campaign_id, public.get_org_id(), now() + INTERVAL '90 seconds')
  ON CONFLICT DO NOTHING;

  -- ── Step 6: Return the full campaign_leads row ──────────────────
  SELECT * INTO v_result
  FROM public.campaign_leads
  WHERE id = v_locked_id;

  RETURN NEXT v_result;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_and_lock_next_lead(UUID, JSONB) TO authenticated;


-- -------------------------------------------------------
-- 3. RPC: release_all_agent_locks
-- -------------------------------------------------------
-- Deletes ALL active locks held by auth.uid() for a given
-- campaign. Called on:
--   - End Session button click
--   - Browser beforeunload event (via navigator.sendBeacon)
--   - Session cleanup
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_all_agent_locks(
  p_campaign_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND agent_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_all_agent_locks(UUID) TO authenticated;


-- -------------------------------------------------------
-- 4. Refresh PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
