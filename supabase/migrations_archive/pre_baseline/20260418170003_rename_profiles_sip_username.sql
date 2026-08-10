-- Migration 3 of 7: Rename sip_username to twilio_client_identity on profiles table.
-- Part of Twilio Migration Phase 1.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='sip_username') THEN
    ALTER TABLE public.profiles RENAME COLUMN sip_username TO twilio_client_identity;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
