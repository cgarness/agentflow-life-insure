import { describe, expect, it } from "vitest";
import type { GridSnapshot } from "../adminTypes";
import { buildChangeSet, draftFromSnapshot, isEmptyChangeSet, isIsoDate, ratesAtLevel, validateDraft, type GridDraft } from "../gridDraft";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A synthetic private grid: one term product with two variants, one whole-life product with one. */
function snapshot(): GridSnapshot {
  return {
    grid: {
      id: id(1), name: "Synthetic Private", effectiveDate: "2025-04-01", isActive: true, contractLevels: [120, 110, 100],
      revision: 7, origin: "full_copy", shared: false, editable: true, updatedAt: "2025-04-02T10:00:00Z", updatedByName: "Ada One",
    },
    products: [
      { id: id(10), category: "term", carrier: "Synthetic Carrier", productName: "Synthetic Term", isActive: true },
      { id: id(11), category: "whole_life", carrier: "Synthetic Carrier", productName: "Synthetic Final", isActive: true },
    ],
    variants: [
      { id: id(20), productId: id(10), label: "10-20 yr", minAge: 18, maxAge: 65, termYears: [10, 20] },
      { id: id(21), productId: id(10), label: "30 yr", minAge: 18, maxAge: 50, termYears: [30] },
      { id: id(22), productId: id(11), label: "", minAge: null, maxAge: 85, termYears: null },
    ],
    rates: [
      { variantId: id(20), contractLevel: 120, ratePercent: "87.50" },
      { variantId: id(20), contractLevel: 100, ratePercent: "70" },
      { variantId: id(21), contractLevel: 100, ratePercent: "0" },
      { variantId: id(22), contractLevel: 110, ratePercent: "55.25" },
    ],
    references: [{ variantId: id(22), source: "Synthetic sheet", notes: null }],
  };
}
const edit = (fn: (d: GridDraft) => void) => {
  const d = draftFromSnapshot(snapshot());
  fn(d);
  return d;
};

describe("draft round trip", () => {
  it("an untouched draft is clean and valid", () => {
    const d = draftFromSnapshot(snapshot());
    expect(isEmptyChangeSet(buildChangeSet(snapshot(), d))).toBe(true);
    expect(validateDraft(d)).toEqual([]);
    expect(d.variants[0].terms).toBe("10, 20");
    expect(d.variants[2]).toMatchObject({ minAge: "", maxAge: "85", terms: "", source: "Synthetic sheet", notes: "" });
  });

  it("retyping a value with a different scale is not a change (87.5 = 87.50)", () => {
    const d = edit((draft) => { draft.rates[id(20)][120] = "87.5"; });
    expect(isEmptyChangeSet(buildChangeSet(snapshot(), d))).toBe(true);
  });
});

describe("change set", () => {
  it("sends all four grid details together, and only when one changed", () => {
    const d = edit((draft) => { draft.isActive = false; });
    expect(buildChangeSet(snapshot(), d)).toEqual({
      grid: { name: "Synthetic Private", effective_date: "2025-04-01", is_active: false, contract_levels: [120, 110, 100] },
    });
  });

  it("explicit blanks delete cells, explicit zeros are values", () => {
    const d = edit((draft) => {
      draft.rates[id(20)][100] = "";
      draft.rates[id(21)][110] = "0";
    });
    expect(buildChangeSet(snapshot(), d).rates).toEqual([
      { variant_id: id(20), contract_level: 100, rate_percent: null },
      { variant_id: id(21), contract_level: 110, rate_percent: "0" },
    ]);
  });

  it("removing a level deletes its rates in the same save; a new level can take rates at once", () => {
    const d = edit((draft) => {
      draft.levels = [125, 110, 100];
      delete draft.rates[id(20)][120];
      draft.rates[id(21)][125] = "91";
    });
    const changes = buildChangeSet(snapshot(), d);
    expect(changes.grid?.contract_levels).toEqual([125, 110, 100]);
    expect(changes.rates).toEqual(expect.arrayContaining([
      { variant_id: id(20), contract_level: 120, rate_percent: null },
      { variant_id: id(21), contract_level: 125, rate_percent: "91" },
    ]));
  });

  it("new products and variants travel by key; their blank cells are simply omitted", () => {
    const d = edit((draft) => {
      draft.products.push({ ref: "new:1", id: null, category: "iul", carrier: "Synthetic Carrier", productName: "Synthetic Index", isActive: true });
      draft.variants.push({ ref: "new:2", id: null, productRef: "new:1", label: "", minAge: "0", maxAge: "", terms: "", source: "", notes: "Synthetic note" });
      draft.rates["new:2"] = { 120: "", 110: "40" };
    });
    const changes = buildChangeSet(snapshot(), d);
    expect(changes.products).toEqual([{ key: "new:1", category: "iul", carrier: "Synthetic Carrier", product_name: "Synthetic Index", is_active: true }]);
    expect(changes.variants).toEqual([{
      key: "new:2", product_key: "new:1", label: "", min_age: 0, max_age: null, term_years: null,
      reference: { source: "", notes: "Synthetic note" },
    }]);
    expect(changes.rates).toEqual([{ variant_key: "new:2", contract_level: 110, rate_percent: "40" }]);
  });

  it("deletes a product (its variants cascade) and a variant of a kept product", () => {
    const d = edit((draft) => {
      draft.products = draft.products.filter((p) => p.id !== id(11));
      draft.variants = draft.variants.filter((v) => v.id !== id(22) && v.id !== id(21));
    });
    const changes = buildChangeSet(snapshot(), d);
    expect(changes.delete_product_ids).toEqual([id(11)]);
    expect(changes.delete_variant_ids).toEqual([id(21)]);
    expect(changes.rates).toBeUndefined();
  });

  it("updates by id with every field, and the reference only when it changed", () => {
    const d = edit((draft) => {
      draft.products[0].productName = "Synthetic Term Plus";
      draft.variants[2].notes = "New synthetic note";
      draft.variants[0].maxAge = "60";
    });
    const changes = buildChangeSet(snapshot(), d);
    expect(changes.products).toEqual([{ id: id(10), category: "term", carrier: "Synthetic Carrier", product_name: "Synthetic Term Plus", is_active: true }]);
    expect(changes.variants).toEqual([
      { id: id(20), label: "10-20 yr", min_age: 18, max_age: 60, term_years: [10, 20] },
      { id: id(22), label: "", min_age: null, max_age: 85, term_years: null, reference: { source: "Synthetic sheet", notes: "New synthetic note" } },
    ]);
  });

  it("clearing both reference fields removes the reference", () => {
    const d = edit((draft) => { draft.variants[2].source = ""; });
    expect(buildChangeSet(snapshot(), d).variants).toEqual([
      { id: id(22), label: "", min_age: null, max_age: 85, term_years: null, reference: null },
    ]);
  });
});

