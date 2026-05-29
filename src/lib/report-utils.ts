/**
 * Centralized reporting classification helpers.
 *
 * Phase 2 — eliminates all string-based "sold" / "connected" detection
 * in favour of data-driven lookups through the disposition → pipeline_stage
 * relationship established in Phase 1.
 */

// ─── Conversion (Sold) Helpers ──────────────────────────────────

/**
 * Pre-build a Set of **lowercased disposition names** whose linked
 * pipeline_stage has `convert_to_client = true`.
 *
 * Consumers pass this set to `isConvertedCall()` so every check is O(1)
 * without per-call DB round-trips (Phase 3 will move this server-side).
 */
export function buildConvertedDispositionSet(
  dispositions: Array<{ id: string; name: string; pipeline_stage_id?: string | null }>,
  pipelineStages: Array<{ id: string; convert_to_client: boolean }>,
): Set<string> {
  const stageMap = new Map(pipelineStages.map(s => [s.id, s.convert_to_client]));
  const converted = new Set<string>();
  for (const d of dispositions) {
    if (d.pipeline_stage_id && stageMap.get(d.pipeline_stage_id)) {
      converted.add(d.name.toLowerCase());
    }
  }
  return converted;
}

/**
 * Returns `true` when a call's disposition name belongs to the
 * pre-computed converted-disposition set.
 */
export function isConvertedCall(
  dispositionName: string | null,
  convertedSet: Set<string>,
): boolean {
  if (!dispositionName) return false;
  return convertedSet.has(dispositionName.toLowerCase());
}

/**
 * Object-level conversion check — useful in the Dialer and win-trigger
 * where we have the full disposition object (with `pipeline_stage_id`)
 * and the list of pipeline stages.
 */
export function isConvertedDisposition(
  disposition: { pipeline_stage_id?: string | null } | null | undefined,
  pipelineStages: Array<{ id: string; convert_to_client: boolean }>,
): boolean {
  if (!disposition?.pipeline_stage_id) return false;
  const stage = pipelineStages.find(s => s.id === disposition.pipeline_stage_id);
  return stage?.convert_to_client === true;
}

// ─── Contacted / Connected Helpers ──────────────────────────────

/** Minimum call duration (seconds) to classify a call as "contacted". */
export const CONTACTED_DURATION_THRESHOLD = 45;

/**
 * A call is "contacted / connected" when **either**:
 * - `duration > 45 seconds`, **or**
 * - the disposition is DNC (Do Not Call).
 */
export function isContactedCall(
  duration: number | null,
  dispositionName: string | null,
  dncSet?: Set<string>
): boolean {
  if ((duration ?? 0) > CONTACTED_DURATION_THRESHOLD) return true;
  if (dispositionName) {
    const lower = dispositionName.toLowerCase();
    if (dncSet?.has(lower)) return true;
    if (!dncSet && (lower === "dnc" || lower === "do not call")) return true; // Legacy fallback
  }
  return false;
}

/**
 * Contacted-disposition lookup for the `counts_as_contacted` model (Build 3A).
 *
 * Carries BOTH the disposition `id` set and a lowercased `name` set so callers
 * can match calls by the UUID FK first and fall back to the name string for
 * legacy rows where `calls.disposition_id` was never persisted.
 *
 * Contacted is never inferred from agency-specific disposition labels — only
 * from the per-disposition `counts_as_contacted` flag.
 */
export interface ContactedDispositionLookup {
  ids: Set<string>;
  names: Set<string>;
}

/**
 * The locked/system "No Answer" disposition is dialer-controlled and must ALWAYS
 * be treated as not contacted — even if bad data sets `counts_as_contacted = true`.
 * The established locked system identifier in this schema is the canonical name
 * "No Answer" (same identifier used by `DispositionsManager.isDispositionEditDisabled`);
 * there is no dedicated system-type column. This is the one allowed name check —
 * all OTHER contacted logic stays label-agnostic via `counts_as_contacted`.
 */
export function isSystemNoAnswerName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "no answer";
}

export function buildContactedDispositionLookup(
  dispositions: Array<{ id: string; name: string; countsAsContacted?: boolean | null }>,
): ContactedDispositionLookup {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const d of dispositions) {
    if (isSystemNoAnswerName(d.name)) continue; // system No Answer never contacted
    if (d.countsAsContacted) {
      ids.add(d.id);
      names.add(d.name.toLowerCase());
    }
  }
  return { ids, names };
}

/**
 * Row-level Contacted classification (Build 3A):
 *   duration > 45
 *   OR the call's disposition has `counts_as_contacted = true`.
 *
 * Disposition matching prefers `disposition_id` (the UUID FK, persisted on new
 * rows), and falls back to lowercased `disposition_name` for legacy rows where
 * `disposition_id` is null. `dncSet` is an optional extra legacy fallback so
 * pre-backfill DNC rows still credit as contacted.
 */
export function isContactedCallRow(
  row: {
    duration: number | null;
    disposition_id?: string | null;
    disposition_name?: string | null;
  },
  contactedSet: ContactedDispositionLookup,
  dncSet?: Set<string>,
): boolean {
  // Hard guard: the locked/system No Answer disposition is never contacted,
  // regardless of duration or a stray counts_as_contacted flag.
  if (isSystemNoAnswerName(row.disposition_name)) return false;
  if ((row.duration ?? 0) > CONTACTED_DURATION_THRESHOLD) return true;
  if (row.disposition_id && contactedSet.ids.has(row.disposition_id)) return true;
  if (row.disposition_name) {
    const lower = row.disposition_name.toLowerCase();
    if (contactedSet.names.has(lower)) return true;
    if (dncSet?.has(lower)) return true;
  }
  return false;
}

export function buildDNCDispositionSet(
  dispositions: Array<{ name: string; dnc_auto_add?: boolean | null }>
): Set<string> {
  const dnc = new Set<string>();
  for (const d of dispositions) {
    if (d.dnc_auto_add) dnc.add(d.name.toLowerCase());
  }
  return dnc;
}

export function buildCallbackDispositionSet(
  dispositions: Array<{ name: string; callback_scheduler?: boolean | null }>
): Set<string> {
  const callback = new Set<string>();
  for (const d of dispositions) {
    if (d.callback_scheduler) callback.add(d.name.toLowerCase());
  }
  return callback;
}

export function buildAppointmentDispositionSet(
  dispositions: Array<{ name: string; appointment_scheduler?: boolean | null }>
): Set<string> {
  const appointment = new Set<string>();
  for (const d of dispositions) {
    if (d.appointment_scheduler) appointment.add(d.name.toLowerCase());
  }
  return appointment;
}
