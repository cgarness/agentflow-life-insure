-- Migration 2 of 7: Rename telnyx_message_id to provider_message_id on messages table.
-- Part of Twilio Migration Phase 1.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='telnyx_message_id') THEN
    ALTER TABLE public.messages RENAME COLUMN telnyx_message_id TO provider_message_id;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
