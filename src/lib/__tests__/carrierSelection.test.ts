import { describe, expect, it } from "vitest";
import {
  CARRIER_LIST_UNAVAILABLE,
  CARRIER_NOT_CONFIGURED,
  carrierSelectionError,
  normalizeCarrierNames,
  preservedCarrierOption,
} from "../carrierSelection";

describe("normalizeCarrierNames", () => {
  it("trims, drops blanks, de-duplicates case-insensitively and sorts alphabetically", () => {
    expect(normalizeCarrierNames([" Zeta Life", "aetna", "", null, "Aetna", "mutual", "Banner "])).toEqual(["aetna", "Banner", "mutual", "Zeta Life"]);
  });
});

describe("preservedCarrierOption", () => {
  const configured = ["Aetna", "Banner"];
  it("is null for a blank value or an exact configured name", () => {
    expect(preservedCarrierOption(configured, "")).toBeNull();
    expect(preservedCarrierOption(configured, "   ")).toBeNull();
    expect(preservedCarrierOption(configured, undefined)).toBeNull();
    expect(preservedCarrierOption(configured, "Aetna")).toBeNull();
  });
  it("keeps a removed carrier exactly and flags it", () => {
    expect(preservedCarrierOption(configured, "Old Carrier ")).toEqual({ value: "Old Carrier ", notInSettings: true });
  });
  it("keeps a case/whitespace variant exactly without flagging it", () => {
    expect(preservedCarrierOption(configured, " aetna")).toEqual({ value: " aetna", notInSettings: false });
  });
  it("keeps the value unflagged while the list is unavailable", () => {
    expect(preservedCarrierOption(null, "Old Carrier")).toEqual({ value: "Old Carrier", notInSettings: false });
  });
});

describe("carrierSelectionError", () => {
  const configured = ["Aetna", "Banner"];
  it("allows blank (callers decide when a carrier is required)", () => {
    expect(carrierSelectionError(configured, "")).toBeNull();
    expect(carrierSelectionError(null, undefined)).toBeNull();
  });
  it("accepts only exact configured names", () => {
    expect(carrierSelectionError(configured, "Banner")).toBeNull();
    expect(carrierSelectionError(configured, "banner")).toBe(CARRIER_NOT_CONFIGURED);
    expect(carrierSelectionError(configured, "Typed Carrier")).toBe(CARRIER_NOT_CONFIGURED);
  });
  it("accepts the exact preserved value only, even when the list is unavailable", () => {
    expect(carrierSelectionError(null, "Old Carrier ", "Old Carrier ")).toBeNull();
    expect(carrierSelectionError(configured, "Old Carrier ", "Old Carrier ")).toBeNull();
    expect(carrierSelectionError(configured, "Old Carrier", "Old Carrier ")).toBe(CARRIER_NOT_CONFIGURED);
  });
  it("requires a loaded list for any new or changed carrier", () => {
    expect(carrierSelectionError(null, "Aetna")).toBe(CARRIER_LIST_UNAVAILABLE);
    expect(carrierSelectionError(null, "Aetna", "Old Carrier")).toBe(CARRIER_LIST_UNAVAILABLE);
  });
});
