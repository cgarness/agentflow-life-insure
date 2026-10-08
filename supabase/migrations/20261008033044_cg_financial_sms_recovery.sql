-- Approved SMS recovery. Credentials were provisioned separately in Edge secrets/Vault.
-- This migration does not enable sends or modify historical consent.
DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.sms_agency_policies
      WHERE sender_name='CG Financial' AND uv_project='jzdzeevjpootbeuniygx'
        AND enforced AND NOT send_enabled AND active_from IS NULL
        AND cardinality(selected_phone_ids)=5) <> 1 THEN
    RAISE EXCEPTION 'Expected paused CG Financial five-sender policy';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name IN ('sms_consent_worker_token','a2p_reconcile_secret')
        AND length(decrypted_secret)>=32) <> 2 THEN
    RAISE EXCEPTION 'SMS recovery credentials are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN
      ('sms-consent-recovery-every-minute','a2p-reconcile-every-minute')) THEN
    RAISE EXCEPTION 'SMS recovery schedule already exists; review before replacing';
  END IF;
END $guard$;

SELECT cron.schedule('sms-consent-recovery-every-minute','* * * * *',$job$
  SELECT net.http_post(
    url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/sms-consent-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||decrypted_secret),
    body := '{}'::jsonb, timeout_milliseconds := 100000
  ) FROM vault.decrypted_secrets WHERE name='sms_consent_worker_token' AND length(decrypted_secret)>=32;
$job$);
SELECT cron.schedule('a2p-reconcile-every-minute','* * * * *',$job$
  SELECT net.http_post(
    url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/a2p-reconcile',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||decrypted_secret),
    body := '{}'::jsonb, timeout_milliseconds := 100000
  ) FROM vault.decrypted_secrets WHERE name='a2p_reconcile_secret' AND length(decrypted_secret)>=32;
$job$);
