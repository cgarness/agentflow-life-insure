/**
 * The normalized policy record — the contract for reading the book of business.
 *
 * `clients.custom_fields.additional_policies` has exactly ONE writer (ConvertLeadModal ->
 * supabase-conversion.ts) and, before this build, ZERO readers, and production holds zero rows
 * carrying the key. There is therefore no real data to validate against: THIS SUITE is the
 * contract, and it is written against the writer's exact `AdditionalPolicyPayload` shape.
 *
 * Every case below is a real, observed condition, not a defensive guess. The SQL half of the same
 * rules is asserted in supabase/tests/profile_book_stats_rpc.sql (T2, T5, T14).
 */

import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_POLICIES_KEY,
  hasPrimaryPolicyEvidence,
  normalizeClientPolicies,
  normalizeClientsToPolicies,
  parsePolicyAmount,
  parsePolicyDate,
  policyMonthBucket,
  type ClientPolicyRow,
} from "@/lib/profile/normalized-policy";

/** A client row exactly as `clients` DDL defaults produce it for a CSV import. */
const importedShape: ClientPolicyRow = {
  id: "c-import",
  policy_type: "Term", // NOT NULL DEFAULT 'Term'
  carrier: "", // DEFAULT ''
  policy_number: "", // DEFAULT ''
  premium: 0, // DEFAULT 0
  face_amount: 0, // DEFAULT 0
  sold_date: null,
  custom_fields: null,
};

describe("parsePolicyAmount — parseCurrencyToNumberOrNull semantics, never the 0-coercing parser", () => {
  it("parses the raw strings the writer actually stores", () => {
    expect(parsePolicyAmount("$150/mo")).toBe(150);
    expect(parsePolicyAmount("$1,500.00")).toBe(1500);
    expect(parsePolicyAmount("$50,000")).toBe(50000);
    expect(parsePolicyAmount(".5")).toBe(0.5);
    expect(parsePolicyAmount("-5.5")).toBe(-5.5);
  });

  it("follows parseFloat: a leading number, trailing junk ignored", () => {
    expect(parsePolicyAmount("1-2")).toBe(1);
    expect(parsePolicyAmount("1.2.3")).toBe(1.2);
  });

  it("returns null for blank-ish input, NEVER 0", () => {
    // This is the difference from parseCurrencyToNumber (supabase-conversion.ts:46), which the
    // conversion path uses. A blank premium must not become a 0 that drags a book total down.
    for (const blank of ["", "  ", "-", ".", "abc", null, undefined]) {
      expect(parsePolicyAmount(blank)).toBeNull();
    }
  });
});

describe("parsePolicyDate — strict YYYY-MM-DD, no silent roll-forward", () => {
  it("accepts a well-formed date, trimming whitespace", () => {
    expect(parsePolicyDate("2026-01-15")).toBe("2026-01-15");
    expect(parsePolicyDate("  2026-01-15  ")).toBe("2026-01-15");
  });

  it("rejects an impossible date rather than rolling it forward", () => {
    // new Date("2026-02-31") is 2026-03-03. A policy dated to a day that does not exist has no
    // date; it is not dated to some other month.
    expect(parsePolicyDate("2026-02-31")).toBeNull();
  });

  it("rejects other formats and blanks", () => {
    for (const bad of ["01/15/2026", "2026-1-5", "", null, undefined, 20260115]) {
      expect(parsePolicyDate(bad)).toBeNull();
    }
  });
});

