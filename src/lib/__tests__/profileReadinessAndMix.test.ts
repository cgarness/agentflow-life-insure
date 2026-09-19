/**
 * Readiness computation, policy-type grouping and the display formatters.
 *
 * Three rules these pin, each of which the page would otherwise get quietly wrong:
 *
 *  1. A LICENCE WITH NO EXPIRATION DATE IS NOT EVIDENCE OF CURRENCY. In production 17 of 18 rows
 *     have a null `expiration_date`, and the existing Settings card paints all of them green
 *     "Active" (ProfileStateLicensesCard.tsx:350-356). Readiness must pass the "no expired
 *     licences" check on an absence of evidence, but SAY SO.
 *  2. RESIDENT-STATE MATCHING MUST NORMALIZE BOTH SIDES. `profiles.resident_state` is a FULL NAME
 *     from Settings and a 2-LETTER CODE from User Management, and `agent_state_licenses.state`
 *     holds both forms in production.
 *  3. POLICY-TYPE GROUPING IS DETERMINISTIC, AND "Not specified" IS NOT "Other".
 */

import { describe, expect, it } from "vitest";
import { computeReadiness } from "@/lib/profile/profile-readiness";
import {
  NOT_SPECIFIED_LABEL,
  OTHER_LABEL,
  POLICY_TYPE_TOP_N,
  buildPolicyTypeSlices,
} from "@/lib/profile/policy-type-slices";
import {
  formatCount,
  formatMonthBucket,
  formatMonthlyCurrency,
  formatWholeCurrency,
} from "@/lib/profile/profile-format";
import { buildProfileMilestones } from "@/lib/profile/profile-milestones";

const TODAY = new Date("2026-09-19T12:00:00Z");

const fullyReady = {
  firstName: "Chris",
  lastName: "Garness",
  email: "a@b.com",
  phone: "5551234567",
  npn: "123456",
  residentState: "California",
  onboardingComplete: true,
  carrierAppointmentCount: 2,
  licenses: [{ state: "CA", expiration_date: "2030-01-01" }],
  today: TODAY,
};

describe("computeReadiness", () => {
  it("reports fully ready when every check passes", () => {
    const r = computeReadiness(fullyReady);
    expect(r.isFullyReady).toBe(true);
    expect(r.percent).toBe(100);
    expect(r.checks.every((c) => c.state === "complete")).toBe(true);
  });

  it("matches a resident-state licence across MIXED formats", () => {
    // Settings writes "California"; the licence row says "CA". Both sides normalize or the match
    // silently misses for every admin-edited agent.
    const nameVsCode = computeReadiness({ ...fullyReady, residentState: "California", licenses: [{ state: "CA", expiration_date: null }] });
    const codeVsName = computeReadiness({ ...fullyReady, residentState: "CA", licenses: [{ state: "California", expiration_date: null }] });

    for (const r of [nameVsCode, codeVsName]) {
      expect(r.checks.find((c) => c.id === "resident-license")!.state).toBe("complete");
    }
  });

  it("marks the resident-licence check UNKNOWN when no resident state is set, not failed", () => {
    // Otherwise one missing field is counted as two failures.
    const r = computeReadiness({ ...fullyReady, residentState: "", licenses: [] });
    const check = r.checks.find((c) => c.id === "resident-license")!;
    expect(check.state).toBe("unknown");
    // An unknown check is excluded from BOTH sides of the ratio.
    expect(r.totalCount).toBe(r.checks.filter((c) => c.state !== "unknown").length);
  });

  it("flags an expired licence as outstanding", () => {
    const r = computeReadiness({
      ...fullyReady,
      licenses: [{ state: "CA", expiration_date: "2026-09-18" }],
    });
    const check = r.checks.find((c) => c.id === "licenses-current")!;
    expect(check.state).toBe("incomplete");
    expect(check.detail).toContain("1 licence");
  });

  it("PASSES the currency check on a null expiration date, but SAYS the evidence is missing", () => {
    const r = computeReadiness({
      ...fullyReady,
      licenses: [
        { state: "CA", expiration_date: null },
        { state: "TX", expiration_date: null },
      ],
    });
    const check = r.checks.find((c) => c.id === "licenses-current")!;
    expect(check.state).toBe("complete");
    expect(check.detail).toBe("2 licences have no expiration date on file.");
  });

  it("treats onboarding_complete as ONE coarse factor", () => {
    const r = computeReadiness({ ...fullyReady, onboardingComplete: false });
    const onboarding = r.checks.filter((c) => c.id === "onboarding");
    expect(onboarding).toHaveLength(1);
    expect(onboarding[0].state).toBe("incomplete");
    // Every other check is unaffected — it is a factor, not a gate.
    expect(r.checks.filter((c) => c.state === "complete").length).toBe(r.checks.length - 1);
  });

  it("invents no compliance requirement", () => {
    const ids = computeReadiness(fullyReady).checks.map((c) => c.id);
    expect(ids).toEqual([
      "onboarding",
      "identity",
      "npn",
      "resident-state",
      "resident-license",
      "licenses-current",
      "carriers",
    ]);
    const labels = computeReadiness(fullyReady).checks.map((c) => c.label.toLowerCase()).join(" ");
    for (const invented of ["e&o", "aml", "background", "contracting", "certification"]) {
      expect(labels).not.toContain(invented);
    }
  });

  it("uses absolute settings paths, because setSearchParams is route-relative", () => {
    for (const check of computeReadiness({ ...fullyReady, npn: "" }).checks) {
      if (check.actionPath) expect(check.actionPath.startsWith("/")).toBe(true);
    }
  });
});

