/**
 * D14 on Settings › User Management › Goals: a month whose every premium is unknown has no premium actual, so the
 * Monthly Premium Goal shows the tab's existing unavailable "—", never "$0.00 / goal" and 0%. No policies and known
 * premiums totalling $0 keep their real $0.00; the other goals are unchanged.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import UserGoalsTab from "@/components/settings/user-management/UserGoalsTab";
import { goalActualsFrom } from "@/components/settings/user-management/userManagementUtils";

afterEach(cleanup);

const performance = (over: Record<string, number>) => ({ callsMonthly: 40, policiesMonthly: 2, appsMonth: 3, premiumMonthly: 0, unknownPremiums: 0, ...over });
const form = { monthlyCallGoal: 100, monthlyPoliciesGoal: 4, monthlyAppointmentGoal: 6, monthlyPremiumGoal: 5000 };
const premiumGoal = (premiumMonth: number | null) => {
  render(<UserGoalsTab form={form} setForm={() => {}} goalActuals={{ ...goalActualsFrom(performance({})), premiumMonth }} perfLoading={false} saving={false} onSave={() => {}} />);
  return screen.getByText("Monthly Premium Goal ($)").closest(".rounded-xl") as HTMLElement;
};

describe("goalActualsFrom (D14)", () => {
  it.each([
    ["every premium unknown: no premium actual", { policiesMonthly: 2, unknownPremiums: 2, premiumMonthly: 0 }, null],
    ["no policies: the real $0", { policiesMonthly: 0, unknownPremiums: 0, premiumMonthly: 0 }, 0],
    ["known premiums totalling $0: a genuine zero", { policiesMonthly: 2, unknownPremiums: 0, premiumMonthly: 0 }, 0],
    ["partly known: the known subtotal", { policiesMonthly: 3, unknownPremiums: 1, premiumMonthly: 200 }, 200],
  ])("%s", (_case, over, expected) => {
    expect(goalActualsFrom(performance(over)).premiumMonth).toBe(expected);
  });

  it("keeps the other actuals, and maps a missing performance to all unavailable", () => {
    expect(goalActualsFrom(performance({ policiesMonthly: 2, unknownPremiums: 2 }))).toEqual({ callsMonth: 40, policiesMonth: 2, appointmentsMonth: 3, premiumMonth: null });
    expect(goalActualsFrom(null)).toEqual({ callsMonth: null, policiesMonth: null, appointmentsMonth: null, premiumMonth: null });
  });
});

describe("Monthly Premium Goal display", () => {
  it("an unavailable actual reads — with no percentage; a real $0 reads $0.00 and 0%", () => {
    const unavailable = premiumGoal(goalActualsFrom(performance({ policiesMonthly: 2, unknownPremiums: 2 })).premiumMonth);
    expect(unavailable).toHaveTextContent("— / $5,000.00");
    expect(unavailable).not.toHaveTextContent("$0.00 /");
    expect(unavailable).not.toHaveTextContent("0%");
    cleanup();
    const zero = premiumGoal(goalActualsFrom(performance({ policiesMonthly: 2, unknownPremiums: 0 })).premiumMonth);
    expect(zero).toHaveTextContent("$0.00 / $5,000.00");
    expect(zero).toHaveTextContent("0%");
  });
});
