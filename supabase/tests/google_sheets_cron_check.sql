-- =====================================================================================================
-- Google Sheets — fixtures for scripts/run_google_sheets_cron_check.sh (supabase/postgres image, --network none).
-- Synthetic only: one org, one agent, a connection stored in the REAL Vault, one enabled source that is due, and
-- a SYNTHETIC worker token. The pending schedule migration is then applied byte-for-byte by the runner.
-- =====================================================================================================
\set ON_ERROR_STOP 1
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
INSERT INTO public.organizations (id, name) VALUES ('a0000000-0000-0000-0000-0000000000c1', 'Cron Check Org');
INSERT INTO public.profiles (id, organization_id, role) VALUES ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c1', 'Agent');
DO $$
DECLARE u uuid := 'c1000000-0000-0000-0000-000000000001'; o uuid := 'a0000000-0000-0000-0000-0000000000c1';
        g bigint; s record; a record;
BEGIN
  SELECT r.auth_generation INTO g FROM public.google_sheets_store_connection(u, o, 0, 'sub-cron', 'cron@example.test', '{}',
    'synthetic-refresh-token-not-real') r;
  SELECT * INTO s FROM public.google_sheets_save_source(u, o, NULL, NULL, jsonb_build_object('spreadsheet_id','SPREADSHEET_CRONCHECK',
    'sheet_id', 0, 'display_name', 'cron check', 'mapping', '{}'::jsonb));
  SELECT * INTO a FROM public.google_sheets_activate(u, o, s.source_id, s.config_version, g, '[]', 0);
  IF a.outcome <> 'activated' OR NOT EXISTS (SELECT 1 FROM public.google_sheets_sources WHERE id = s.source_id AND next_sync_at <= now()) THEN
    RAISE EXCEPTION 'cron fixture: source not due';
  END IF;
  IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_sheets_refresh_' ||
        (SELECT id FROM public.google_sheets_connections WHERE user_id = u)) <> 'synthetic-refresh-token-not-real' THEN
    RAISE EXCEPTION 'cron fixture: real Vault round trip failed';
  END IF;
END $$;
-- Synthetic worker token (never a real secret). The job's URL is unreachable from this container (--network none).
SELECT vault.create_secret('ci-synthetic-google-sheets-worker-token-0123456789abcdef', 'google_sheets_worker_token', 'synthetic test token');
