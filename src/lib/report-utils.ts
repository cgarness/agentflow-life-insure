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

export function buildDNCDispositionSet(
  dispositions: Array<{ name: string; auto_add_to_dnc?: boolean | null }>
): Set<string> {
  const dnc = new Set<string>();
  for (const d of dispositions) {
    if (d.auto_add_to_dnc) dnc.add(d.name.toLowerCase());
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
