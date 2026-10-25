-- =====================================================================================================
-- Google Sheets — READ-ONLY drain / quiescence check (release-package.md §5). Safe to run repeatedly.
-- Stopped means ALL of: admission closed (wrappers_executable = 0), no backend executing a Sheets wrapper,
-- no queued worker or push-maintenance request, and the markers unchanged across two reads at least two minutes apart.
-- Unexpired leases are informational only: a lease expiring is NOT proof that a process has terminated.
-- If any marker moves between the two reads, the shutdown is BLOCKED — investigate; do not report it stopped.
-- =====================================================================================================
SELECT
  now() AS checked_at,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname LIKE 'google\_sheets\_%' AND p.proname <> 'google_sheets_disconnect'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')) AS wrappers_executable,
  (SELECT count(*) FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'
      AND query ILIKE '%google\_sheets\_%') AS active_sheets_backends,
  (CASE WHEN to_regclass('net.http_request_queue') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT count(*) AS c FROM net.http_request_queue WHERE url LIKE ''%/functions/v1/google-sheets-sync-worker%''',
        false, true, '')))[1]::text::int END) AS queued_worker_requests,
  (CASE WHEN to_regnamespace('cron') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT count(*) AS c FROM cron.job WHERE jobname = ''google-sheets-sync-every-minute''', false, true, '')))[1]::text::int END) AS cron_jobs,
  (SELECT count(*) FROM private.google_sheets_receipts) AS receipts,
  (SELECT max(created_at) FROM private.google_sheets_receipts) AS last_receipt_at,
  (SELECT count(*) FROM public.leads l WHERE EXISTS (SELECT 1 FROM private.google_sheets_receipts r WHERE r.lead_id = l.id)) AS sheets_leads,
  (SELECT count(*) FROM public.google_sheets_sync_runs) AS sync_runs,
  (SELECT max(finished_at) FROM public.google_sheets_sync_runs) AS last_sync_run_at,
  (SELECT count(*) FROM private.google_sheets_source_rows) AS ledger_rows,
  (SELECT max(updated_at) FROM private.google_sheets_source_rows) AS ledger_updated_at,
  (SELECT md5(COALESCE(string_agg(id::text || ':' || state || ':' || health || ':' || COALESCE(review_reason, '') || ':' ||
                       config_version::text || ':' || updated_at::text, ',' ORDER BY id), '')) FROM public.google_sheets_sources) AS sources_digest,
  (SELECT md5(COALESCE(string_agg(id::text || ':' || status || ':' || auth_generation::text, ',' ORDER BY id), ''))
     FROM public.google_sheets_connections) AS connections_digest,
  (SELECT count(*) FROM public.google_sheets_sources WHERE lease_expires_at > now()) AS unexpired_leases_informational,
  -- Push sync (20261025120000). Columns 16-20 are markers; column 21 is informational. Absent objects read NULL.
  (CASE WHEN to_regclass('net.http_request_queue') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT count(*) AS c FROM net.http_request_queue WHERE url LIKE ''%/functions/v1/google-sheets-push-maintenance%''',
        false, true, '')))[1]::text::int END) AS queued_push_maintenance_requests,
  (CASE WHEN to_regnamespace('cron') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT count(*) AS c FROM cron.job WHERE jobname = ''google-sheets-push-maintenance-every-minute''', false, true, '')))[1]::text::int END) AS push_cron_jobs,
  (CASE WHEN to_regclass('private.google_sheets_watch_targets') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT md5(COALESCE(string_agg(id::text || '':'' || requested_seq || '':'' || processed_seq, '','' ORDER BY id), '''')) AS c FROM private.google_sheets_watch_targets',
        false, true, '')))[1]::text END) AS push_targets_digest,
  (CASE WHEN to_regclass('private.google_sheets_watch_channels') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT md5(COALESCE(string_agg(id::text || '':'' || state, '','' ORDER BY id), '''')) AS c FROM private.google_sheets_watch_channels',
        false, true, '')))[1]::text END) AS push_channels_digest,
  (CASE WHEN to_regclass('private.google_sheets_push_attempts') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT count(*) AS c FROM private.google_sheets_push_attempts', false, true, '')))[1]::text::int END) AS push_attempts,
  (CASE WHEN to_regclass('private.google_sheets_watch_targets') IS NULL THEN NULL ELSE
     (xpath('/row/c/text()', query_to_xml(
        'SELECT count(*) AS c FROM private.google_sheets_watch_targets WHERE lease_expires_at > now()', false, true, '')))[1]::text::int END) AS unexpired_push_leases_informational;
