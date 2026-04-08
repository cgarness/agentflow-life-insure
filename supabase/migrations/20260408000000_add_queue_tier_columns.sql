-- Migration: Add callback_due_at and retry_eligible_at to campaign_leads
-- Purpose: Enable 4-tier smart sort (Callback Due → New → Retry Eligible → Pending)
-- These columns allow the queue to prioritize leads based on their lifecycle state.
--
-- INSTRUCTIONS FOR CHRIS:
-- 1. Open the Supabase Dashboard for the AgentFlow project
-- 2. Navigate to SQL Editor (left sidebar)
-- 3. Click "New query"
-- 4. Paste this entire SQL block into the editor
-- 5. Click "Run" (or press Cmd/Ctrl+Enter)
-- 6. Verify: both columns should appear on campaign_leads in the Table Editor
--
-- This is safe to run multiple times (IF NOT EXISTS guards).

ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS callback_due_at TIMESTAMPTZ NULL;

ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS retry_eligible_at TIMESTAMPTZ NULL;

-- Index for smart-sort queries: tier 1 (callback due) and tier 3 (retry eligible)
CREATE INDEX IF NOT EXISTS idx_campaign_leads_callback_due
  ON public.campaign_leads (campaign_id, callback_due_at)
  WHERE callback_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_leads_retry_eligible
  ON public.campaign_leads (campaign_id, retry_eligible_at)
  WHERE retry_eligible_at IS NOT NULL;
