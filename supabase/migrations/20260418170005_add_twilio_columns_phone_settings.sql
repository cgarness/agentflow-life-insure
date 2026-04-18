-- Migration 5 of 7: Add Trust Hub and SHAKEN/STIR columns to phone_settings table.
-- Part of Twilio Migration Phase 1.

ALTER TABLE public.phone_settings ADD COLUMN IF NOT EXISTS trust_hub_profile_sid TEXT;
ALTER TABLE public.phone_settings ADD COLUMN IF NOT EXISTS shaken_stir_enabled BOOLEAN DEFAULT true;

NOTIFY pgrst, 'reload schema';