describe("primary policy — evidence-based counting (decision D-3b)", () => {
  it("a CSV-imported client on DDL defaults contributes NO primary policy", () => {
    // Without this rule, every imported contact would register as a Term policy worth $0 and would
    // dominate the policy-type mix. The client is still a CLIENT; it is only not a POLICY.
    expect(hasPrimaryPolicyEvidence(importedShape)).toBe(false);

    const result = normalizeClientPolicies(importedShape);
    expect(result.policies).toHaveLength(0);
    expect(result.hasNoPolicyDetail).toBe(true);
  });

  it("ANY ONE policy signal is enough", () => {
    expect(hasPrimaryPolicyEvidence({ ...importedShape, carrier: "Americo" })).toBe(true);
    expect(hasPrimaryPolicyEvidence({ ...importedShape, policy_number: "P1" })).toBe(true);
    expect(hasPrimaryPolicyEvidence({ ...importedShape, premium: 10 })).toBe(true);
    expect(hasPrimaryPolicyEvidence({ ...importedShape, face_amount: 1000 })).toBe(true);
    expect(hasPrimaryPolicyEvidence({ ...importedShape, sold_date: "2026-01-01" })).toBe(true);
  });

  it("treats 0 as 'not recorded', matching formatCurrencyValue", () => {
    const row: ClientPolicyRow = { ...importedShape, carrier: "Americo", premium: 0, face_amount: 0 };
    const [policy] = normalizeClientPolicies(row).policies;
    expect(policy.premiumMonthly).toBeNull();
    expect(policy.faceAmount).toBeNull();
  });

  it("blank carrier and policy number become null, not empty strings", () => {
    const row: ClientPolicyRow = { ...importedShape, premium: 25 };
    const [policy] = normalizeClientPolicies(row).policies;
    expect(policy.carrier).toBeNull();
    expect(policy.policyNumber).toBeNull();
    expect(policy.premiumMonthly).toBe(25);
  });
});

describe("additional policies — the writer's exact shape", () => {
  const withAdditional = (entries: unknown[]): ClientPolicyRow => ({
    ...importedShape,
    id: "c1",
    carrier: "Mutual of Omaha",
    premium: 100.5,
    face_amount: 250000,
    sold_date: "2026-01-15",
    custom_fields: { Gender: "M", [ADDITIONAL_POLICIES_KEY]: entries },
  });

  it("includes additional policies and parses their UNPARSED string amounts", () => {
    // The writer parses the PRIMARY amounts before storing the numeric columns, but writes the
    // additional array verbatim (supabase-conversion.ts:37-38 vs :46-48, :84-86).
    const result = normalizeClientPolicies(
      withAdditional([
        {
          policyType: "Whole Life",
          carrier: "Americo",
          policyNumber: "P1b",
          faceAmount: "$50,000",
          premiumAmount: "$25.25/mo",
          soldDate: "2026-01-15",
          effectiveDate: null,
        },
      ]),
    );

    expect(result.policies).toHaveLength(2);
    const additional = result.policies.find((p) => p.source === "additional")!;
    expect(additional.premiumMonthly).toBe(25.25);
    expect(additional.faceAmount).toBe(50000);
    expect(additional.policyType).toBe("Whole Life");
    expect(additional.carrier).toBe("Americo");
  });

  it("honours the LEGACY issueDate key", () => {
    // "Rows written before the Sold Date build carry `issueDate` instead of `soldDate`; readers
    // must tolerate both keys" — supabase-conversion.ts:8-10.
    const result = normalizeClientPolicies(
      withAdditional([{ policyType: "Term", issueDate: "2025-12-01" }]),
    );
    const additional = result.policies.find((p) => p.source === "additional")!;
    expect(additional.soldDate).toBe("2025-12-01");
    expect(policyMonthBucket(additional)).toBe("2025-12");
  });

  it("prefers soldDate when both keys are present", () => {
    const result = normalizeClientPolicies(
      withAdditional([{ soldDate: "2026-03-01", issueDate: "2025-12-01" }]),
    );
    expect(result.policies.find((p) => p.source === "additional")!.soldDate).toBe("2026-03-01");
  });

  it("a blank amount yields null, so it is 'missing premium' rather than a zero-premium policy", () => {
    const result = normalizeClientPolicies(
      withAdditional([{ policyType: "Term", premiumAmount: "", faceAmount: "" }]),
    );
    const additional = result.policies.find((p) => p.source === "additional")!;
    expect(additional.premiumMonthly).toBeNull();
    expect(additional.faceAmount).toBeNull();
  });
});

