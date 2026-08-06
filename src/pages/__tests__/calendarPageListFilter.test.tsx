import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarAppointment } from "@/contexts/CalendarContext";

/**
 * Scope proof for the Calendar List callback filter: dialer-generated
 * callback records are hidden from the List tab ONLY — the Day (and by the
 * same code path Month/Week/Agenda) rendering of the shared context array is
 * untouched.
 */

const h = vi.hoisted(() => ({
  calendarState: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/CalendarContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCalendar: () => h.calendarState,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "aaaa0000-0000-0000-0000-000000000001" } }),
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "0f000000-0000-0000-0000-0000000000aa" }),
}));

vi.mock("@/hooks/useAppointmentTypes", () => ({
  useAppointmentTypes: () => ({ types: [] }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (d: Date) => d.toDateString(),
    formatDateTime: (d: Date) => d.toISOString(),
    formatTime: (d: Date) => d.toISOString(),
  }),
}));

vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/calendar/AppointmentModal", () => ({
  default: () => null,
}));

vi.mock("@/components/contacts/FullScreenContactView", () => ({
  default: () => null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "gte", "lte", "or", "order", "limit", "insert", "update", "delete"]) q[m] = chain;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: null, error: null });
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return {
    supabase: {
      from: () => makeQuery(),
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    },
  };
});

import CalendarPage from "@/pages/CalendarPage";

// All fixtures land on "today" so the Day view (which filters by currentDate)
// renders every row.
const today = new Date();
const appt = (over: Partial<CalendarAppointment>): CalendarAppointment => ({
  id: "x",
  title: "Untitled",
  type: "Sales Call",
  status: "Scheduled",
  date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  startTime: "10:00 AM",
  endTime: "11:00 AM",
  contactName: "Test Contact",
  contactId: "lead-1",
  agent: "",
  notes: "",
  ...over,
});

const FIXTURE: CalendarAppointment[] = [
  appt({ id: "r1", title: "Policy review with Marcus", type: "Policy Review" }),
  appt({ id: "r2", title: "Quarterly check-in", type: "Follow Up" }),
  appt({ id: "r3", title: "Annual review", status: "Completed" }),
  appt({ id: "r4", title: "Callback Review Meeting" }),
  appt({ id: "r5", title: "Cancelled consult", status: "Cancelled" }),
  appt({ id: "c1", title: "Callback" }),
  appt({ id: "c2", title: "Callback: Jane Doe" }),
  appt({
    id: "c3",
    title: "Prep call",
    notes: "Callback scheduled from dialer. Disposition: Interested",
  }),
];

const baseCalendarState = () => ({
  appointments: FIXTURE,
  loading: false,
  addAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  deleteAppointment: vi.fn(),
  fetchAppointments: vi.fn().mockResolvedValue(undefined),
  todayCount: FIXTURE.length,
});

const renderView = (view: "List" | "Day") =>
  render(
    <MemoryRouter initialEntries={[`/calendar?view=${view}`]}>
      <CalendarPage />
    </MemoryRouter>
  );

beforeEach(() => {
  h.calendarState = baseCalendarState();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The Agenda sidebar renders beside every view (jsdom applies no responsive
// CSS), so queries must be scoped: the List table via role, the Agenda/Day
// content via the full document.
describe("Calendar List tab callback filtering", () => {
  it("List table shows real appointments and hides dialer callback records; Agenda beside it stays unfiltered", async () => {
    renderView("List");
    await screen.findAllByText("Policy review with Marcus");

    const table = within(screen.getByRole("table"));

    // Real appointments — including a legitimate Follow Up, Completed and
    // Cancelled rows, and a near-miss title — all render in the List table.
    expect(table.getByText("Policy review with Marcus")).toBeTruthy();
    expect(table.getByText("Quarterly check-in")).toBeTruthy();
    expect(table.getByText("Annual review")).toBeTruthy();
    expect(table.getByText("Callback Review Meeting")).toBeTruthy();
    expect(table.getByText("Cancelled consult")).toBeTruthy();

    // Dialer callback signatures — hidden from the List table.
    expect(table.queryByText("Callback")).toBeNull();
    expect(table.queryByText("Callback: Jane Doe")).toBeNull();
    expect(table.queryByText("Prep call")).toBeNull();

    // Same render, outside the table: the Agenda sidebar still shows the
    // callback rows — the filter is List-table-only.
    expect(screen.getAllByText("Callback").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Callback: Jane Doe").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Prep call").length).toBeGreaterThan(0);
  });

  it("Day view still shows every row, callbacks included (unchanged behavior)", async () => {
    renderView("Day");
    await screen.findAllByText("Policy review with Marcus");

    // Every title must appear exactly twice: once in the Day content and once
    // in the Agenda sidebar. A count of 1 would mean the filter leaked into
    // one of the two unfiltered surfaces (or Day view failed to activate).
    for (const title of [
      "Policy review with Marcus",
      "Quarterly check-in",
      "Annual review",
      "Callback Review Meeting",
      "Cancelled consult",
      "Callback",
      "Callback: Jane Doe",
      "Prep call",
    ]) {
      expect(screen.getAllByText(title)).toHaveLength(2);
    }
  });

  it("List view does not mutate the shared context array", async () => {
    const shared = h.calendarState.appointments as CalendarAppointment[];
    const refs = [...shared];

    renderView("List");
    await screen.findAllByText("Policy review with Marcus");

    expect(shared).toHaveLength(FIXTURE.length);
    shared.forEach((el, i) => expect(el).toBe(refs[i]));
  });
});
