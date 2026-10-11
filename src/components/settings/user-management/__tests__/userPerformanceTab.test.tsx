/**
 * V2 simple labels on the user Performance tab: "Appointments" (the created-date setter-credit count, month to
 * date) and "Policies / 100 Calls", matching the Leaderboard. Values pass through unchanged; failure stays an
 * error message and loading stays a skeleton, never zeros.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import UserPerformanceTab from "@/components/settings/user-management/UserPerformanceTab";

afterEach(cleanup);

const performance = { callsMonthly: 120, policiesMonthly: 4, appsMonth: 7, totalTalkTime: "2h 0m 0s", conversionRate: "3.3", timeZone: "America/Chicago", unknownPremiums: 0 };
const form = { monthlyCallGoal: 200, monthlyPoliciesGoal: 8, monthlyAppointmentGoal: 10 };
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement as HTMLElement;

describe("UserPerformanceTab labels", () => {
  it("shows the simple metric names with their unchanged values", () => {
    render(<UserPerformanceTab performance={performance} perfLoading={false} form={form} />);
    expect(tile("Calls Made")).toHaveTextContent("120");
    expect(tile("Policies Sold")).toHaveTextContent("4");
    expect(tile("Appointments")).toHaveTextContent("7");
    expect(tile("Talk Time")).toHaveTextContent("2h 0m 0s");
    expect(tile("Policies / 100 Calls")).toHaveTextContent("3.3");
    expect(screen.queryByText(/Appointments Set|Policies per 100 Calls/)).not.toBeInTheDocument();
  });

  it("keeps the failed and loading states distinct from a zero", () => {
    const failed = render(<UserPerformanceTab performance={null} perfLoading={false} form={form} />);
    expect(screen.getByText("Data failed to load. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Appointments")).not.toBeInTheDocument();
    failed.unmount();
    const { container } = render(<UserPerformanceTab performance={null} perfLoading form={form} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });
});
