export const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

export const STATE_NAME_TO_ABBR: Record<string, string> = {};
Object.entries(STATE_ABBR_TO_NAME).forEach(([abbr, name]) => {
  STATE_NAME_TO_ABBR[name.toLowerCase()] = abbr;
});

export function formatStateToAbbreviation(state: string | null | undefined): string {
  if (!state) return "";
  const trimmed = state.trim();
  if (!trimmed) return "";
  
  // If it's already a 2-letter uppercase abbreviation, return it
  if (trimmed.length === 2 && STATE_ABBR_TO_NAME[trimmed.toUpperCase()]) {
    return trimmed.toUpperCase();
  }
  
  // Try mapping from full name
  const fromName = STATE_NAME_TO_ABBR[trimmed.toLowerCase()];
  if (fromName) return fromName;
  
  // Try mapping from partial or mixed case abbreviation
  const fromAbbr = STATE_ABBR_TO_NAME[trimmed.toUpperCase()];
  if (fromAbbr) return trimmed.toUpperCase();
  
  return trimmed; // Return original if no match found
}

export function normalizeState(raw: string | null | undefined): string | null {
  const formatted = formatStateToAbbreviation(raw);
  return formatted || null;
}

/**
 * Canonical US-state normalizer (Build 2b). BYTE-FOR-BYTE mirror of the SQL
 * `public.normalize_us_state(text)` and the Deno copy in
 * `supabase/functions/import-contacts/index.ts`. This three-way identity is what
 * keeps Phase 3's licensed-state dialer filter from silently dropping leads.
 *
 *   • trim + case-insensitive recognition
 *   • a valid 2-letter USPS code → UPPERCASE
 *   • a full state name (50 states + DC) → its 2-letter code
 *   • blanks (null / undefined / empty / whitespace) and UNRECOGNIZED values
 *     (territories like PR/GU/VI, typos, non-US) → returned UNCHANGED ("don't invent")
 *
 * Reuses the same maps as normalizeState/formatStateToAbbreviation. Differs from
 * normalizeState() ONLY in blank/unrecognized representation (this one leaves the
 * input untouched, matching the SQL backfill's "leave blanks/unrecognized
 * untouched"); outcome-equivalent for the dialer filter, which btrim()+NULLIF()es.
 * Use this on every going-forward state WRITE path (contact create/edit, import).
 */
export function normalizeUsState(raw: string): string;
export function normalizeUsState(raw: null): null;
export function normalizeUsState(raw: undefined): undefined;
export function normalizeUsState(raw: string | null | undefined): string | null | undefined;
export function normalizeUsState(raw: string | null | undefined): string | null | undefined {
  if (raw === null || raw === undefined) return raw;
  const trimmed = raw.trim();
  if (trimmed === "") return raw; // blank untouched
  const upper = trimmed.toUpperCase();
  if (STATE_ABBR_TO_NAME[upper]) return upper; // valid 2-letter → uppercase
  const fromName = STATE_NAME_TO_ABBR[trimmed.toLowerCase()];
  if (fromName) return fromName; // full name → code
  return raw; // unrecognized untouched (don't invent)
}

export function getStateName(abbr: string): string {
  if (!abbr) return "";
  return STATE_ABBR_TO_NAME[abbr.toUpperCase()] || abbr;
}
