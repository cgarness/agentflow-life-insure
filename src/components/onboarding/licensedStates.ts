import { US_STATE_CODE_BY_NAME, US_STATE_NAME_BY_CODE, US_STATE_NAMES } from "@/constants/us-geo";

/**
 * Pure helpers behind `LicensedStatesMultiSelect`.
 *
 * Kept out of the component module so the selection/summary logic is testable
 * without a DOM (Radix popovers + cmdk are portal-based) and so exporting them
 * never trips `react-refresh/only-export-components`.
 *
 * The UI shape is unchanged from the original checkbox list: a `string[]` of
 * full US state names drawn from `US_STATE_NAMES`. But `profiles.licensed_states`
 * itself is NOT guaranteed to be that shape — the invitation flow
 * (InviteUserModal → invite-user → accept-invite) stores
 * `{ state: "CA", licenseNumber: "" }` objects, and legacy rows hold full-name
 * or abbreviation strings, mixed arrays, or malformed entries (see migration
 * `20260522212000_backfill_legacy_licenses.sql`). The adapter below is the ONE
 * boundary that turns that unknown JSON into the UI's `string[]` contract and
 * rebuilds a persistence payload without ever discarding a license number.
 * Never cast `profiles.licensed_states` to `string[]` directly.
 */

export const ALL_LICENSED_STATES: string[] = [...US_STATE_NAMES];

/** The invitation flow's stored entry shape. */
export type LicensedStateObjectEntry = { state: string; licenseNumber: string };

/** One raw `profiles.licensed_states` element as it may exist in production. */
export type LicensedStateProfileEntry =
  | string
  | { state?: unknown; licenseNumber?: unknown }
  | readonly unknown[];

type ParsedLicensedState = {
  /** Canonical full state name, or null when the entry names no known state. */
  fullName: string | null;
  /** The original element, re-emitted verbatim where preservation applies. */
  raw: LicensedStateProfileEntry;
  fromObject: boolean;
  /** Dedupe key when the entry carries a real license value, else null. */
  licenseKey: string | null;
};

/** Lowercased full names and USPS codes → canonical full name. */
const CANONICAL_STATE_LOOKUP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries([
    ...US_STATE_NAMES.map((name) => [name.toLowerCase(), name]),
    ...Object.entries(US_STATE_NAME_BY_CODE).map(([code, name]) => [code.toLowerCase(), name]),
  ]),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trimmed, case-insensitive match on a full name or 2-letter code → canonical full name, else null. */
export function normalizeLicensedStateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return CANONICAL_STATE_LOOKUP[trimmed.toLowerCase()] ?? null;
}

/** A stable comparison key for a real license value; null when there is none. */
function licenseKeyOf(entry: Record<string, unknown>): string | null {
  if (!("licenseNumber" in entry)) return null;
  const value = entry.licenseNumber;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : `s:${trimmed}`;
  }
  if (value == null) return null;
  // Non-string license values are malformed but still real data (e.g. a
  // numeric 12345) — they must count as license-bearing, never as empty.
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return "j:unserializable";
  }
}

/**
 * Classifies each element of the raw payload. Only entries that provably
 * carry no data are dropped (null, numbers, booleans, empty strings, empty
 * objects/arrays). Entries naming an unrecognized state, and objects/arrays
 * that fail to parse but still hold data (possibly a license number), are
 * kept with `fullName: null` so persistence preserves them verbatim.
 */
function parseLicensedStates(raw: unknown): ParsedLicensedState[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ParsedLicensedState[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      parsed.push({
        fullName: normalizeLicensedStateName(trimmed),
        raw: entry,
        fromObject: false,
        licenseKey: null,
      });
      continue;
    }
    if (isPlainObject(entry)) {
      const state = entry.state;
      const hasUsableState = typeof state === "string" && state.trim() !== "";
      if (!hasUsableState && Object.keys(entry).length === 0) continue;
      parsed.push({
        fullName: hasUsableState ? normalizeLicensedStateName(state) : null,
        raw: entry as LicensedStateProfileEntry,
        fromObject: true,
        licenseKey: licenseKeyOf(entry),
      });
      continue;
    }
    // No writer produces nested arrays, but this column has already held
    // unforeseen shapes — treat a non-empty one as opaque data, not garbage.
    if (Array.isArray(entry) && entry.length > 0) {
      parsed.push({ fullName: null, raw: entry, fromObject: false, licenseKey: null });
    }
  }
  return parsed;
}

