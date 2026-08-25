-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- M3 — inbound call flow fix, plan rev 6 (C6): durable Twilio source-recording cleanup key.
-- DEVELOPMENT-ONLY AUTHORING. Future-facing DDL only: one nullable column, no default, no backfill,
-- no top-level DML — existing rows remain byte-identical (catalog-only change in PostgreSQL 16).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Why: twilio-recording-status deletes the Twilio source recording ONLY after storage upload and a
-- verified exact-row metadata persist (R17). When that DELETE fails transiently, the recording is
-- safely stored but the provider copy survives. The handler now persists the source RecordingSid
-- ATOMICALLY with the verified metadata so a retried callback (the 5xx connection-override channel)
-- can identify the exact source to clean up — DELETE-only, no re-download/re-upload/metadata
-- rewrite — with exact-SID matching so a DIFFERENT recording for the same call is never deleted
-- ("first completed recording wins" preserves it).
--
-- NULL means: no Twilio-sourced recording was stored for this row via the R17 pipeline (legacy
-- rows, browser-recorded outbound rows, or rows that never had a recording). Rows with a stored
-- recording but NULL source SID never trigger provider deletion.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS recording_source_sid text;

COMMENT ON COLUMN public.calls.recording_source_sid IS
  'Twilio RecordingSid (RE + 32 hex) of the source recording persisted to recording_storage_path '
  'by twilio-recording-status (plan rev 6 C6). Written atomically with the verified metadata '
  'persist; used ONLY to retry provider-side source deletion after a transient DELETE failure '
  '(exact-SID match; 404 counts as cleanup success). NULL for rows without an R17-stored '
  'Twilio recording. Never backfilled.';
