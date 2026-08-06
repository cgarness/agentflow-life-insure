/**
 * Dialer queue-preview field vocabulary.
 *
 * The Personal queue card can surface two at-a-glance lead attributes. The raw
 * lead score is NOT one of them — `leads.lead_score` is internal queue metadata
 * (see `HIDDEN_CONTACT_FIELD_IDS` in `contactFieldLayout.ts`), so "Score" was
 * removed as an individual preview option.
 *
 * Agents may still hold a persisted `agentflow_queue_preview` localStorage value
 * naming the removed option, so the stored preference is normalized on read.
 *
 * Score-based queue FILTERING (Min/Max Score) and SORTING ("Highest Score") are
 * a separate, preserved concern and live in `DialerPage` / `QueuePanel*`.
 */

export type QueuePreviewField =
  | "age"
  | "state"
  | "source"
  | "attempts"
  | "status"
  | "best_time";

export const QUEUE_PREVIEW_FIELDS: readonly QueuePreviewField[] = [
  "age",
  "state",
  "source",
  "attempts",
  "status",
  "best_time",
];

export const DEFAULT_QUEUE_PREVIEW_FIELDS: readonly [QueuePreviewField, QueuePreviewField] = [
  "state",
  "attempts",
];

export const QUEUE_PREVIEW_FIELD_LABELS: Record<QueuePreviewField, string> = {
  age: "Age",
  state: "State",
  source: "Source",
  attempts: "Attempts",
  status: "Status",
  best_time: "Best Time",
};

function isQueuePreviewField(value: unknown): value is QueuePreviewField {
  return (
    typeof value === "string" && (QUEUE_PREVIEW_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Normalizes a persisted queue-preview preference into a renderable pair.
 *
 * Validation is PER SLOT: a slot holding a removed option ("score"), an unknown
 * string, a non-string, or nothing at all falls back to that slot's default, so
 * an agent's other valid choice is preserved (`["score","status"]` →
 * `["state","status"]`). Anything that is not an array returns the default pair.
 */
export function normalizeQueuePreviewFields(
  raw: unknown
): [QueuePreviewField, QueuePreviewField] {
  const entries = Array.isArray(raw) ? raw : [];
  const pick = (index: 0 | 1): QueuePreviewField => {
    const candidate = entries[index];
    return isQueuePreviewField(candidate) ? candidate : DEFAULT_QUEUE_PREVIEW_FIELDS[index];
  };
  return [pick(0), pick(1)];
}
