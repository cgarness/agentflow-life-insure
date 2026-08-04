/**
 * Licensed-states adapter — the ONE boundary between the unknown JSON shapes
 * `profiles.licensed_states` holds in production (invitation objects,
 * full-name strings, abbreviation strings, mixed/malformed arrays) and the
 * onboarding UI's `string[]` contract, plus the rebuild rules that keep
 * completion from ever discarding a license number.
 */
import { describe, it, expect } from "vitest";
import {
  isLicensedStatesSelectionUnchanged,
  licensedStatesToUiSelection,
  normalizeLicensedStateName,
  rebuildLicensedStatesPayload,
} from "@/components/onboarding/licensedStates";
import {
  US_STATE_CODES,
  US_STATE_CODE_BY_NAME,
  US_STATE_NAME_BY_CODE,
  US_STATE_NAMES,
} from "@/constants/us-geo";

describe("us-geo state code mapping", () => {
  it("pairs all fifty codes with all fifty names, round-trip consistent", () => {
    expect(US_STATE_CODES).toHaveLength(50);
    expect(Object.keys(US_STATE_NAME_BY_CODE)).toHaveLength(50);
    expect(Object.keys(US_STATE_CODE_BY_NAME)).toHaveLength(50);
    for (const code of US_STATE_CODES) {
      const name = US_STATE_NAME_BY_CODE[code];
      expect(US_STATE_NAMES).toContain(name);
      expect(US_STATE_CODE_BY_NAME[name]).toBe(code);
    }
  });

  it("spot-checks the positional zip against known pairs", () => {
    expect(US_STATE_NAME_BY_CODE.CA).toBe("California");
    expect(US_STATE_NAME_BY_CODE.TX).toBe("Texas");
    expect(US_STATE_NAME_BY_CODE.AK).toBe("Alaska");
    expect(US_STATE_NAME_BY_CODE.WY).toBe("Wyoming");
    expect(US_STATE_CODE_BY_NAME["New Hampshire"]).toBe("NH");
  });
});

describe("normalizeLicensedStateName", () => {
  it("keeps full names, converts codes, trims, and matches case-insensitively", () => {
    expect(normalizeLicensedStateName("California")).toBe("California");
    expect(normalizeLicensedStateName("CA")).toBe("California");
    expect(normalizeLicensedStateName("ca")).toBe("California");
    expect(normalizeLicensedStateName("  tExAs  ")).toBe("Texas");
    expect(normalizeLicensedStateName(" NV ")).toBe("Nevada");
  });

  it("returns null for unknown or non-string input", () => {
    expect(normalizeLicensedStateName("DC")).toBeNull();
    expect(normalizeLicensedStateName("District of Columbia")).toBeNull();
    expect(normalizeLicensedStateName("Californiaa")).toBeNull();
    expect(normalizeLicensedStateName("")).toBeNull();
    expect(normalizeLicensedStateName("   ")).toBeNull();
    expect(normalizeLicensedStateName(42)).toBeNull();
    expect(normalizeLicensedStateName(null)).toBeNull();
    expect(normalizeLicensedStateName({ state: "CA" })).toBeNull();
  });
});

describe("licensedStatesToUiSelection", () => {
  it("keeps full-name strings as full names", () => {
    expect(licensedStatesToUiSelection(["California", "Texas"])).toEqual(["California", "Texas"]);
  });

  it("converts abbreviation strings to full names", () => {
    expect(licensedStatesToUiSelection(["CA", "TX"])).toEqual(["California", "Texas"]);
  });

  it("normalizes the exact production invitation payload", () => {
    expect(licensedStatesToUiSelection([{ state: "CA", licenseNumber: "" }])).toEqual(["California"]);
  });

  it("handles invitation objects with license numbers", () => {
    expect(
      licensedStatesToUiSelection([
        { state: "CA", licenseNumber: "12345" },
        { state: "TX", licenseNumber: "" },
      ]),
    ).toEqual(["California", "Texas"]);
  });

  it("normalizes mixed strings and objects", () => {
    expect(
      licensedStatesToUiSelection(["Nevada", { state: "TX", licenseNumber: "987" }, "ca"]),
    ).toEqual(["Nevada", "Texas", "California"]);
  });

  it("ignores malformed entries", () => {
    expect(
      licensedStatesToUiSelection([
        null,
        undefined,
        42,
        true,
        "",
        "   ",
        {},
        { state: 7 },
        { state: "" },
        { licenseNumber: "12" },
        [["CA"]],
        "Texas",
      ]),
    ).toEqual(["Texas"]);
  });

  it("returns an empty selection for null and non-array input", () => {
    expect(licensedStatesToUiSelection(null)).toEqual([]);
    expect(licensedStatesToUiSelection(undefined)).toEqual([]);
    expect(licensedStatesToUiSelection("California")).toEqual([]);
    expect(licensedStatesToUiSelection({ state: "CA" })).toEqual([]);
  });

  it("collapses duplicate recognized states to one entry, first occurrence wins", () => {
    expect(licensedStatesToUiSelection(["CA", "California", { state: "ca" }, "TX"])).toEqual([
      "California",
      "Texas",
    ]);
  });

  it("excludes unrecognized entries from the UI selection", () => {
    expect(licensedStatesToUiSelection(["DC", "Texas", { state: "District of Columbia" }])).toEqual([
      "Texas",
    ]);
  });

  it("preserves stable input order", () => {
    expect(licensedStatesToUiSelection(["WY", "Alabama", { state: "NV" }])).toEqual([
      "Wyoming",
      "Alabama",
      "Nevada",
    ]);
  });
});

