-- =============================================================
-- Migration: Hard Claim Engine
-- Date: 2026-04-06
-- Purpose: Permanent lead ownership transfer when an agent
--          completes a meaningful call (≥30s) on a Team or
--          Open Pool campaign.  Also adds queue_filters JSONB
--          to campaigns so managers can persist dialer filters
--          that apply to all agents in the campaign.
--
-- Functions Created:
--   public.claim_lead(p_campaign_lead_id, p_lead_id, p_campaign_id)
--
-- Columns Added:
--   campaigns.queue_filters  JSONB  DEFAULT '{}'
--
-- Depends On:
--   public.get_org_id()      — 20260331200000_jwt_custom_claims.sql
--   public.leads             — master lead records
--   public.campaign_leads    — dialer queue entity
--   public.campaigns         — campaign records
--
-- Schema Note:
--   Ownership is written to leads.assigned_agent_id ONLY.
--   campaign_leads.assigned_agent_id is read-only from the
--   dialer's perspective (used for Personal queue scoping).
--   Do NOT write assigned_agent_id on campaign_leads.
-- =============================================================


-- -------------------------------------------------------
-- PART 1 — ADD queue_filters TO campaigns
-- -------------------------------------------------------
-- Managers save dialer queue filters per campaign so that
-- all agents in the campaign share the same filter set.
-- Agents cannot see or override these filters.
-- -------------------------------------------------------

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS queue_filters JSONB DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.campaigns.queue_filters IS
  'Manager-set queue filters applied to all agents in this campaign. '
  'Keys: status, state, lead_source, max_attempts, min_score, max_score.';


-- -------------------------------------------------------
-- PART 2 — FUNCTION: claim_lead
-- -------------------------------------------------------
-- Permanently assigns a lead to the claiming agent by
-- updating leads.assigned_agent_id.
--
-- Called by useHardClaim.claimOnDisposition() after:
--   (a) The 30-second ClaimRing completes while connected, OR
--   (b) The agent saves a disposition on a meaningful call
--
-- RLS note: SECURITY DEFINER required so this function can
-- update any lead in the org's pool regardless of current
-- assigned_agent_id value (otherwise AGENT-level RLS would
-- block writes to leads owned by other agents).
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_lead(
  p_campaign_lead_id  UUID,
  p_lead_id           UUID,
  p_campaign_id       UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Resolve caller's org from JWT claim
  v_org_id := public.get_org_id();

  -- Guard: campaign must belong to caller's org
  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = p_campaign_id
      AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'claim_lead: campaign not found or org mismatch';
  END IF;

  -- Guard: campaign_lead must belong to caller's org
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_leads
    WHERE id = p_campaign_lead_id
      AND campaign_id = p_campaign_id
      AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'claim_lead: campaign_lead not found or org mismatch';
  END IF;

  -- Transfer ownership: write ONLY to leads.assigned_agent_id
  -- (never write assigned_agent_id on campaign_leads)
  UPDATE public.leads
  SET
    assigned_agent_id = auth.uid(),
    updated_at        = now()
  WHERE id              = p_lead_id
    AND organization_id = v_org_id;

  -- Non-fatal: if the lead row wasn't found, silently no-op.
  -- The lock will still release and the call will save normally.
END;
$$;

-- Grant to authenticated users only
GRANT EXECUTE ON FUNCTION public.claim_lead(UUID, UUID, UUID) TO authenticated;


-- -------------------------------------------------------
-- Refresh PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
