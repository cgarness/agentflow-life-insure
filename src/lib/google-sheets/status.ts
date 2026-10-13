import type { ConnectionStatus, SheetSourceRow } from "./schema";

export type Tone = "default" | "success" | "warning" | "destructive" | "muted";

/** One visible status per source. Reconnect state comes from the shared connection. */
export function sourceStatus(s: SheetSourceRow, conn: ConnectionStatus["connection"]): { label: string; tone: Tone } {
  if (s.state === "draft") return { label: "Draft", tone: "muted" };
  if (s.state === "paused") return { label: "Paused", tone: "muted" };
  if (!conn || conn.status !== "connected") return { label: "Reconnect", tone: "warning" };
  if (s.health === "needs_review") return { label: "Needs review", tone: "warning" };
  if (s.health === "access_lost") return { label: "Access lost", tone: "destructive" };
  if (s.health === "error") return { label: "Error", tone: "destructive" };
  if (s.phase === "initial") return { label: "Importing", tone: "default" };
  if (s.lease_owner) return { label: "Checking", tone: "default" };
  return { label: "Active", tone: "success" };
}

/** Flagged rows are part of imported, never a separate total. */
export function resultSummary(r: SheetSourceRow["last_result"]): string {
  if (!r) return "No checks yet";
  const parts = [`${r.imported} imported${r.flagged ? ` (${r.flagged} flagged)` : ""}`];
  if (r.skipped) parts.push(`${r.skipped} skipped`);
  if (r.errors) parts.push(`${r.errors} ${r.errors === 1 ? "error" : "errors"}`);
  return parts.join(" · ");
}

export const REVIEW_REASONS: Record<string, string> = {
  rows_changed: "Rows above the last import changed or moved.",
  rows_removed: "Rows were removed.",
  header_changed: "A mapped column was renamed or removed.",
  id_column_missing: "The Lead ID column is missing.",
  custom_field_unavailable: "A mapped custom field is no longer available.",
  too_large: "The tab has more than 10,000 rows.",
  tab_missing: "The tab was deleted.",
  mapping_invalid: "The mapping needs to be updated.",
};

/** Structural reasons are resolved through the review dialog, not a plain mapping save. */
export const isStructuralReview = (reason: string | null) => reason === "rows_changed" || reason === "rows_removed";

export function isBusy(sources: SheetSourceRow[]): boolean {
  return sources.some((s) => s.state === "enabled" && (s.phase === "initial" || s.lease_owner !== null));
}
