-- =====================================================================================================
-- Google Sheets push release (Gate D) — PREFLIGHT. READ-ONLY; safe to run repeatedly (SQL Editor or connector).
-- Every *_ok column must be true before `apply-migration` is dispatched. Prints ids, states, counts and digests
-- only: no token, secret value, header or lead data. Expected values: release-package.md §2.
-- =====================================================================================================
BEGIN TRANSACTION READ ONLY;
WITH v AS (
  SELECT
    (SELECT max(version) FROM supabase_migrations.schema_migrations) AS head,
    (SELECT count(*) FROM supabase_migrations.schema_migrations) AS history_rows,
    to_regclass('private.google_sheets_watch_targets') IS NULL AS push_absent,
    (SELECT md5(string_agg(n.nspname || '.' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), E'\n'
                           ORDER BY p.oid::regprocedure::text))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private')) AS functions_digest,
    md5(pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure)) AS finish_md5,
    (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conrelid = 'public.google_sheets_sync_runs'::regclass AND c.conname = 'google_sheets_sync_runs_trigger_check') AS trigger_check,
    (SELECT count(*) FROM cron.job WHERE jobname LIKE 'google-sheets%' OR command LIKE '%google-sheets%') AS sheets_cron_jobs,
    (SELECT count(*) FROM vault.secrets WHERE name = 'google_sheets_push_maintenance_token') AS push_vault_token,
    (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND (state = 'idle in transaction' OR xact_start < clock_timestamp() - interval '30 seconds')) AS long_transactions,
    (SELECT concat_ws('|',
       (SELECT count(*) FROM public.google_sheets_connections), (SELECT count(*) FROM public.google_sheets_sources),
       (SELECT count(*) FROM private.google_sheets_receipts),
       (SELECT count(*) FROM public.leads l JOIN private.google_sheets_receipts r ON r.lead_id = l.id),
       (SELECT count(*) FROM private.google_sheets_source_rows), (SELECT count(*) FROM public.google_sheets_sync_runs),
       md5(concat_ws('#',
         (SELECT string_agg(id || ':' || status || ':' || auth_generation, ',' ORDER BY id) FROM public.google_sheets_connections),
         (SELECT string_agg(id || ':' || state || ':' || health || ':' || phase || ':' || config_version, ',' ORDER BY id) FROM public.google_sheets_sources),
         (SELECT string_agg(source_id || ':' || receipt_key || ':' || coalesce(lead_id::text, '-'), ',' ORDER BY source_id, receipt_key) FROM private.google_sheets_receipts),
         (SELECT string_agg(source_id || ':' || row_key || ':' || kind, ',' ORDER BY source_id, row_key) FROM private.google_sheets_source_rows),
         (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.google_sheets_sync_runs))))) AS data_fingerprint)
SELECT v.*,
  v.head = '20261024045812' AND v.history_rows = 346 AS history_ok,
  v.push_absent AS not_applied_ok,
  v.functions_digest = '6640fc303f4fd426e5d5d3615f211f6d' AS functions_preimage_ok,
  v.finish_md5 = 'f1cf66bea7de1d469e2ff03c57f1a414' AS finish_preimage_ok,
  v.trigger_check = 'CHECK ((trigger = ANY (ARRAY[''schedule''::text, ''manual''::text, ''activation''::text])))' AS trigger_check_ok,
  v.sheets_cron_jobs = 0 AND v.push_vault_token = 0 AS operations_off_ok,
  v.long_transactions = 0 AS quiet_ok
FROM v;
COMMIT;
