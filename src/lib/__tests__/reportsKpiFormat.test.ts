import { describe, expect, it } from "vitest";
import { csvValue, roundHalfUp, tileView, toCents, toMillionths } from "@/lib/reports-kpi-format";
import { kpi } from "@/lib/reports-kpi-registry";
import { BC4_CASES, env } from "./reportsV3Fixtures";

describe("single rounding (plan §2.5)", () => {
  it.each([[1249, 1000, 1, "1.2"], [1249, 1000, 2, "1.25"], [9, 4, 1, "2.3"], [115, 100, 1, "1.2"], [0, 5, 1, "0.0"], [100, 3, 1, "33.3"], [5, 2, 0, "3"]])(
    "roundHalfUp(%s, %s, %s) = %s", (n, d, k, want) => expect(roundHalfUp(n, d, k)).toBe(want));
  it("uses exact integers beyond 2^53", () => expect(roundHalfUp(2n ** 60n + 1n, 2n, 0)).toBe("576460752303423489"));
  it("converts money and medians exactly", () => {
    expect(toCents(2266.45)).toBe(226645n);
    expect(toCents(0.1 + 0.2)).toBe(30n);
    expect(toMillionths(2.25)).toBe(2_250_000n);
  });
  it("rounds KPI 4 once from its exact numerator and count", () => {
    const e = env({ id: 4, value: 2266.451613, numerator: 2248320, denominator: 992 });
    expect(tileView(kpi(4), e).text).toBe("$2,266.45");
    expect(csvValue(kpi(4), e)).toBe("2266.45");
  });
  it("drops a trailing .0 on medians and keeps exact days", () => {
    expect(tileView(kpi(14), env({ id: 14, value: 3, detail: null })).text).toBe("3");
    expect(tileView(kpi(21), env({ id: 21, value: 2.25 })).text).toBe("2.3");
  });
});

describe("BC4 truth table (tiles and CSV values)", () => {
  for (const c of BC4_CASES) {
    it(`case ${c.n}: ${c.scenario}`, () => {
      for (const e of c.envelopes) {
        const want = c.expect[e.id], view = tileView(kpi(e.id), e);
        expect({ text: view.text, cue: view.cue, chips: view.chips }).toEqual({ text: want.text, cue: want.cue === "Not enough data" ? "No eligible data" : want.cue, chips: want.chips.filter(c => c !== "partial") });
        expect(e.value === null ? "" : csvValue(kpi(e.id), e)).toBe(want.csvValue);
        expect(e.reason ?? "").toBe(want.csvReason);
      }
    });
  }
});
