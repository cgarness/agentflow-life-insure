-- =====================================================
-- MIGRATION: add_updated_at_to_calls
-- Description: Add the missing updated_at column to the calls table.
--   The telnyx-webhook edge function writes updated_at in multiple
--   handlers (call.initiated, call.hangup, call.machine.detection.ended).
--   Without this column, PostgREST rejects the entire payload as an
--   HTTP 400, which silently breaks ALL webhook call tracking:
--     - telnyx_call_id is never set
--     - call status is never updated past 'ringing'
--     - amd_result is never written
-- =====================================================

ALTER TABLE calls
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Also add hangup_details if it's missing (used by handleCallHangup)
ALTER TABLE calls
ADD COLUMN IF NOT EXISTS hangup_details TEXT;

-- Also add recording_url if missing (used by handleRecordingSaved)
ALTER TABLE calls
ADD COLUMN IF NOT EXISTS recording_url TEXT;

-- Also add campaign_lead_id if missing (used by saveCall in dialer-api.ts)
ALTER TABLE calls
ADD COLUMN IF NOT EXISTS campaign_lead_id UUID;
