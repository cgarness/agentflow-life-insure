-- Migration: Add scheduled_callback_at to campaign_leads
-- Purpose: Enables the enterprise waterfall queue to surface
-- due callbacks at the front of the queue without a JOIN to appointments.
--
-- The column is nullable — only set when a callback disposition is saved.
-- getCampaignLeads reads this column to prioritize due callbacks.

ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS scheduled_callback_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient "due callback" queries
CREATE INDEX IF NOT EXISTS idx_campaign_leads_scheduled_callback
  ON public.campaign_leads (campaign_id, scheduled_callback_at)
  WHERE scheduled_callback_at IS NOT NULL;
