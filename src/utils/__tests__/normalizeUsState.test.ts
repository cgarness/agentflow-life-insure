import { describe, it, expect } from "vitest";
import { normalizeUsState } from "@/utils/stateUtils";

/**
 * Build 2b · Phase 2 — locks the canonical TS state normalizer. This MUST stay
 * byte-for-byte equivalent (for recognized inputs) to:
 *   • SQL  public.normalize_us_state(text)  (migration 20260608170000)
 *   • Deno normalizeUsState() in supabase/functions/import-contacts/index.ts
 * Divergence on a recognized state silently drops leads in Phase 3's filter.
 *
 * The `recognized` map below is also executed against the SQL function's logic
 * (read-only, same input set) during the Phase 2 verification to confirm the
 * three implementations agree.
 */

// input -> expected canonical 2-letter code (every state + DC, names & codes,
// mixed case, surrounding whitespace).
const RECOGNIZED: Record<string, string> = {
  "Alabama": "AL", "alaska": "AK", "ARIZONA": "AZ", "  Arkansas  ": "AR",
  "California": "CA", "colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
  "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
  "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
  "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
  "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
  "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
  "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC",
  // already-2-letter, various cases / whitespace
  "ca": "CA", "Ca": "CA", " ny ": "NY", "tX": "TX", "DC": "DC",
};

describe("normalizeUsState (canonical, mirrors SQL + Deno)", () => {
  for (const [input, expected] of Object.entries(RECOGNIZED)) {
    it(`maps ${JSON.stringify(input)} -> ${expected}`, () => {
      expect(normalizeUsState(input)).toBe(expected);
    });
  }

  it("leaves blanks untouched (null/undefined/empty/whitespace)", () => {
    expect(normalizeUsState(null)).toBeNull();
    expect(normalizeUsState(undefined)).toBeUndefined();
    expect(normalizeUsState("")).toBe("");
    expect(normalizeUsState("   ")).toBe("   ");
  });

  it("leaves unrecognized values untouched (territories, typos, non-US)", () => {
    // Canonical = 50 states + DC ONLY. Territories and junk are NOT invented.
    expect(normalizeUsState("Puerto Rico")).toBe("Puerto Rico");
    expect(normalizeUsState("PR")).toBe("PR");
    expect(normalizeUsState("Guam")).toBe("Guam");
    expect(normalizeUsState("XX")).toBe("XX");
    expect(normalizeUsState("Ontario")).toBe("Ontario");
    expect(normalizeUsState("Californiaa")).toBe("Californiaa");
  });

  it("is idempotent (normalizing a code returns the code)", () => {
    for (const code of Object.values(RECOGNIZED)) {
      expect(normalizeUsState(code)).toBe(code);
    }
  });
});
