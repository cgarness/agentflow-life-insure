-- Welcome email delivery v2 (Option B) — retires the dead GUC-based pg_net
-- trigger path. The old trigger (on_profile_created_welcome_email ->
-- handle_new_user_welcome_email) read app.settings.supabase_url and
-- app.settings.service_role_key, which were never set in prod, so the trigger
-- has silently skipped every welcome email; storing a service-role key in a
-- DB setting is also forbidden. New delivery: the authenticated user triggers
-- the send-welcome-email Edge Function post-confirmation; idempotency via
-- profiles.welcome_email_sent_at.

DROP TRIGGER IF EXISTS on_profile_created_welcome_email ON public.profiles;

DROP FUNCTION IF EXISTS public.handle_new_user_welcome_email();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

COMMENT ON COLUMN public.profiles.welcome_email_sent_at IS
  'Set when the one-time welcome email was sent (send-welcome-email Edge Function; NULL = not yet sent).';

-- CRITICAL BACKFILL — must run in the same migration as the ADD COLUMN.
-- The welcome email fires for any confirmed user whose welcome_email_sent_at
-- is NULL. Without this backfill, every pre-existing user in the system would
-- be mailed "Welcome to AgentFlow" the next time they loaded the app — an
-- irreversible mass send from the shared team@fflagent.com sender. Marking
-- every EXISTING profile as already-welcomed means only accounts created
-- after this migration can ever receive the email.
UPDATE public.profiles
SET welcome_email_sent_at = now()
WHERE welcome_email_sent_at IS NULL;

-- Rollback:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS welcome_email_sent_at;
--   Then recreate the trigger + function from
--   supabase/migrations/20260331195900_welcome_email_trigger.sql
--   (handle_new_user_welcome_email + on_profile_created_welcome_email).
