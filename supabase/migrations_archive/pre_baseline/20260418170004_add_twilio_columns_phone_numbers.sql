-- Migration 4 of 7: Add Twilio-specific columns to phone_numbers table.
-- Part of Twilio Migration Phase 1.

ALTER TABLE public.phone_numbers ADD COLUMN IF NOT EXISTS twilio_sid TEXT;
ALTER TABLE public.phone_numbers ADD COLUMN IF NOT EXISTS trust_hub_status TEXT DEFAULT 'pending';
ALTER TABLE public.phone_numbers ADD COLUMN IF NOT EXISTS shaken_stir_attestation TEXT;

NOTIFY pgrst, 'reload schema';
