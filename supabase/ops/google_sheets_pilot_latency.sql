-- READ ONLY. psql -v samples='[{"phone":"7025550111","kind":"api","written":"UTC timestamp"}]'
-- Use completion timestamps, retain request-start timestamps separately as uncertainty bounds.
-- Google notifications contain no row id. Only an unambiguous eligible notification
-- in the importing attempt is attributed; catch-up/multiple candidates remain unmeasured.
BEGIN TRANSACTION READ ONLY;
WITH samples AS (
  SELECT * FROM jsonb_to_recordset(:'samples'::jsonb)
    AS x(phone text, kind text, written timestamptz)
), rows AS (
  SELECT x.*, l.id AS lead_id, r.created_at AS receipt_at,
    (SELECT count(*) FROM public.leads z
      WHERE z.organization_id='a0000000-0000-0000-0000-000000000001'
      AND right(regexp_replace(z.phone,'[^0-9]','','g'),10)=x.phone) AS lead_count,
    a.id AS attempt_id, a.started_at, a.first_commit_at, a.from_seq, a.snapshot_seq, a.target_id,
    (SELECT count(*) FROM public.google_sheets_sync_runs sr WHERE sr.source_id=r.source_id
      AND sr.started_at<=r.created_at AND sr.finished_at>=r.created_at AND sr.trigger='push') AS push_runs
  FROM samples x
  LEFT JOIN public.leads l ON l.organization_id='a0000000-0000-0000-0000-000000000001'
    AND right(regexp_replace(l.phone,'[^0-9]','','g'),10)=x.phone
  LEFT JOIN private.google_sheets_receipts r ON r.lead_id=l.id
    AND r.source_id='2a9ce6b6-0500-454d-8c46-48dfab8042b5'
  LEFT JOIN LATERAL (
    SELECT a.* FROM private.google_sheets_push_attempts a
    JOIN private.google_sheets_watch_targets t ON t.id=a.target_id
    JOIN public.google_sheets_sources s ON s.connection_id=t.connection_id AND s.spreadsheet_id=t.spreadsheet_id
    WHERE s.id=r.source_id AND a.started_at<=r.created_at AND a.finished_at>=r.created_at
    ORDER BY a.started_at DESC LIMIT 1
  ) a ON true
), measured AS (
  SELECT r.*, e.candidates, e.received_at, e.queued_at, e.catchups,
    lead_count=1 AND receipt_at IS NOT NULL AND push_runs=1 AND attempt_id IS NOT NULL
      AND e.candidates=1 AND e.catchups=0 AND e.received_at<=started_at
      AND started_at<=receipt_at AS attributable
  FROM rows r
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE authenticated AND outcome='queued' AND received_at>=r.written
                            AND received_at<=r.receipt_at) AS candidates,
      min(received_at) FILTER (WHERE authenticated AND outcome='queued' AND received_at>=r.written
                              AND received_at<=r.receipt_at) AS received_at,
      min(queued_at) FILTER (WHERE authenticated AND outcome='queued' AND received_at>=r.written
                            AND received_at<=r.receipt_at) AS queued_at,
      count(*) FILTER (WHERE outcome='catch_up') AS catchups
    FROM private.google_sheets_push_events e
    WHERE e.target_id=r.target_id AND e.job_seq>r.from_seq AND e.job_seq<=r.snapshot_seq
  ) e ON true
), metrics AS (
  SELECT kind, right(phone,4) AS phone_last4, written, lead_count, push_runs, candidates, catchups,
    attributable, attempt_id, receipt_at,
    CASE WHEN attributable THEN extract(epoch FROM received_at-written) END AS google_s,
    CASE WHEN attributable THEN extract(epoch FROM queued_at-received_at)*1000 END AS queue_ms,
    CASE WHEN attributable THEN extract(epoch FROM started_at-queued_at)*1000 END AS start_ms,
    -- Per-row receipt commit time, NOT the attempt's first commit (wrong for later rows in a burst).
    CASE WHEN attributable THEN extract(epoch FROM receipt_at-received_at)*1000 END AS ours_ms,
    extract(epoch FROM receipt_at-written) AS total_s
  FROM measured
)
SELECT jsonb_build_object(
  'rows',(SELECT jsonb_agg(to_jsonb(m) ORDER BY kind,phone_last4) FROM metrics m),
  'summary',(SELECT jsonb_agg(to_jsonb(s)) FROM (
    SELECT kind,count(*) AS rows_observed,count(*) FILTER (WHERE attributable) AS measured,
      count(*) FILTER (WHERE lead_count=1 AND push_runs=1) AS imported_by_push,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY google_s) AS google_p50_s,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY google_s) AS google_p95_s,max(google_s) AS google_max_s,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ours_ms) AS ours_p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY ours_ms) AS ours_p95_ms,max(ours_ms) AS ours_max_ms,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY total_s) AS total_p50_s,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY total_s) AS total_p95_s,max(total_s) AS total_max_s
    FROM metrics GROUP BY kind) s)) AS evidence;
COMMIT;