describe("malformed additional_policies — the FullScreenContactView corruption path", () => {
  it("a STRING container yields zero additional policies and ONE data-quality signal", () => {
    // FullScreenContactView.tsx:1116-1122 renders this key through renderField's default text
    // <input> (:833) and handleSave (:660) writes the whole customFields object back. One keystroke
    // replaces the array with a string, permanently. The reader must survive it and COUNT it.
    const result = normalizeClientPolicies({
      ...importedShape,
      id: "c3",
      carrier: "Foresters",
      premium: 50,
      custom_fields: { [ADDITIONAL_POLICIES_KEY]: "[object Object],[object Object]" },
    });

    expect(result.policies).toHaveLength(1); // the primary survives
    expect(result.policies[0].source).toBe("primary");
    expect(result.malformedAdditionalPolicies).toBe(1);
  });

  it("a non-object ELEMENT is skipped and counted, and its siblings still load", () => {
    const result = normalizeClientPolicies({
      ...importedShape,
      id: "c4",
      carrier: "Americo",
      premium: 10,
      custom_fields: {
        [ADDITIONAL_POLICIES_KEY]: [{ policyType: "Term", premiumAmount: "5" }, "corrupted", 42, null],
      },
    });

    expect(result.policies.filter((p) => p.source === "additional")).toHaveLength(1);
    expect(result.malformedAdditionalPolicies).toBe(3);
  });

  it("never throws on any shape, and an absent key is not a malformed one", () => {
    for (const customFields of [null, undefined, {}, [], "text", 7, { other: "field" }]) {
      const result = normalizeClientPolicies({ ...importedShape, carrier: "X", custom_fields: customFields });
      expect(result.malformedAdditionalPolicies).toBe(0);
    }
  });

  it("a user-created custom field of the same name is not read as policy data", () => {
    // custom_fields is a FLAT namespace keyed by canonical field name (AGENT_RULES #27), so the
    // key can collide with anything an agency names. Requiring an array of objects is the guard.
    const result = normalizeClientPolicies({
      ...importedShape,
      carrier: "X",
      custom_fields: { [ADDITIONAL_POLICIES_KEY]: "Yes" },
    });
    expect(result.policies.filter((p) => p.source === "additional")).toHaveLength(0);
  });
});

describe("normalizing a set of clients", () => {
  it("totals policies across primary and additional, and aggregates the data-quality counts", () => {
    const rows: ClientPolicyRow[] = [
      {
        ...importedShape,
        id: "a",
        carrier: "Mutual of Omaha",
        premium: 100.5,
        face_amount: 250000,
        sold_date: "2026-01-15",
        custom_fields: {
          [ADDITIONAL_POLICIES_KEY]: [
            { policyType: "Whole Life", carrier: "Americo", premiumAmount: "$25.25/mo" },
            "corrupted",
          ],
        },
      },
      importedShape, // contributes a client but no policy
      {
        ...importedShape,
        id: "c",
        carrier: "Foresters",
        premium: 50,
        custom_fields: { [ADDITIONAL_POLICIES_KEY]: "corrupted-container" },
      },
    ];

    const result = normalizeClientsToPolicies(rows);

    // 2 primaries + 1 additional. The imported row contributes none.
    expect(result.policies).toHaveLength(3);
    // One bad element + one bad container.
    expect(result.malformedAdditionalPolicies).toBe(2);

    const totalPremium = result.policies.reduce((sum, p) => sum + (p.premiumMonthly ?? 0), 0);
    expect(totalPremium).toBe(175.75);
    // Explicitly NOT annualized anywhere in this feature.
    expect(totalPremium).not.toBe(175.75 * 12);
  });
});
