/**
 * Rendering contracts: loading vs valid-empty vs FAILED, and responsive/theme behaviour.
 *
 * The defect this replaces is precise: the previous page swallowed every PostgREST error
 * (`callsRes.data || []`, AgentProfile.tsx:120-122), so an RLS denial rendered as a confident
 * "0 clients". These tests assert that a failure renders NO NUMBER AT ALL, and that a genuine zero
 * still renders as a zero — the two must stay distinguishable on screen, not just in the types.
 */

import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BusinessSnapshot } from "../BusinessSnapshot";
import { CarrierProductionCard } from "../CarrierProductionCard";
import { PolicyTypeMixCard } from "../PolicyTypeMixCard";
import { LicensingCard } from "../LicensingCard";
import { ReadinessCard } from "../ReadinessCard";
import { AchievementsCard } from "../AchievementsCard";
import { TeamReadinessCard } from "../team/TeamReadinessCard";
import { computeReadiness } from "@/lib/profile/profile-readiness";
import type { BookStats, TeamReadinessStats } from "@/lib/profile/profile-queries";

// BrandingContext reads Supabase on mount; the profile surface only needs its formatters.
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    branding: { companyName: "Synthetic Agency", logoUrl: null },
    formatDate: (d: string | null | undefined) => (d ? String(d) : ""),
    formatDateTime: (d: string) => String(d),
    formatTime: (d: string) => String(d),
    isLoading: false,
    refreshBranding: vi.fn(),
  }),
}));

// Recharts needs a measured container; jsdom reports 0x0 and would render nothing.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

afterEach(cleanup);

const ui = (node: React.ReactElement) => render(<MemoryRouter>{node}</MemoryRouter>);

const EMPTY_BOOK: BookStats = {
  scopeAgentCount: 1,
  totalClients: 0,
  clientsWithoutPolicyDetail: 0,
  totalPolicies: 0,
  additionalPolicyCount: 0,
  malformedAdditionalPolicies: 0,
  totalPremiumMonthly: 0,
  policiesMissingPremium: 0,
  undatedPolicies: 0,
  distinctCarriers: 0,
  distinctLicensedStates: 0,
  carrierBreakdown: [],
  carrierOverflowPolicies: 0,
  policyTypeMix: [],
  policyTypeOverflowPolicies: 0,
  achievements: {
    largestFace: null,
    largestPremium: null,
    bestPremiumMonth: null,
    mostPoliciesMonth: null,
    mostDialsDay: null,
  },
};

const FULL_BOOK: BookStats = {
  ...EMPTY_BOOK,
  totalClients: 6,
  totalPolicies: 8,
  additionalPolicyCount: 2,
  totalPremiumMonthly: 681.07,
  policiesMissingPremium: 1,
  undatedPolicies: 2,
  distinctCarriers: 3,
  distinctLicensedStates: 15,
  carrierBreakdown: [
    { carrier: "Mutual of Omaha", policies: 4, premiumMonthly: 400 },
    { carrier: "Americo", policies: 3, premiumMonthly: 200 },
    { carrier: null, policies: 1, premiumMonthly: 81.07 },
  ],
  policyTypeMix: [
    { policyType: "Final Expense", policies: 5, premiumMonthly: 400 },
    { policyType: "Whole Life", policies: 3, premiumMonthly: 281.07 },
  ],
  achievements: {
    largestFace: {
      faceAmount: 250000,
      carrier: "Mutual of Omaha",
      policyType: "Final Expense",
      soldDate: "2026-01-15",
    },
    largestPremium: {
      premiumMonthly: 200,
      carrier: "Americo",
      policyType: "Whole Life",
      soldDate: "2026-02-10",
    },
    bestPremiumMonth: { month: "2026-02", policies: 1, premiumMonthly: 200 },
    mostPoliciesMonth: { month: "2026-01", policies: 2, premiumMonthly: 125.75 },
    mostDialsDay: { day: "2026-01-15", dials: 312, timeZone: "America/Los_Angeles" },
  },
};

const BOOM = new Error("aggregate failed");

