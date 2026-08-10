-- Migration 1 of 7: Rename Telnyx-specific columns on calls table to Twilio/provider-agnostic names.
-- Part of Twilio Migration Phase 1.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calls' AND column_name='telnyx_call_control_id') THEN
    ALTER TABLE public.calls RENAME COLUMN telnyx_call_control_id TO twilio_call_sid;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calls' AND column_name='telnyx_call_id') THEN
    ALTER TABLE public.calls RENAME COLUMN telnyx_call_id TO provider_session_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='calls' AND column_name='telnyx_error_code') THEN
    ALTER TABLE public.calls RENAME COLUMN telnyx_error_code TO provider_error_code;
  END IF;
END $$;

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS recording_storage_path TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS recording_duration INTEGER;

NOTIFY pgrst, 'reload schema';
