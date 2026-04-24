-- Ensure profiles.onboarding_complete exists (wizard finish + RLS-aware clients).
-- Idempotent: safe if an older migration already added the column but prod diverged.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.onboarding_complete IS 'True after first-run / app onboarding wizard is completed.';

NOTIFY pgrst, 'reload schema';