describe("isLicensedStatesSelectionUnchanged", () => {
  const production = [{ state: "CA", licenseNumber: "12345" }];

  it("is unchanged for an untouched selection", () => {
    expect(isLicensedStatesSelectionUnchanged(production, ["California"])).toBe(true);
  });

  it("is unchanged after remove-then-re-add (order-insensitive set semantics)", () => {
    expect(isLicensedStatesSelectionUnchanged(["CA", "TX"], ["Texas", "California"])).toBe(true);
  });

  it("detects additions and removals", () => {
    expect(isLicensedStatesSelectionUnchanged(production, ["California", "Texas"])).toBe(false);
    expect(isLicensedStatesSelectionUnchanged(production, [])).toBe(false);
    expect(isLicensedStatesSelectionUnchanged(production, ["Texas"])).toBe(false);
  });

  it("treats malformed baselines as their recognizable subset", () => {
    expect(isLicensedStatesSelectionUnchanged([null, "CA", 42], ["California"])).toBe(true);
    expect(isLicensedStatesSelectionUnchanged(null, [])).toBe(true);
  });
});

describe("rebuildLicensedStatesPayload", () => {
  it("re-emits still-selected object entries verbatim, license number intact", () => {
    const original = [{ state: "CA", licenseNumber: "12345" }];
    expect(rebuildLicensedStatesPayload(original, ["California", "Texas"])).toEqual([
      { state: "CA", licenseNumber: "12345" },
      { state: "TX", licenseNumber: "" },
    ]);
  });

  it("does not alias the original object entries", () => {
    const original = [{ state: "CA", licenseNumber: "12345" }];
    const rebuilt = rebuildLicensedStatesPayload(original, ["California"]);
    expect(rebuilt[0]).toEqual(original[0]);
    expect(rebuilt[0]).not.toBe(original[0]);
  });

  it("preserves extra keys on object entries", () => {
    const original = [{ state: "CA", licenseNumber: "12345", expiresAt: "2027-01-01" }];
    expect(rebuildLicensedStatesPayload(original, ["California"])).toEqual([
      { state: "CA", licenseNumber: "12345", expiresAt: "2027-01-01" },
    ]);
  });

  it("removes only deselected states", () => {
    const original = [
      { state: "CA", licenseNumber: "12345" },
      { state: "TX", licenseNumber: "999" },
    ];
    expect(rebuildLicensedStatesPayload(original, ["Texas"])).toEqual([
      { state: "TX", licenseNumber: "999" },
    ]);
  });

  it("keeps a string-array source saving strings, normalized to full names", () => {
    expect(rebuildLicensedStatesPayload(["CA", "Texas"], ["California", "Texas", "Nevada"])).toEqual([
      "California",
      "Texas",
      "Nevada",
    ]);
  });

  it("adds object-shaped entries when the source contained any object", () => {
    const original = ["Nevada", { state: "CA", licenseNumber: "777" }];
    expect(rebuildLicensedStatesPayload(original, ["Nevada", "California", "Texas"])).toEqual([
      "Nevada",
      { state: "CA", licenseNumber: "777" },
      { state: "TX", licenseNumber: "" },
    ]);
  });

  it("prefers the entry with a non-empty license number over a duplicate", () => {
    const original = ["California", { state: "CA", licenseNumber: "999" }];
    expect(rebuildLicensedStatesPayload(original, ["California"])).toEqual([
      { state: "CA", licenseNumber: "999" },
    ]);
  });

  it("collapses duplicate object entries, keeping the license-number-bearing one", () => {
    const original = [
      { state: "CA", licenseNumber: "" },
      { state: "CA", licenseNumber: "555" },
    ];
    expect(rebuildLicensedStatesPayload(original, ["California", "Texas"])).toEqual([
      { state: "CA", licenseNumber: "555" },
      { state: "TX", licenseNumber: "" },
    ]);
  });

  it("keeps every distinct non-empty license number for a duplicated state", () => {
    const original = [
      { state: "CA", licenseNumber: "111" },
      { state: "CA", licenseNumber: "222" },
    ];
    expect(rebuildLicensedStatesPayload(original, ["California", "Texas"])).toEqual([
      { state: "CA", licenseNumber: "111" },
      { state: "CA", licenseNumber: "222" },
      { state: "TX", licenseNumber: "" },
    ]);
  });

  it("collapses duplicates that carry the same license number", () => {
    const original = [
      { state: "CA", licenseNumber: "111" },
      { state: "ca", licenseNumber: " 111 " },
    ];
    expect(rebuildLicensedStatesPayload(original, ["California"])).toEqual([
      { state: "CA", licenseNumber: "111" },
    ]);
  });

  it("treats a non-string license value as real license data, never as empty", () => {
    const original = [
      { state: "CA", licenseNumber: "" },
      { state: "CA", licenseNumber: 12345 },
    ];
    expect(rebuildLicensedStatesPayload(original, ["California"])).toEqual([
      { state: "CA", licenseNumber: 12345 },
    ]);
  });

  it("recognizes objects whose licenseNumber is missing or malformed", () => {
    expect(
      licensedStatesToUiSelection([
        { state: "CA" },
        { state: "TX", licenseNumber: 123 },
        { state: "NV", licenseNumber: null },
      ]),
    ).toEqual(["California", "Texas", "Nevada"]);
    expect(rebuildLicensedStatesPayload([{ state: "TX", licenseNumber: 123 }], ["Texas"])).toEqual([
      { state: "TX", licenseNumber: 123 },
    ]);
  });

  it("preserves license-bearing entries with no usable state on any rebuild", () => {
    const original = [
      { state: "CA", licenseNumber: "" },
      { licenseNumber: "K-77" },
      { state: "", licenseNumber: "Q-11" },
      { state: 9, licenseNumber: "R-22" },
      ["CA", "L-9"],
    ];
    expect(licensedStatesToUiSelection(original)).toEqual(["California"]);
    expect(rebuildLicensedStatesPayload(original, ["California", "Texas"])).toEqual([
      { state: "CA", licenseNumber: "" },
      { state: "TX", licenseNumber: "" },
      { licenseNumber: "K-77" },
      { state: "", licenseNumber: "Q-11" },
      { state: 9, licenseNumber: "R-22" },
      ["CA", "L-9"],
    ]);
  });

  it("returns only unremovable opaque entries when the selection is cleared", () => {
    expect(
      rebuildLicensedStatesPayload(
        [
          { state: "DC", licenseNumber: "D-42" },
          { state: "CA", licenseNumber: "1" },
        ],
        [],
      ),
    ).toEqual([{ state: "DC", licenseNumber: "D-42" }]);
    expect(rebuildLicensedStatesPayload(["CA"], [])).toEqual([]);
    expect(rebuildLicensedStatesPayload([{ state: "CA", licenseNumber: "1" }], [])).toEqual([]);
  });

  it("preserves unrecognized-but-real entries verbatim for round-trip safety", () => {
    const original = [
      { state: "DC", licenseNumber: "D-42" },
      "District of Columbia",
      { state: "CA", licenseNumber: "1" },
    ];
    expect(rebuildLicensedStatesPayload(original, ["California", "Texas"])).toEqual([
      { state: "CA", licenseNumber: "1" },
      { state: "TX", licenseNumber: "" },
      { state: "DC", licenseNumber: "D-42" },
      "District of Columbia",
    ]);
  });

  it("drops only provably valueless entries on rebuild, keeping data-carrying ones", () => {
    const original = [null, 42, {}, { state: 9 }, "CA"];
    // null/42/{} carry nothing; { state: 9 } is unparseable but non-empty and
    // must survive verbatim rather than be silently deleted.
    expect(rebuildLicensedStatesPayload(original, ["California"])).toEqual(["California", { state: 9 }]);
  });

  it("emits selection order and ignores duplicate selection names defensively", () => {
    expect(rebuildLicensedStatesPayload([], ["Texas", "California", "Texas"])).toEqual([
      "Texas",
      "California",
    ]);
  });

  it("handles a null source as an empty string-shaped source", () => {
    expect(rebuildLicensedStatesPayload(null, ["California"])).toEqual(["California"]);
  });
});
