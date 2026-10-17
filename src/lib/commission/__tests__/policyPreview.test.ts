import { describe, expect, it, vi } from "vitest";
// policyPreview reuses the sale writers' premium rule (policySaleRecording), which imports the client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { calculateEstimate } from "../calculator";
import { LEVEL_MALFORMED_MESSAGE, LEVEL_MISSING_MESSAGE, LEVEL_NOT_ON_GRID_MESSAGE } from "../contractLevel";
import { equals, formatUsd } from "../money";
import {
  ageOnDate,
  agentDisplayName,
  candidateProducts,
  policyTypeCategories,
  prefillAge,
  PREVIEW_UNAVAILABLE_MESSAGE,
  previewAccess,
  previewOutcome,
  previewPremiumText,
  productTermLengths,
  resolveCreditedLevel,
} from "../policyPreview";
import { IDS, syntheticContext } from "./syntheticGrid";

const context = syntheticContext();
const NORTH = "Synthetic Carrier North";
const SOUTH = "Synthetic Carrier South";
const names = (policyType: string, carrier: string) => candidateProducts(context, policyType, carrier).map((p) => p.productName);
const product = (id: string) => context.products.find((p) => p.id === id)!;

describe("policy type → comp categories (decision P2)", () => {
  it("maps the four CRM policy types; Final Expense lists whole-life candidates only", () => {
    expect(policyTypeCategories("Term")).toEqual(["term"]);
    expect(policyTypeCategories("Whole Life")).toEqual(["whole_life"]);
    expect(policyTypeCategories("IUL")).toEqual(["iul"]);
    expect(policyTypeCategories("Final Expense")).toEqual(["whole_life"]);
  });

  it("has no categories for blank, unknown or prototype-shaped policy types", () => {
    for (const type of ["", "term", "Final expense", "constructor", "toString", "__proto__"]) {
      expect(policyTypeCategories(type)).toEqual([]);
    }
  });
});

describe("candidate products", () => {
  it("Final Expense offers only the matched carrier's whole-life products", () => {
    expect(names("Final Expense", NORTH)).toEqual(["North Final Plan"]);
    expect(names("Final Expense", SOUTH)).toEqual(["South Zero Plan"]);
  });

  it("matches carriers exactly apart from surrounding spaces and case — never fuzzy or another carrier", () => {
    expect(names("Final Expense", `  ${NORTH.toUpperCase()} `)).toEqual(["North Final Plan"]);
    for (const carrier of ["Synthetic Carrier Nort", "Synthetic  Carrier North", "North", "Synthetic Carrier", "", "   "]) {
      expect(names("Final Expense", carrier)).toEqual([]);
    }
  });

  it("lists term products by name, never auto-selecting or mixing categories", () => {
    expect(names("Term", NORTH)).toEqual(["North Level Term", "North Return Term"]);
    expect(names("IUL", NORTH)).toEqual([]);
    expect(names("IUL", SOUTH)).toEqual(["South Junior Builder"]);
    expect(names("Unknown", NORTH)).toEqual([]);
  });

  it("reports a product's supported term lengths (empty when terms do not apply)", () => {
    expect(productTermLengths(context, IDS.levelTerm)).toEqual([10, 15, 20, 30]);
    expect(productTermLengths(context, IDS.finalPlan)).toEqual([]);
  });
});

describe("insured age prefill (valid information only)", () => {
  it("computes whole years on the Sold Date", () => {
    expect(ageOnDate("1970-06-15", "2026-06-14")).toBe(55);
    expect(ageOnDate("1970-06-15", "2026-06-15")).toBe(56);
    expect(ageOnDate("2000-02-29", "2025-02-28")).toBe(24);
    expect(ageOnDate("2000-02-29", "2025-03-01")).toBe(25);
    expect(ageOnDate("2000-02-29", "2024-02-29")).toBe(24);
  });

  it("rejects impossible dates, non-ISO text and births after the Sold Date", () => {
    expect(ageOnDate("1970-02-30", "2026-01-01")).toBeNull();
    expect(ageOnDate("06/15/1970", "2026-01-01")).toBeNull();
    expect(ageOnDate("1970-06-15", "")).toBeNull();
    expect(ageOnDate("2027-01-01", "2026-01-01")).toBeNull();
  });

  it("prefers a real date of birth, then a stored whole-number age 0–100, else blank", () => {
    expect(prefillAge({ dateOfBirth: "1970-06-15", age: 30, onDate: "2026-06-15" })).toBe("56");
    expect(prefillAge({ dateOfBirth: undefined, age: 64 })).toBe("64");
    expect(prefillAge({ dateOfBirth: "not a date", age: 0 })).toBe("0");
    for (const age of [101, 64.5, -1, Number.NaN, undefined, null]) {
      expect(prefillAge({ age: age as number | null | undefined })).toBe("");
    }
    expect(prefillAge(undefined)).toBe("");
  });

  it("never falls back to a stored age when a real date of birth cannot give a valid age", () => {
    expect(prefillAge({ dateOfBirth: "2027-01-01", age: 40, onDate: "2026-01-01" })).toBe("");
    expect(prefillAge({ dateOfBirth: "1900-01-01", age: 40, onDate: "2026-01-01" })).toBe("");
    expect(prefillAge({ dateOfBirth: "1970-06-15", age: 40, onDate: "" })).toBe("");
  });
});

