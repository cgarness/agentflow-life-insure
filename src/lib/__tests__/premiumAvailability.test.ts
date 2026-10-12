/**
 * D14: a premium amount is wholly unavailable only from the row's own counts (policies > 0 and every premium
 * unknown), never from the amount itself.
 */
import { describe, expect, it } from "vitest";
import { isPremiumWhollyUnknown } from "@/lib/premiumAvailability";

describe("isPremiumWhollyUnknown", () => {
  it.each([
    ["no policies: the empty period keeps its $0.00", 0, 0, false],
    ["known premiums totalling $0: a genuine zero", 2, 0, false],
    ["some premiums known: the subtotal stays", 3, 1, false],
    ["every premium unknown: unavailable", 2, 2, true],
    ["one policy, unknown premium: unavailable", 1, 1, true],
    ["inconsistent counts above the policy count still read as all unknown", 2, 3, true],
  ])("%s", (_case, policies, unknown, expected) => {
    expect(isPremiumWhollyUnknown(policies, unknown)).toBe(expected);
  });

  it("decides nothing when a count is missing (not loaded, failed or not reported)", () => {
    for (const [policies, unknown] of [[undefined, 2], [2, undefined], [null, 2], [2, null], [undefined, undefined]] as const) {
      expect(isPremiumWhollyUnknown(policies, unknown)).toBe(false);
    }
  });
});
