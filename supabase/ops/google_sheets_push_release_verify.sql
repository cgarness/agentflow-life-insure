-- =====================================================================================================
-- Google Sheets push release (Gate D) — POST-STAGE VERIFICATION. READ-ONLY; run after apply-migration,
-- record-history, deploy-functions and configure-secrets (SQL Editor or connector). Expected values:
-- release-package.md §6. Real-time sync must read OFF in every row: mode 'off', no target, channel, event or
-- attempt, no Sheets cron job. Prints ids, states, counts and digests only: no token, secret value or lead data.
-- =====================================================================================================
BEGIN TRANSACTION READ ONLY;
WITH v AS (
  SELECT
    (SELECT max(version) FROM supabase_migrations.schema_migrations) AS head,
    (SELECT count(*) FROM supabase_migrations.schema_migrations) AS history_rows,
    (SELECT name || '|' || cardinality(statements) || '|' || encode(sha256(convert_to(array_to_string(statements, E'\n;\n'), 'UTF8')), 'hex')
       FROM supabase_migrations.schema_migrations WHERE version = '20261025120000') AS history_row,
    (SELECT string_agg(n.nspname || ':' || x.c, ',' ORDER BY n.nspname)
       FROM (SELECT pronamespace, count(*)::text c FROM pg_proc WHERE proname LIKE 'google\_sheets\_%' GROUP BY pronamespace) x
       JOIN pg_namespace n ON n.oid = x.pronamespace) AS functions,
    (SELECT md5(string_agg(n.nspname || '.' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), E'\n'
                           ORDER BY p.oid::regprocedure::text))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private')) AS functions_digest,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR (n.nspname = 'private' AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
             OR (n.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')))) AS acl_violations,
    (SELECT md5(string_agg(concat_ws('|', n.nspname || '.' || c.relname, r.rolname,
        coalesce((SELECT string_agg(p.priv, ',' ORDER BY p.priv) FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
                   WHERE has_table_privilege(r.rolname, c.oid, p.priv)), '-')), E'\n' ORDER BY n.nspname, c.relname, r.rolname) || E'\n')
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(rolname)
      WHERE c.relkind = 'r' AND c.relname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private')) AS table_acl_md5,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND c.relname LIKE 'google\_sheets\_%' AND n.nspname IN ('public','private') AND c.relrowsecurity) AS rls_tables,
    (SELECT count(*) FROM pg_policies WHERE tablename LIKE 'google\_sheets\_%') AS policies,
    md5(pg_get_functiondef('private.google_sheets_finish(uuid,uuid,integer,bigint,text,jsonb)'::regprocedure)) AS finish_md5,
    (SELECT concat_ws('|', mode, max_concurrent_jobs, renew_before_s, renew_overlap_s, late_grace_s) FROM private.google_sheets_push_config) AS push_config,
    (SELECT concat_ws('|', (SELECT count(*) FROM private.google_sheets_push_pilot_sources), (SELECT count(*) FROM private.google_sheets_watch_targets),
       (SELECT count(*) FROM private.google_sheets_watch_channels), (SELECT count(*) FROM private.google_sheets_push_events),
       (SELECT count(*) FROM private.google_sheets_push_attempts))) AS push_rows,
    (SELECT count(*) FROM cron.job WHERE jobname LIKE 'google-sheets%' OR command LIKE '%google-sheets%') AS sheets_cron_jobs,
    (SELECT count(*) FROM vault.secrets WHERE name = 'google_sheets_push_maintenance_token') AS push_vault_token,
    (SELECT count(*) FROM net.http_request_queue) AS pg_net_queue,
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
  v.functions = 'private:44,public:31' AND v.functions_digest = '6e8c43651043ce83254dcec092505cd6' AS functions_postimage_ok,
  v.finish_md5 = 'e684c572b950e35487b0e4eb33ac0830' AS finish_postimage_ok,
  v.acl_violations = 0 AND v.table_acl_md5 = 'e4a0ad1431818dd40a2fb32489ddcfa2' AND v.rls_tables = 12 AND v.policies = 3 AS security_ok,
  v.push_config = 'off|4|10800|900|3600' AND v.push_rows = '0|0|0|0|0' AND v.sheets_cron_jobs = 0 AS realtime_off_ok,
  (v.head = '20261024045812' AND v.history_rows = 346 AND v.history_row IS NULL)
    OR (v.head = '20261025120000' AND v.history_rows = 347
        AND v.history_row = 'google_sheets_push_sync|57|0561e767049e118b1cf53d9e51e2ec69a8eab5069bee82592e724535db5b79ff') AS history_ok
FROM v;
COMMIT;
