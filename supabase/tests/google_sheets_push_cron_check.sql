-- =====================================================================================================
-- Google Sheets PUSH — fixtures for scripts/run_google_sheets_cron_check.sh §7–§10 (supabase/postgres image,
-- --network none). Applied after the push migration on top of the foundation fixtures: a SYNTHETIC maintenance
-- token in the real Vault. Push mode stays 'off' until the runner turns it on to make work due.
-- =====================================================================================================
\set ON_ERROR_STOP 1
SELECT vault.create_secret('ci-synthetic-google-sheets-push-maintenance-0123456789abcdef', 'google_sheets_push_maintenance_token',
  'synthetic test token');
