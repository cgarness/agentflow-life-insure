/**
 * GoalProgressWidget "Monthly Appointments" = Appointments Set (AGENT_RULES #23 / #38): booked this month by
 * the viewer, credited COALESCE(created_by, user_id), with no status filter — delegated bookings credit the
 * setter, legacy rows without created_by credit user_id, and a later outcome never removes the credit.
 *
 * Rows are evaluated in memory from the filters the widget actually emits (appointmentRowsFixture).
 */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedQuery, Row } from "@/lib/__tests__/appointmentRowsFixture";

const h = vi.hoisted(() => ({
  rows: { appointments: [] as Record<string, unknown>[] } as Record<string, Record<string, unknown>[]>,
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

import GoalProgressWidget from "@/components/dashboard/widgets/GoalProgressWidget";
import { resetDashboardSectionLanes } from "@/lib/dashboardRefresh";
import { ASSIGNEE_B, OTHER_C, SETTER_A, appointmentSetRows } from "@/lib/__tests__/appointmentRowsFixture";

const GOAL = 10;
const monthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};
const profileFor = (id: string): Row => ({
  id,
  monthly_call_goal: 0,
  monthly_policies_goal: 0,
  monthly_appointment_goal: GOAL,
  monthly_premium_goal: 0,
});

function setRows(appointments: Row[], viewer: string) {
  h.rows = { appointments, profiles: [profileFor(viewer)], calls: [], wins: [] };
}

async function monthlyAppointmentsFor(viewer: string): Promise<string> {
  render(
    <MemoryRouter>
      <GoalProgressWidget userId={viewer} />
    </MemoryRouter>,
  );
  const label = await screen.findByText("Monthly Appointments");
  const row = label.closest("div.space-y-2") as HTMLElement;
  return row.textContent ?? "";
}

const apptQuery = () =>
  (h.queries as RecordedQuery[]).find((q) => q.table === "appointments") as RecordedQuery;

beforeEach(() => {
  resetDashboardSectionLanes();
  h.queries = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  resetDashboardSectionLanes();
  vi.restoreAllMocks();
});

describe("GoalProgressWidget — Monthly Appointments is setter credit", () => {
  it("A booked six this month (one delegated to B, some since cancelled / no-show / completed / rescheduled): 6 / 10", async () => {
    setRows(appointmentSetRows(monthStart()), SETTER_A);
    expect(await monthlyAppointmentsFor(SETTER_A)).toContain(`6 / ${GOAL}`);
  });

  it("B, the assignee of A's delegated booking, is NOT credited for it; B's legacy row (created_by NULL) is: 1 / 10", async () => {
    setRows(appointmentSetRows(monthStart()), ASSIGNEE_B);
    expect(await monthlyAppointmentsFor(ASSIGNEE_B)).toContain(`1 / ${GOAL}`);
  });

  it("an appointment C booked for A credits C, not A", async () => {
    setRows(appointmentSetRows(monthStart()), OTHER_C);
    expect(await monthlyAppointmentsFor(OTHER_C)).toContain(`1 / ${GOAL}`);
  });

  it("a self-booked appointment counts exactly once", async () => {
    setRows(appointmentSetRows(monthStart()).filter((r) => r.id === "a3-self"), SETTER_A);
    expect(await monthlyAppointmentsFor(SETTER_A)).toContain(`1 / ${GOAL}`);
  });

  it("emits the booking window and setter filter, with no user_id-only or status filter", async () => {
    setRows([], SETTER_A);
    await monthlyAppointmentsFor(SETTER_A);
    const q = apptQuery();
    expect(q.calls).toContainEqual(["or", `created_by.eq.${SETTER_A},and(created_by.is.null,user_id.eq.${SETTER_A})`]);
    expect(q.calls).toContainEqual(["gte", "created_at", monthStart().toISOString()]);
    expect(q.calls.some(([m]) => m === "not")).toBe(false);
    expect(q.calls.some(([m, col]) => m === "eq" && col === "user_id")).toBe(false);
    expect(q.calls.some(([, col]) => col === "start_time")).toBe(false);
  });

  it("an invalid viewer id fails the section instead of counting every visible row", async () => {
    setRows(appointmentSetRows(monthStart()), SETTER_A);
    render(
      <MemoryRouter>
        <GoalProgressWidget userId="not-a-uuid" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Couldn't load goal progress")).toBeInTheDocument());
    expect((h.queries as RecordedQuery[]).some((q) => q.table === "appointments" && q.executed)).toBe(false);
  });
});