describe("a FAILED query never renders a number", () => {
  const cases: [string, React.ReactElement][] = [
    [
      "BusinessSnapshot",
      <BusinessSnapshot title="Business snapshot" stats={null} isLoading={false} error={BOOM} onRetry={vi.fn()} />,
    ],
    [
      "CarrierProductionCard",
      <CarrierProductionCard rows={null} overflowPolicies={0} isLoading={false} error={BOOM} onRetry={vi.fn()} />,
    ],
    [
      "PolicyTypeMixCard",
      <PolicyTypeMixCard rows={null} overflowPolicies={0} totalPolicies={0} isLoading={false} error={BOOM} onRetry={vi.fn()} />,
    ],
    [
      "AchievementsCard",
      <AchievementsCard stats={null} isLoading={false} error={BOOM} onRetry={vi.fn()} />,
    ],
    [
      "TeamReadinessCard",
      <TeamReadinessCard stats={null} isLoading={false} error={BOOM} onRetry={vi.fn()} />,
    ],
  ];

  it.each(cases)("%s shows the unavailable state, a retry, and no digits", (_name, element) => {
    const { container } = ui(element);

    expect(screen.getByText(/This is not a zero\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();

    // The decisive assertion: NOTHING numeric reaches the screen on a failure.
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/\d/);
  });
});

describe("a VALID EMPTY result is distinguishable from a failure", () => {
  it("renders honest zeros, not an error", () => {
    ui(
      <BusinessSnapshot
        title="Business snapshot"
        stats={EMPTY_BOOK}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByText(/This is not a zero\./)).toBeNull();
    // A zero CLIENT count is a real answer and is shown as 0.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // A zero PREMIUM is not: formatCurrencyValue's rule is blank, never a fabricated $0.
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("an empty book shows an explanatory empty state, not an error", () => {
    ui(
      <CarrierProductionCard rows={[]} overflowPolicies={0} isLoading={false} error={null} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/No policies on the book yet/)).toBeTruthy();
    expect(screen.queryByText(/This is not a zero\./)).toBeNull();
  });

  it("no unearned achievement is fabricated", () => {
    ui(<AchievementsCard stats={EMPTY_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText(/No records yet/)).toBeTruthy();
    expect(screen.queryByText(/Largest policy/)).toBeNull();
  });
});

describe("LOADING is distinguishable from both", () => {
  it("shows neither a figure nor an error while in flight", () => {
    const { container } = ui(
      <BusinessSnapshot title="Business snapshot" stats={null} isLoading error={null} onRetry={vi.fn()} />,
    );
    expect(screen.queryByText(/This is not a zero\./)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/\d/);
  });
});

describe("the real figures render with their definitions attached", () => {
  it("states that the premium total is monthly and counts the missing ones", () => {
    ui(
      <BusinessSnapshot title="Business snapshot" stats={FULL_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("$681.07")).toBeTruthy();
    // Never 681.07 x 12.
    expect(screen.queryByText("$8,172.84")).toBeNull();
    expect(screen.getByText(/Not annualized\./)).toBeTruthy();
    expect(screen.getByText(/1 policy has no premium recorded/)).toBeTruthy();
    expect(screen.getByText(/Includes 2 additional policies/)).toBeTruthy();
  });

  it("labels the carrier tile without claiming an appointment status that is not stored", () => {
    ui(
      <BusinessSnapshot title="Business snapshot" stats={FULL_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("Carriers")).toBeTruthy();
    expect(screen.queryByText(/active carriers/i)).toBeNull();
  });

  it("keeps the no-carrier bucket visible rather than dropping those policies", () => {
    ui(
      <CarrierProductionCard
        rows={FULL_BOOK.carrierBreakdown}
        overflowPolicies={0}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("No carrier recorded")).toBeTruthy();
  });

  it("names the time zone the dials record was measured in", () => {
    ui(<AchievementsCard stats={FULL_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText(/measured in America\/Los_Angeles/)).toBeTruthy();
  });

  it("reports the undated policies excluded from the monthly records", () => {
    ui(<AchievementsCard stats={FULL_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />);
    expect(
      screen.getByText(/2 policies have no sale date recorded and are excluded/),
    ).toBeTruthy();
  });

  it("shows milestones as progress and never as an awarded date", () => {
    ui(<AchievementsCard stats={FULL_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText(/Progress to next milestone/)).toBeTruthy();
    expect(screen.queryByText(/achieved on/i)).toBeNull();
    expect(screen.queryByText(/Top Producer/)).toBeNull();
  });
});

describe("licensing status mapping", () => {
  const license = (over: Partial<{ id: string; state: string; expiration_date: string | null; license_number: string | null }>) => ({
    id: over.id ?? "l1",
    agent_id: "a1",
    state: over.state ?? "CA",
    license_number: over.license_number ?? "L-1",
    expiration_date: over.expiration_date ?? null,
    created_at: "2026-01-01T00:00:00Z",
  });

  it("renders a NULL expiration as 'No expiration on file', never a green Active", () => {
    // This is the one behaviour the Settings card gets wrong, on 17 of 18 production rows.
    ui(
      <LicensingCard
        licenses={[license({ expiration_date: null }) as never]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        residentState={null}
        legacyLicensedStateCount={0}
      />,
    );
    expect(screen.getByText("No expiration on file")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("renders Active only for a licence with a future expiration date", () => {
    ui(
      <LicensingCard
        licenses={[license({ expiration_date: "2099-01-01" }) as never]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        residentState={null}
        legacyLicensedStateCount={0}
      />,
    );
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("marks the resident-state licence across mixed formats", () => {
    ui(
      <LicensingCard
        licenses={[license({ state: "California" }) as never]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        residentState="CA"
        legacyLicensedStateCount={0}
      />,
    );
    expect(screen.getByText("Resident")).toBeTruthy();
  });

  it("offers to migrate legacy states instead of showing a silent zero", () => {
    ui(
      <LicensingCard
        licenses={[]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        residentState="CA"
        legacyLicensedStateCount={7}
      />,
    );
    expect(screen.getByText(/No state licences recorded/)).toBeTruthy();
    expect(screen.getByText(/7 states were listed on your onboarding profile/)).toBeTruthy();
  });
});

describe("readiness presentation", () => {
  it("renders the unknown state as neither complete nor failed", () => {
    const summary = computeReadiness({
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      phone: "555",
      npn: "1",
      residentState: "",
      onboardingComplete: true,
      carrierAppointmentCount: 1,
      licenses: [],
      today: new Date("2026-09-19T00:00:00Z"),
    });

    ui(<ReadinessCard summary={summary} isLoading={false} error={null} onRetry={vi.fn()} />);

    const item = screen.getByText("Resident-state licence recorded").closest("li")!;
    expect(within(item).getByLabelText("Not applicable yet")).toBeTruthy();
  });
});

describe("responsive layout", () => {
  it.each([390, 768, 1440])("renders at %ipx with no fixed pixel widths that could overflow", (width) => {
    // jsdom does not lay out, so the meaningful check is structural: the grids are responsive
    // Tailwind classes and nothing is pinned to a width wider than a phone.
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });

    const { container } = ui(
      <BusinessSnapshot title="Business snapshot" stats={FULL_BOOK} isLoading={false} error={null} onRetry={vi.fn()} />,
    );

    const grid = container.querySelector(".grid")!;
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-5");

    for (const el of Array.from(container.querySelectorAll("[class]"))) {
      // getAttribute, not .className: on an SVG element className is an SVGAnimatedString.
      const cls = el.getAttribute("class") ?? "";
      // A `w-[NNNpx]` or `min-w-[NNNpx]` above 360 would overflow the narrowest supported width.
      // `max-w-[...]` is a CEILING, not a floor, so it is excluded by the leading boundary.
      for (const match of cls.matchAll(/(?:^|\s)(?:min-)?w-\[(\d+)px\]/g)) {
        expect(Number(match[1])).toBeLessThanOrEqual(360);
      }
    }
  });
});
