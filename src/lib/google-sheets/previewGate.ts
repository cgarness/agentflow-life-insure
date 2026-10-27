import { letterOf } from "./headerState";
import { toPayloadV2, type NotImportable, type PreviewResult, type SourceDraftV2 } from "./schema";

/**
 * Mapping v2 preview gate. A save is allowed only on a SUCCESSFUL preview of exactly the current draft, with the
 * sheet's columns unchanged since that preview and everything that won't be imported acknowledged.
 */
export interface PreviewTarget { spreadsheetId: string; sheetId: number; spreadsheetName: string; sheetTitle: string }

/** The preview request for a draft: exactly what the server reads and builds with (name, existing rows and the
 * acknowledgement do not change it). */
export function previewRequest(draft: SourceDraftV2, pick: PreviewTarget) {
  const p = toPayloadV2(draft, pick);
  return { spreadsheet_id: p.spreadsheet_id, sheet_id: p.sheet_id, mapping: p.mapping, identity_mode: p.identity_mode,
    id_header: p.id_header, lead_source_default: p.lead_source_default };
}

/** The identity of a preview: two drafts share a key only if the server would read and build them identically. */
export const previewKey = (draft: SourceDraftV2, pick: PreviewTarget) => JSON.stringify(previewRequest(draft, pick));

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "error"; key: string; message: string; code: string | null }
  | { status: "ready"; key: string; data: PreviewResult };

/** Content no mapping can import needs the acknowledgement (the server sends a token only then). */
export const needsAcknowledgement = (n: NotImportable | undefined | null): boolean => !!n && n.signature !== null;

/** Errors that mean the mapping no longer fits the sheet: the fix is to review the columns, not to retry. */
export const isColumnsError = (code: string | null | undefined) =>
  !!code && (code === "unacknowledged_columns" || code === "custom_field_unavailable" || code.startsWith("header:"));

export type SaveBlocker = "loading" | "failed" | "stale" | "columns_changed" | "acknowledge";
export const SAVE_BLOCKER_TEXT: Record<SaveBlocker, string> = {
  loading: "Checking the sheet…",
  failed: "The preview didn't load. Retry it before saving.",
  stale: "The preview is out of date. Checking again…",
  columns_changed: "The sheet's columns changed. Review them before saving.",
  acknowledge: "Confirm what won't be imported.",
};

/** Why Save / Enable is off right now (empty: allowed). */
export function saveBlockers(draft: SourceDraftV2, key: string | null, preview: PreviewState): SaveBlocker[] {
  if (preview.status === "idle" || preview.status === "loading") return ["loading"];
  if (preview.status === "error") return ["failed"];
  if (preview.key !== key) return ["stale"];
  const out: SaveBlocker[] = [];
  if ((preview.data.unaccounted_headers ?? []).length > 0) out.push("columns_changed");
  if ((draft.ignored.length > 0 || needsAcknowledgement(preview.data.not_importable)) && !draft.acknowledged) out.push("acknowledge");
  return out;
}

/** The acknowledgement token to send with a save / activate / review (only when there is content to acknowledge). */
export function acknowledgementToken(preview: PreviewState): string | undefined {
  return preview.status === "ready" ? preview.data.not_importable?.signature ?? undefined : undefined;
}

const list = (xs: string[], max = 8) => `${xs.slice(0, max).join(", ")}${xs.length > max ? ` and ${xs.length - max} more` : ""}`;

/** What the sheet holds that no mapping can import, in plain words (labels and column letters; never cell values). */
export function notImportableLines(n: NotImportable | undefined): string[] {
  if (!n) return [];
  const lines: string[] = [];
  if (n.headerless.length) lines.push(`Data in columns without a header: ${list(n.headerless)}.`);
  if (n.repeated.length) lines.push(`Repeated headers (only unique headers can be imported): ${list(n.repeated)}.`);
  const past = [...n.beyond.headers, ...n.beyond.headerless.map((l) => `column ${l} (no header)`)];
  if (past.length) lines.push(`Past column GR, the 200-column limit: ${list(past)}.`);
  if (n.beyond.unchecked) {
    lines.push(`This tab is ${n.beyond.width} columns wide. Columns past ${letterOf(n.beyond.checked_through - 1)} weren't checked; nothing there is imported.`);
  }
  return lines;
}