describe("buildPolicyTypeSlices", () => {
  const row = (policyType: string | null, policies: number, premiumMonthly = policies * 10) => ({
    policyType,
    policies,
    premiumMonthly,
  });

  it("shows every type individually when there are few enough", () => {
    const { slices, groupedTypeCount } = buildPolicyTypeSlices(
      [row("Final Expense", 5), row("Whole Life", 2)],
      0,
    );
    expect(slices.map((s) => s.label)).toEqual(["Final Expense", "Whole Life"]);
    expect(groupedTypeCount).toBe(0);
  });

  it("rolls everything past the top N into ONE Other slice and says how many types that is", () => {
    const rows = Array.from({ length: POLICY_TYPE_TOP_N + 3 }, (_, i) =>
      row(`Type ${i}`, POLICY_TYPE_TOP_N + 3 - i),
    );
    const { slices, groupedTypeCount } = buildPolicyTypeSlices(rows, 0);

    expect(slices).toHaveLength(POLICY_TYPE_TOP_N + 1);
    expect(slices[slices.length - 1].label).toBe(OTHER_LABEL);
    expect(groupedTypeCount).toBe(3);
    // The legend still sums to the full policy count — grouping never loses policies.
    expect(slices.reduce((sum, s) => sum + s.policies, 0)).toBe(
      rows.reduce((sum, r) => sum + r.policies, 0),
    );
  });

  it("folds SERVER-SIDE overflow into the same Other slice, so truncation is never silent", () => {
    const { slices } = buildPolicyTypeSlices([row("Final Expense", 5)], 17);
    const other = slices.find((s) => s.label === OTHER_LABEL)!;
    expect(other.policies).toBe(17);
    expect(slices.reduce((sum, s) => sum + s.policies, 0)).toBe(22);
  });

  it("keeps a blank type as its own 'Not specified' slice, NOT inside Other", () => {
    const { slices } = buildPolicyTypeSlices([row("Final Expense", 5), row(null, 3)], 0);
    const labels = slices.map((s) => s.label);
    expect(labels).toContain(NOT_SPECIFIED_LABEL);
    expect(labels).not.toContain(OTHER_LABEL);
  });

  it("orders totally, so the same book always produces the same chart", () => {
    const rows = [row("B", 3, 10), row("A", 3, 10), row("C", 5, 1)];
    const first = buildPolicyTypeSlices(rows, 0).slices.map((s) => s.label);
    const second = buildPolicyTypeSlices([...rows].reverse(), 0).slices.map((s) => s.label);
    expect(first).toEqual(second);
    expect(first).toEqual(["C", "A", "B"]);
  });

  it("uses only theme tokens for slice colours — no raw hex", () => {
    const { slices } = buildPolicyTypeSlices([row("A", 1), row("B", 1)], 0);
    for (const s of slices) {
      expect(s.color).toMatch(/^hsl\(var\(--[a-z-]+\)\)$/);
    }
  });
});

describe("formatters", () => {
  it("never renders a fabricated $0 for a missing or zero amount", () => {
    for (const blank of [0, null, undefined, NaN]) {
      expect(formatMonthlyCurrency(blank)).toBe("—");
      expect(formatWholeCurrency(blank)).toBe("—");
    }
    expect(formatMonthlyCurrency(100.5)).toBe("$100.50");
    expect(formatWholeCurrency(250000)).toBe("$250,000");
  });

  it("renders a zero COUNT as 0, because zero clients is a real answer", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(null)).toBe("—");
  });

  it("formats month buckets in UTC so a January bucket cannot slip into December", () => {
    expect(formatMonthBucket("2026-01")).toBe("January 2026");
    expect(formatMonthBucket("not-a-bucket")).toBe("not-a-bucket");
  });
});

describe("buildProfileMilestones", () => {
  const input = {
    totalClients: 6,
    totalPolicies: 8,
    totalPremiumMonthly: 681.07,
    distinctLicensedStates: 3,
    isTeam: false,
  };

  it("reports progress toward the next round number and never an achieved date", () => {
    const milestones = buildProfileMilestones(input, formatCount);
    expect(milestones.map((m) => m.label)).toEqual([
      "Clients",
      "Policies",
      "Monthly premium",
      "Licensed states",
    ]);
    for (const m of milestones) {
      expect(m.current).toBeLessThanOrEqual(m.target);
      expect(Object.keys(m)).not.toContain("achievedAt");
      expect(Object.keys(m)).not.toContain("date");
    }
  });

  it("uses a higher ladder for a team, which aggregates many books", () => {
    const solo = buildProfileMilestones(input, formatCount)[0].target;
    const team = buildProfileMilestones({ ...input, isTeam: true }, formatCount)[0].target;
    expect(team).toBeGreaterThan(solo);
  });

  it("caps at the highest target once every threshold is passed", () => {
    const m = buildProfileMilestones(
      { ...input, totalClients: 100_000, isTeam: false },
      formatCount,
    )[0];
    expect(m.target).toBe(500);
    expect(m.current).toBe(100_000);
  });
});