describe("validation mirrors the database rules", () => {
  const messages = (d: GridDraft) => validateDraft(d).map((issue) => issue.message);

  it.each([
    ["87.555", "Rates must be between 0 and 300 with at most two decimal places."],
    ["300.01", "Rates must be between 0 and 300 with at most two decimal places."],
    ["-1", "Rates must be between 0 and 300 with at most two decimal places."],
    ["1e2", "Rates must be between 0 and 300 with at most two decimal places."],
    [" 70", "Rates must be between 0 and 300 with at most two decimal places."],
  ])("refuses rate %j (never rounds it)", (text, message) => {
    expect(messages(edit((draft) => { draft.rates[id(20)][110] = text; }))).toEqual([message]);
  });

  it("refuses overlapping variants, mixed term definitions, duplicate labels and blank labels on multi-variant products", () => {
    expect(messages(edit((draft) => { draft.variants[1].terms = "20, 30"; }))).toContain("Two variants of this product would match the same age and term.");
    expect(messages(edit((draft) => { draft.variants[1].terms = ""; }))).toContain("A product can't mix variants with and without term lengths.");
    expect(messages(edit((draft) => { draft.variants[1].label = "10-20 yr"; }))).toContain("Each variant of a product needs a different label.");
    expect(messages(edit((draft) => { draft.variants[1].label = ""; }))).toContain("Only a product with a single variant may leave its label blank.");
  });

  it("refuses bad ages, terms, names and dates without repairing them", () => {
    expect(messages(edit((draft) => { draft.variants[0].minAge = "18.5"; }))).toContain("Ages must be whole numbers from 0 to 100 (blank = no limit).");
    expect(messages(edit((draft) => { draft.variants[0].minAge = "70"; }))).toContain("The minimum age can't be above the maximum age.");
    expect(messages(edit((draft) => { draft.variants[0].terms = "10, 10"; }))).toContain("List each term length once (at most 20).");
    expect(messages(edit((draft) => { draft.variants[0].terms = "10; 20"; }))).toContain("Term lengths must be whole numbers from 1 to 100, separated by commas.");
    expect(messages(edit((draft) => { draft.products[0].carrier = " Synthetic"; }))).toContain(
      "Carrier names need 1 to 120 characters, without leading or trailing spaces.");
    expect(messages(edit((draft) => { draft.name = ""; }))).toContain("The grid name needs 1 to 120 characters, without leading or trailing spaces.");
    expect(messages(edit((draft) => { draft.effectiveDate = "2025-02-30"; }))).toContain("Choose an effective date.");
    expect(messages(edit((draft) => { draft.levels = []; }))).toContain("A grid needs 1 to 60 contract levels.");
  });

  it("counts the rates a level removal would delete", () => {
    expect(ratesAtLevel(draftFromSnapshot(snapshot()), 100)).toBe(2);
    expect(ratesAtLevel(draftFromSnapshot(snapshot()), 125)).toBe(0);
  });

  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-13-01")).toBe(false);
    expect(isIsoDate("2025-1-01")).toBe(false);
  });
});