function cloneEntry(raw: LicensedStateProfileEntry): LicensedStateProfileEntry {
  if (Array.isArray(raw)) return [...raw];
  if (isPlainObject(raw)) return { ...raw };
  return raw;
}

/**
 * unknown → the multi-select's `string[]` of canonical full names: deduplicated
 * (first occurrence wins), original order preserved, everything unusable dropped.
 */
export function licensedStatesToUiSelection(raw: unknown): string[] {
  const seen = new Set<string>();
  const selection: string[] = [];
  for (const entry of parseLicensedStates(raw)) {
    if (!entry.fullName || seen.has(entry.fullName)) continue;
    seen.add(entry.fullName);
    selection.push(entry.fullName);
  }
  return selection;
}

/**
 * True when the UI selection represents the same SET of states as the raw
 * payload — order-insensitive, so remove-then-re-add still counts as unchanged
 * and the stored payload (license numbers included) is left untouched.
 */
export function isLicensedStatesSelectionUnchanged(raw: unknown, selection: string[]): boolean {
  const baseline = new Set(licensedStatesToUiSelection(raw));
  const current = new Set(selection);
  if (baseline.size !== current.size) return false;
  for (const name of current) {
    if (!baseline.has(name)) return false;
  }
  return true;
}

/**
 * Rebuilds the persistence payload for a MODIFIED selection.
 *
 * - A still-selected state re-emits every original entry that carries a
 *   DISTINCT real license value (collapsing two different license numbers to
 *   one would silently destroy the other); with no license-bearing entry it
 *   re-emits one — object entries cloned verbatim (extra keys intact), string
 *   entries as the canonical full name.
 * - A newly selected state uses the invitation object shape when the source
 *   contained any object entry, otherwise the flow's legacy full-name string.
 * - Deselected states are omitted.
 * - Entries the UI never offered — unrecognized states (e.g. a DC license)
 *   and unparseable-but-data-carrying objects/arrays — are appended verbatim:
 *   the user could not have deselected them, and dropping them could destroy
 *   a real license number.
 */
export function rebuildLicensedStatesPayload(raw: unknown, selection: string[]): LicensedStateProfileEntry[] {
  const parsed = parseLicensedStates(raw);
  const sourceHasObjects = parsed.some((p) => p.fromObject);
  const payload: LicensedStateProfileEntry[] = [];
  const emitted = new Set<string>();

  for (const name of selection) {
    if (emitted.has(name)) continue;
    emitted.add(name);
    const candidates = parsed.filter((p) => p.fullName === name);
    if (candidates.length === 0) {
      payload.push(
        sourceHasObjects ? { state: US_STATE_CODE_BY_NAME[name] ?? name, licenseNumber: "" } : name,
      );
      continue;
    }
    const licensed = candidates.filter((c) => c.licenseKey !== null);
    if (licensed.length > 0) {
      const seenLicenses = new Set<string>();
      for (const c of licensed) {
        if (seenLicenses.has(c.licenseKey as string)) continue;
        seenLicenses.add(c.licenseKey as string);
        payload.push(cloneEntry(c.raw));
      }
    } else {
      const kept = candidates[0];
      payload.push(isPlainObject(kept.raw) ? { ...kept.raw } : name);
    }
  }

  for (const opaque of parsed) {
    if (opaque.fullName !== null) continue;
    payload.push(cloneEntry(opaque.raw));
  }

  return payload;
}

/** Add or remove one state, preserving the order of the remaining entries. */
export function toggleState(selected: string[], state: string): string[] {
  return selected.includes(state) ? selected.filter((s) => s !== state) : [...selected, state];
}

/** Case-insensitive match on the full state name. */
export function filterStates(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_LICENSED_STATES;
  return ALL_LICENSED_STATES.filter((s) => s.toLowerCase().includes(q));
}

/** Collapsed trigger summary. */
export function summarizeLicensedStates(selected: string[]): string {
  const count = selected.length;
  if (count === 0) return "No states selected";
  if (count >= ALL_LICENSED_STATES.length) return "All states selected";
  if (count === 1) return "1 state selected";
  return `${count} states selected`;
}

/** Chips shown under the trigger: at most `max`, with the overflow reported separately. */
export function visibleChips(selected: string[], max = 4): { chips: string[]; overflow: number } {
  return { chips: selected.slice(0, max), overflow: Math.max(0, selected.length - max) };
}
