-- =====================================================================================================
-- Google Sheets push — READ-ONLY telemetry (latency percentiles, outcomes, channel health). Safe to run repeatedly.
-- Window: the last :hours hours (psql -v hours=24; default 24). Counts and timings only — no personal data.
--   notification → commit  = attempts.first_commit_at − attempts.oldest_received_at (notification-triggered only)
--   queue delay            = attempts.started_at − attempts.oldest_queued_at
--   run duration           = attempts.finished_at − attempts.started_at
-- Row-write → notification and end-to-end latency need the writer's timestamps: google_sheets_push_pilot_evidence.sql.
-- =====================================================================================================
\if :{?hours} \else \set hours 24 \endif
WITH w AS (SELECT now() - make_interval(hours => :hours) AS since),
att AS (
  SELECT a.*, EXISTS (SELECT 1 FROM private.google_sheets_push_events e
                       WHERE e.target_id = a.target_id AND e.job_seq > a.from_seq AND e.job_seq <= a.snapshot_seq
                         AND e.outcome = 'queued') AS notified
    FROM private.google_sheets_push_attempts a, w WHERE a.started_at >= w.since)
SELECT 'latency_ms' AS section, jsonb_build_object(
    'notification_to_commit', (SELECT jsonb_build_object('n', count(*),
        'p50', percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms), 'p95', percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),
        'p99', percentile_cont(0.99) WITHIN GROUP (ORDER BY ms), 'max', max(ms))
        FROM (SELECT extract(epoch FROM first_commit_at - oldest_received_at) * 1000 AS ms FROM att
               WHERE notified AND first_commit_at IS NOT NULL AND oldest_received_at IS NOT NULL) q),
    'queue_delay', (SELECT jsonb_build_object('n', count(*),
        'p50', percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms), 'p95', percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),
        'p99', percentile_cont(0.99) WITHIN GROUP (ORDER BY ms), 'max', max(ms))
        FROM (SELECT extract(epoch FROM started_at - oldest_queued_at) * 1000 AS ms FROM att WHERE oldest_queued_at IS NOT NULL) q),
    'run_duration', (SELECT jsonb_build_object('n', count(*),
        'p50', percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms), 'p95', percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),
        'p99', percentile_cont(0.99) WITHIN GROUP (ORDER BY ms), 'max', max(ms))
        FROM (SELECT extract(epoch FROM finished_at - started_at) * 1000 AS ms FROM att WHERE finished_at IS NOT NULL) q)) AS value
UNION ALL
SELECT 'notifications', (SELECT COALESCE(jsonb_object_agg(outcome, n), '{}'::jsonb) FROM (
    SELECT e.outcome, count(*) AS n FROM private.google_sheets_push_events e, w WHERE e.queued_at >= w.since GROUP BY 1) q)
UNION ALL
SELECT 'attempts', (SELECT jsonb_build_object('total', count(*),
    'by_outcome', (SELECT COALESCE(jsonb_object_agg(o, n), '{}'::jsonb) FROM (SELECT COALESCE(outcome, 'running') AS o, count(*) AS n FROM att GROUP BY 1) q),
    'retries', count(*) FILTER (WHERE outcome = 'retry'),
    'leads_imported', COALESCE(sum(imported), 0), 'flagged', COALESCE(sum(flagged), 0),
    'duplicates_prevented', COALESCE(sum(skipped_duplicate) + sum(already_receipted), 0),
    'failed_rows', COALESCE(sum(errors), 0), 'google_requests', COALESCE(sum(google_requests), 0),
    'google_requests_per_1000_leads', CASE WHEN COALESCE(sum(imported), 0) > 0
                                           THEN round(1000.0 * sum(google_requests) / sum(imported), 1) END,
    'attempts_per_1000_leads', CASE WHEN COALESCE(sum(imported), 0) > 0 THEN round(1000.0 * count(*) / sum(imported), 1) END)
    FROM att)
UNION ALL
SELECT 'channels', (SELECT jsonb_build_object(
    'by_state', (SELECT COALESCE(jsonb_object_agg(state, n), '{}'::jsonb) FROM (
                  SELECT state, count(*) AS n FROM private.google_sheets_watch_channels GROUP BY 1) q),
    'active_expiring_within_3h', (SELECT count(*) FROM private.google_sheets_watch_channels
                                   WHERE state = 'active' AND expires_at < now() + interval '3 hours'),
    'renewal_failures', (SELECT count(*) FROM private.google_sheets_watch_channels w, w AS ww
                          WHERE w.state = 'failed' AND w.reason = 'renew' AND w.updated_at >= ww.since),
    'registration_failures', (SELECT count(*) FROM private.google_sheets_watch_channels w, w AS ww
                               WHERE w.state = 'failed' AND w.updated_at >= ww.since),
    'targets_pending', (SELECT count(*) FROM private.google_sheets_watch_targets WHERE requested_seq > processed_seq)));
