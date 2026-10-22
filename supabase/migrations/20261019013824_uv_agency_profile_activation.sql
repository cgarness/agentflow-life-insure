-- Chris approved live activation and one-minute scheduling on 2026-10-18.
-- No publication preferences are inserted: each agent chooses visibility in the app.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $activation$
BEGIN
  IF EXISTS (SELECT 1 FROM private.uv_profile_sources)
    OR EXISTS (SELECT 1 FROM private.uv_profile_sync)
    OR EXISTS (SELECT 1 FROM cron.job WHERE jobname='uv-profile-sync-every-minute') THEN
    RAISE EXCEPTION 'activation_inventory_changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations
    WHERE id='a0000000-0000-0000-0000-000000000001'
      AND name='Family First Life - Chris Garness' AND lower(status)='active')
    OR NOT EXISTS (SELECT 1 FROM private.uv_profile_exclusions
      WHERE organization_id='a0000000-0000-0000-0000-000000000001'
        AND profile_id='ecf2bb91-0350-4542-85ec-14d914311e99') THEN
    RAISE EXCEPTION 'agency_or_protection_changed';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
    WHERE name='uv_profile_worker_token' AND length(decrypted_secret)>=32
      AND encode(extensions.digest(decrypted_secret,'sha256'),'hex')=
        'e8b70eb976fd5520ecb8a6477afd2e544436682b8cd50643fbd0afaa34be2dbb')<>1 THEN
    RAISE EXCEPTION 'worker_token_changed';
  END IF;
  INSERT INTO private.uv_profile_sources(organization_id,agency_name,agency_slug,enabled)
  VALUES ('a0000000-0000-0000-0000-000000000001',
    'Family First Life - Chris Garness','ffl-chris-garness',true);
  PERFORM cron.schedule('uv-profile-sync-every-minute','* * * * *',$job$
    SELECT net.http_post(
      url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/uv-profile-sync-worker',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer ' || decrypted_secret),
      timeout_milliseconds := 55000
    ) AS request_id
    FROM vault.decrypted_secrets
    WHERE name='uv_profile_worker_token' AND length(decrypted_secret)>=32;
  $job$);
END
$activation$;