describe("access: own and others' permissions are independent (decision P1)", () => {
  const base = { operatorId: "a", role: "Agent", organizationWide: false, canSeeOwn: false, canSeeOthers: false };

  it("the signed-in user's own estimate needs only View Own", () => {
    expect(previewAccess({ ...base, creditedAgentId: "a", canSeeOwn: true })).toEqual({ kind: "own" });
    expect(previewAccess({ ...base, creditedAgentId: "a", canSeeOthers: true, organizationWide: true })).toEqual({ kind: "denied" });
  });

  it("another agent's estimate needs only View Others' plus the existing hierarchy", () => {
    const other = { ...base, creditedAgentId: "b", canSeeOthers: true };
    expect(previewAccess({ ...other, role: "Admin", organizationWide: true })).toEqual({ kind: "other", needsTeamScope: false });
    expect(previewAccess({ ...other, role: "Team Leader" })).toEqual({ kind: "other", needsTeamScope: true });
    expect(previewAccess({ ...other, role: "Agent" })).toEqual({ kind: "denied" });
    expect(previewAccess({ ...other, canSeeOthers: false, canSeeOwn: true, role: "Admin", organizationWide: true })).toEqual({ kind: "denied" });
  });
});

describe("credited agent's contract level (strict, never defaulted)", () => {
  const levels = context.grid.contractLevels;

  it("accepts only whole numbers on the grid", () => {
    expect(resolveCreditedLevel("100", levels, true)).toEqual({ kind: "valid", level: 100 });
    expect(resolveCreditedLevel(" 120% ", levels, false)).toEqual({ kind: "valid", level: 120 });
  });

  it("reports missing, malformed and off-grid levels, phrased for the right person", () => {
    expect(resolveCreditedLevel(null, levels, true)).toEqual({ kind: "problem", message: LEVEL_MISSING_MESSAGE });
    expect(resolveCreditedLevel("87.5", levels, true)).toEqual({ kind: "problem", message: LEVEL_MALFORMED_MESSAGE });
    expect(resolveCreditedLevel("0%", levels, true)).toEqual({ kind: "problem", message: LEVEL_NOT_ON_GRID_MESSAGE });
    expect(resolveCreditedLevel("", levels, false)).toEqual({ kind: "problem", message: "This agent's contract level isn't set up." });
    expect(resolveCreditedLevel("abc", levels, false)).toEqual({ kind: "problem", message: "This agent's contract level isn't a whole number." });
    expect(resolveCreditedLevel("101", levels, false)).toEqual({
      kind: "problem",
      message: "This agent's contract level isn't on your agency's comp grid.",
    });
  });
});

describe("agent display name", () => {
  it("uses the name, then the email, else nothing", () => {
    expect(agentDisplayName({ firstName: " Synthetic ", lastName: "Agent ", email: "x@example.test" })).toBe("Synthetic Agent");
    expect(agentDisplayName({ firstName: "", lastName: "", email: " agent@example.test " })).toBe("agent@example.test");
    expect(agentDisplayName({ firstName: " ", lastName: "", email: "" })).toBeNull();
  });
});

describe("premium basis = what the sale writers record", () => {
  it("strips $, commas and spaces like saleMonthlyPremium, keeping exact text", () => {
    expect(previewPremiumText("$1,250.50")).toBe("1250.50");
    expect(previewPremiumText(" 125 ")).toBe("125");
    expect(previewPremiumText("")).toBe("");
    expect(previewPremiumText("abc")).toBe("abc");
    expect(previewPremiumText("-5")).toBe("-5");
  });
});

