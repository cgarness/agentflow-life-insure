-- P1 Build 3A — Add `counts_as_contacted` to dispositions.
--
-- Agencies label dispositions differently, so "Contacted" must be configurable
-- per disposition rather than inferred from agency-specific names. Trusted
-- Contacted becomes: calls.duration > 45 OR disposition.counts_as_contacted = true.
--
-- This migration adds the column (default false) and backfills sensible
-- defaults from existing, reliably-detectable disposition flags. It does NOT
-- depend on disposition name strings at runtime.

ALTER TABLE public.dispositions
  ADD COLUMN IF NOT EXISTS counts_as_contacted boolean NOT NULL DEFAULT false;

-- Safe backfill: a disposition counts as a real human contact when any of these
-- already-configured signals is present.
--   * dnc_auto_add            — agent reached the person and they asked for DNC
--   * appointment_scheduler   — booked an appointment (live contact)
--   * callback_scheduler      — scheduled a callback (live contact)
--   * linked pipeline stage with convert_to_client = true — a sale/conversion
-- "No Answer / Busy / Failed / Bad Number / Voicemail / skip-only" outcomes keep
-- the default false unless they happen to carry one of the flags above. Agencies
-- can toggle any disposition (e.g. "Not Interested") on in Disposition Settings.
UPDATE public.dispositions d
SET counts_as_contacted = true
WHERE d.counts_as_contacted = false
  AND (
    d.dnc_auto_add = true
    OR d.appointment_scheduler = true
    OR d.callback_scheduler = true
    OR EXISTS (
      SELECT 1
      FROM public.pipeline_stages ps
      WHERE ps.id = d.pipeline_stage_id
        AND ps.convert_to_client = true
    )
  );

-- Hard rule: the locked/system "No Answer" disposition is dialer-controlled and
-- must always be NOT contacted. Force false defensively (the backfill above
-- would not set it true, but guard against any prior/bad data). "No Answer" is
-- the established locked system identifier (no dedicated system-type column).
UPDATE public.dispositions
SET counts_as_contacted = false
WHERE counts_as_contacted = true
  AND lower(btrim(name)) = 'no answer'
  AND is_locked = true;

NOTIFY pgrst, 'reload schema';
