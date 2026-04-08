-- Schedules the Google inbound sync edge function to run every 5 minutes.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'google-calendar-inbound-sync-every-5m') then
    perform cron.unschedule('google-calendar-inbound-sync-every-5m');
  end if;

  perform cron.schedule(
    'google-calendar-inbound-sync-every-5m',
    '*/5 * * * *',
    $$
    select
      net.http_post(
        url := 'https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/google-calendar-inbound-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', coalesce(current_setting('app.settings.google_sync_cron_secret', true), '')
        ),
        body := '{}'::jsonb
      );
    $$
  );
end
$$;
