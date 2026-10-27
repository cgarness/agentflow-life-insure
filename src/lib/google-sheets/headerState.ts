import { normalizeFieldName } from "@/lib/import-field-matching";
import type { BeyondLimit, HeaderColumn, HeadersResult, MappingColumn } from "./schema";

/**
 * Mapping v2: the CURRENT sheet's columns reconciled with a draft and the saved mapping. Every column is listed with
 * what can be done with it; nothing is filtered out silently (blank, duplicate, missing and over-limit included).
 */
export type ColumnStatus = "ready" | "new" | "blank_data" | "blank" | "duplicate";
export interface ColumnState { key: string; letter: string; header: string; status: ColumnStatus; mappable: boolean }
export interface HeaderState {
  columns: ColumnState[];
  /** Saved mapped headers that are no longer in the sheet (the next sync would go to Needs review). */
  missing: MappingColumn[];
  /** Mapped headers that now appear more than once (refused by the server, never guessed). */
  duplicatedMapped: string[];
  /** The real width and what holds a header or data past A–GR (null: an older server that did not scan). */
  beyondLimit: BeyondLimit | null;
  /** Headers that are mapped, ignored or the Lead ID column. */
  mappableHeaders: string[];
}

export const letterOf = (i: number) => {
  let s = "", x = i + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
};

/** Columns from a v2 server, or derived from the plain header list (older servers: no data flags, no overflow read). */
export function headerColumns(h: Pick<HeadersResult, "header" | "columns">): HeaderColumn[] {
  if (Array.isArray(h.columns)) return h.columns;
  const counts = new Map<string, number>();
  h.header.forEach((x) => { if (x.trim()) counts.set(normalizeFieldName(x), (counts.get(normalizeFieldName(x)) ?? 0) + 1); });
  return h.header.map((x, i) => ({ index: i, letter: letterOf(i), header: x, blank: !x.trim(),
    duplicate: !!x.trim() && (counts.get(normalizeFieldName(x)) ?? 0) > 1, has_data: false }));
}

export function buildHeaderState(h: Pick<HeadersResult, "header" | "columns" | "beyond_limit">, saved: { columns: MappingColumn[]; ignored?: string[] } | null,
  draftColumns: MappingColumn[]): HeaderState {
  const cols = headerColumns(h);
  const known = new Set(saved ? [...saved.columns.map((c) => c.header), ...(saved.ignored ?? [])].map(normalizeFieldName) : []);
  const present = new Set(cols.filter((c) => !c.blank).map((c) => normalizeFieldName(c.header)));
  const dup = new Set(cols.filter((c) => c.duplicate).map((c) => normalizeFieldName(c.header)));
  const columns: ColumnState[] = cols.filter((c) => !(c.blank && !c.has_data)).map((c) => {
    const status: ColumnStatus = c.blank ? "blank_data" : c.duplicate ? "duplicate"
      : saved && !known.has(normalizeFieldName(c.header)) ? "new" : "ready";
    return { key: `${c.letter}:${c.header}`, letter: c.letter, header: c.header, status, mappable: !c.blank && !c.duplicate };
  });
  return {
    columns,
    missing: (saved?.columns ?? []).filter((m) => !present.has(normalizeFieldName(m.header))),
    duplicatedMapped: draftColumns.filter((m) => dup.has(normalizeFieldName(m.header))).map((m) => m.header),
    beyondLimit: h.beyond_limit ?? null,
    mappableHeaders: columns.filter((c) => c.mappable).map((c) => c.header),
  };
}

/** Draft fields the v2 mapping step edits. */
export interface MappingDraftV2 { idHeader: string | null; columns: MappingColumn[]; ignored: string[]; acknowledged: boolean }
export const IGNORE_TARGET = "__ignore__";

/**
 * Every mappable header that is neither mapped nor the Lead ID column is ignored — explicitly, listed and
 * acknowledged. Mappings for headers no longer in the sheet are kept (shown as missing) until the owner resolves
 * them. The acknowledgement survives only while the ignored set is unchanged.
 */
export function reconcileIgnored<T extends MappingDraftV2>(draft: T, mappableHeaders: readonly string[]): T {
  const taken = new Set([...draft.columns.map((c) => c.header), ...(draft.idHeader ? [draft.idHeader] : [])].map(normalizeFieldName));
  const ignored = mappableHeaders.filter((h) => !taken.has(normalizeFieldName(h)));
  const same = ignored.length === draft.ignored.length && ignored.every((h, i) => h === draft.ignored[i]);
  return { ...draft, ignored, acknowledged: same && draft.acknowledged };
}

/** Sets one column's field (or Don't import). A field used by another column moves here; that column becomes ignored. */
export function applyColumnChoice<T extends MappingDraftV2>(draft: T, header: string, target: string, mappableHeaders: readonly string[]): T {
  const rest = draft.columns.filter((c) => c.header !== header && (target === IGNORE_TARGET || c.target !== target));
  const columns = target === IGNORE_TARGET ? rest : [...rest, { header, target }];
  return reconcileIgnored({ ...draft, columns }, mappableHeaders);
}

/** Removes the mappings of headers that are no longer in the sheet (the owner resolved them). */
export function dropMissing<T extends MappingDraftV2>(draft: T, missing: readonly MappingColumn[], mappableHeaders: readonly string[]): T {
  const gone = new Set(missing.map((m) => m.header));
  return reconcileIgnored({ ...draft, columns: draft.columns.filter((c) => !gone.has(c.header)) }, mappableHeaders);
}