describe("preview outcome (unchanged engine)", () => {
  const outcome = (id: string | null, inputs: { term?: string; age?: string; monthlyPremium?: string }, level = 100, isOwn = true) =>
    previewOutcome(context, level, id ? product(id) : null, { term: "", age: "", monthlyPremium: "", ...inputs }, isOwn);

  it("asks for the missing input instead of estimating", () => {
    expect(outcome(null, { age: "60", monthlyPremium: "100" })).toEqual({ kind: "hint", message: "Choose a product." });
    expect(outcome(IDS.levelTerm, { age: "40", monthlyPremium: "100" })).toEqual({ kind: "hint", message: "Choose a term length." });
    expect(outcome(IDS.finalPlan, { monthlyPremium: "100" })).toEqual({ kind: "hint", message: "Enter the client's age." });
    expect(outcome(IDS.finalPlan, { age: "60" })).toEqual({ kind: "hint", message: "Enter the monthly premium." });
    expect(outcome(IDS.finalPlan, { age: "60", monthlyPremium: "0" })).toEqual({
      kind: "hint",
      message: "Monthly premium must be greater than $0.",
    });
  });

  it("estimates a genuinely stored zero rate as $0.00", () => {
    const result = outcome(IDS.zeroPlan, { age: "60", monthlyPremium: "100" });
    expect(result.kind).toBe("estimate");
    if (result.kind !== "estimate") return;
    expect(formatUsd(result.firstYearCommission)).toBe("$0.00");
    expect(formatUsd(result.advance)).toBe("$0.00");
  });

  it("reports a missing rate as unavailable — never $0 — phrased for the right person", () => {
    expect(outcome(IDS.finalPlan, { age: "60", monthlyPremium: "100" }, 95)).toEqual({
      kind: "unavailable",
      message: "Not available at your contract level.",
    });
    expect(outcome(IDS.finalPlan, { age: "60", monthlyPremium: "100" }, 95, false)).toEqual({
      kind: "unavailable",
      message: "Not available at this agent's contract level.",
    });
    expect(outcome(IDS.finalPlan, { age: "40", monthlyPremium: "100" })).toEqual({ kind: "unavailable", message: "Not available for this age." });
    expect(outcome(IDS.overlapping, { age: "58", term: "20", monthlyPremium: "100" })).toEqual({
      kind: "unavailable",
      message: PREVIEW_UNAVAILABLE_MESSAGE,
    });
  });

  it("matches the calculator engine exactly across the synthetic grid (parity)", () => {
    let compared = 0;
    for (const p of context.products) {
      const terms = productTermLengths(context, p.id);
      for (const level of context.grid.contractLevels) {
        for (const age of [0, 17, 18, 40, 50, 55, 60, 65, 70, 71, 85, 100]) {
          for (const term of terms.length ? terms : [null]) {
            for (const premium of ["1", "99.99", "125.50", "1250"]) {
              const engine = calculateEstimate(context, level, { productId: p.id, age, term, monthlyPremium: premium });
              const preview = outcome(p.id, { age: String(age), term: term === null ? "" : String(term), monthlyPremium: premium }, level);
              if (engine.kind === "estimate") {
                expect(preview.kind).toBe("estimate");
                if (preview.kind !== "estimate") continue;
                expect(equals(preview.firstYearCommission, engine.estimate.firstYearCommission)).toBe(true);
                expect(equals(preview.advance, engine.estimate.advance)).toBe(true);
                expect(formatUsd(preview.firstYearCommission)).toBe(formatUsd(engine.estimate.firstYearCommission));
                compared += 1;
              } else {
                expect(preview.kind).toBe("unavailable");
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(50);
  });

  it("estimates on the same premium basis the sale records", () => {
    const formatted = outcome(IDS.finalPlan, { age: "60", monthlyPremium: "$1,250.50" });
    const plain = calculateEstimate(context, 100, { productId: IDS.finalPlan, age: 60, term: null, monthlyPremium: "1250.50" });
    expect(formatted.kind).toBe("estimate");
    if (formatted.kind !== "estimate" || plain.kind !== "estimate") return;
    expect(equals(formatted.firstYearCommission, plain.estimate.firstYearCommission)).toBe(true);
  });
});
