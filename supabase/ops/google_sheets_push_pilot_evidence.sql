-- =====================================================================================================
-- Google Sheets push — READ-ONLY pilot evidence for Gate E/F. Parameters (psql -v):
--   phones   = comma-separated 10-digit phones of the pilot rows, e.g. -v phones='7025550111,7025550112'
--   written  = matching comma-separated UTC write times reported by the writer (ISO 8601), same order
--   org      = organization id (default: the home agency)
-- Per row: lead count (must be exactly 1), the run trigger that imported it (push vs manual), Google delivery
-- latency (write → notification received), our latency (received → queued → started → committed) and end to end.
-- Also proves Pilot B's original leads are byte-identical to the before-snapshot digest passed as -v before_md5.
-- Prints phones' last four digits only.
-- =====================================================================================================
\if :{?org} \else \set org a0000000-0000-0000-0000-000000000001 \endif
\if :{?before_md5} \else \set before_md5 none \endif
WITH input AS (
  SELECT p.phone, w.written::timestamptz AS written
    FROM unnest(string_to_array(:'phones', ',')) WITH ORDINALITY AS p(phone, i)
    JOIN unnest(string_to_array(:'written', ',')) WITH ORDINALITY AS w(written, j) ON i = j),
lead AS (
  SELECT i.phone, i.written, l.id AS lead_id, l.created_at,
         (SELECT count(*) FROM public.leads l2 WHERE l2.organization_id = :'org'
            AND regexp_replace(l2.phone, '[^0-9]', '', 'g') = i.phone) AS leads_with_phone
    FROM input i
    LEFT JOIN public.leads l ON l.organization_id = :'org' AND regexp_replace(l.phone, '[^0-9]', '', 'g') = i.phone),
rec AS (
  SELECT l.*, r.created_at AS receipt_at, r.source_id,
         (SELECT sr.trigger FROM public.google_sheets_sync_runs sr
           WHERE sr.source_id = r.source_id AND sr.started_at <= r.created_at AND sr.finished_at >= r.created_at
           ORDER BY sr.finished_at LIMIT 1) AS run_trigger
    FROM lead l LEFT JOIN private.google_sheets_receipts r ON r.lead_id = l.lead_id),
att AS (
  SELECT r.*, a.oldest_received_at, a.oldest_queued_at, a.started_at, a.first_commit_at
    FROM rec r
    LEFT JOIN LATERAL (SELECT a.* FROM private.google_sheets_push_attempts a
                        JOIN private.google_sheets_watch_targets x ON x.id = a.target_id
                        JOIN public.google_sheets_sources s ON s.id = r.source_id
                         AND s.connection_id = x.connection_id AND s.spreadsheet_id = x.spreadsheet_id
                       WHERE a.started_at <= r.receipt_at AND COALESCE(a.finished_at, now()) >= r.receipt_at
                       ORDER BY a.started_at DESC LIMIT 1) a ON true)
SELECT right(phone, 4) AS phone_last4, leads_with_phone, run_trigger,
       round(extract(epoch FROM oldest_received_at - written)::numeric, 1)      AS google_delivery_s,
       round(extract(epoch FROM oldest_queued_at - oldest_received_at)::numeric * 1000) AS receive_to_queue_ms,
       round(extract(epoch FROM started_at - oldest_queued_at)::numeric * 1000)        AS queue_to_start_ms,
       round(extract(epoch FROM COALESCE(first_commit_at, receipt_at) - oldest_received_at)::numeric * 1000) AS notification_to_commit_ms,
       round(extract(epoch FROM receipt_at - written)::numeric, 1)              AS end_to_end_s
  FROM att ORDER BY written;

SELECT 'pilot_b_original_leads' AS check,
       md5(string_agg(l::text, '|' ORDER BY l.id)) AS current_md5, :'before_md5' AS before_md5,
       md5(string_agg(l::text, '|' ORDER BY l.id)) = :'before_md5' AS unchanged
  FROM public.leads l
 WHERE l.id IN (SELECT r.lead_id FROM private.google_sheets_receipts r
                 WHERE r.source_id = '2a9ce6b6-0500-454d-8c46-48dfab8042b5' AND r.created_at < '2026-10-25');
