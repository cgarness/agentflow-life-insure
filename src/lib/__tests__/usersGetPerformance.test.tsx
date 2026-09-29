/**
 * usersApi.getPerformance `appointmentsSet` / `appsMonth` = Appointments Set (AGENT_RULES #23 / #38): booked this
 * month by the user, credited COALESCE(created_by, user_id), no status filter. UserProfileModal passes `appsMonth`
 * to UserGoalsTab as the Monthly Appointments actual, so the render check pins that path too.
 *
 * Rows are evaluated in memory from the filters the reader actually emits (appointmentRowsFixture).
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedQuery, Row } from "@/lib/__tests__/appointmentRowsFixture";

const h = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  queries: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { RecordedQuery } = await import("@/lib/__tests__/appointmentRowsFixture");
  return {
    supabase: {
      from: (table: string) => {
        const q = new RecordedQuery(table, h.rows[table] ?? []);
        h.queries.push(q);
        return q;
      },
    },
  };
});

import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import UserGoalsTab from "@/components/settings/user-management/UserGoalsTab";
import { ASSIGNEE_B, OTHER_C, SETTER_A, appointmentSetRows } from "@/lib/__tests__/appointmentRowsFixture";

const monthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};
const setAppointments = (appointments: Row[]) => {
  h.rows = { appointments, calls: [], wins: [] };
};
const apptQuery = () => (h.queries as RecordedQuery[]).find((q) => q.table === "appointments") as RecordedQuery;

beforeEach(() => {
  h.queries = [];
});
afterEach(() => {
  cleanup();
});

describe("usersApi.getPerformance — appointmentsSet is setter credit", () => {
  it.each([
    [SETTER_A, 6, "the setter: delegated, self-booked and later cancelled / no-show / completed / rescheduled all count"],
    [ASSIGNEE_B, 1, "the assignee of a delegated booking: only the legacy created_by-NULL row"],
    [OTHER_C, 1, "the booker of an appointment assigned to A"],
  ])("%s → %i (%s)", async (userId, expected) => {
    setAppointments(appointmentSetRows(monthStart()));
    const perf = await usersApi.getPerformance(userId as string);
    expect(perf.appointmentsSet).toBe(expected);
    expect(perf.appsMonth).toBe(expected);
  });

  it("a self-booked appointment counts exactly once", async () => {
    setAppointments(appointmentSetRows(monthStart()).filter((r) => r.id === "a3-self"));
    expect((await usersApi.getPerformance(SETTER_A)).appointmentsSet).toBe(1);
  });

  it("emits the booking window and setter filter, with no user_id-only or status filter", async () => {
    setAppointments([]);
    await usersApi.getPerformance(SETTER_A);
    const q = apptQuery();
    expect(q.calls).toContainEqual(["or", `created_by.eq.${SETTER_A},and(created_by.is.null,user_id.eq.${SETTER_A})`]);
    expect(q.calls).toContainEqual(["gte", "created_at", monthStart().toISOString()]);
    expect(q.calls.some(([m]) => m === "not")).toBe(false);
    expect(q.calls.some(([m, col]) => m === "eq" && col === "user_id")).toBe(false);
  });

  it("an invalid user id rejects before any read is sent", async () => {
    setAppointments(appointmentSetRows(monthStart()));
    await expect(usersApi.getPerformance("not-a-uuid")).rejects.toThrow();
    expect((h.queries as RecordedQuery[]).some((q) => q.executed)).toBe(false);
  });
});

describe("UserGoalsTab renders the reconciled Monthly Appointments actual", () => {
  it("shows the setter-credit count UserProfileModal passes as appsMonth", async () => {
    setAppointments(appointmentSetRows(monthStart()));
    const perf = await usersApi.getPerformance(SETTER_A);
    render(
      <UserGoalsTab
        form={{ monthlyCallGoal: 0, monthlyPoliciesGoal: 0, monthlyAppointmentGoal: 10, monthlyPremiumGoal: 0 }}
        setForm={() => {}}
        goalActuals={{ callsMonth: perf.callsMonthly, policiesMonth: perf.policiesMonthly, appointmentsMonth: perf.appsMonth, premiumMonth: perf.premiumMonthly }}
        perfLoading={false}
        saving={false}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText("Monthly Appointments Goal")).toBeInTheDocument();
    // Only the appointments goal has a target, so "6 / 10" can only be its status line.
    expect(screen.getByText("6 / 10")).toBeInTheDocument();
  });
});
