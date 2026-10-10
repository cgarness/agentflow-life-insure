-- =====================================================================================================
-- Onboarding email series — schedule the worker. NOT RUN. Activation checklist §11 step 7; needs
-- Chris's explicit approval, run as a NEW migration with these exact bytes.
--
-- Preconditions (each checked, fails closed):
--   * the foundation migration is applied;
--   * pg_cron, pg_net and Vault are installed;
--   * the Vault secret 'onboarding_email_worker_token' exists (>= 32 chars; Chris sets it, D10);
--   * the job does not already exist.
-- The job POSTs to the worker only while the program flag is enabled, so scheduling alone sends
-- nothing. The Edge flag ONBOARDING_EMAILS_SEND_ENABLED is a second, independent off switch.
-- =====================================================================================================
DO $schedule$
BEGIN
  IF to_regclass('public.onboarding_email_program') IS NULL THEN
    RAISE EXCEPTION 'onboarding email foundation is not applied';
  END IF;
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'pg_cron, pg_net and supabase_vault are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                  WHERE name = 'onboarding_email_worker_token' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Vault secret onboarding_email_worker_token (>= 32 chars) is required';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onboarding-email-worker-every-minute') THEN
    RAISE EXCEPTION 'onboarding-email-worker-every-minute already exists; review before replacing';
  END IF;

  PERFORM cron.schedule('onboarding-email-worker-every-minute', '* * * * *', $job$
    SELECT net.http_post(
      url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/onboarding-email-worker',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || decrypted_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
      FROM vault.decrypted_secrets
     WHERE name = 'onboarding_email_worker_token'
       AND length(decrypted_secret) >= 32
       AND EXISTS (SELECT 1 FROM public.onboarding_email_program WHERE id = 1 AND enabled);
  $job$);
END $schedule$;
