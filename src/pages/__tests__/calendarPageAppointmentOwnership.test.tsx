/**
 * CalendarPage.handleSave — appointment ownership (plan 2026-09-28-contact-followups §4.3, AGENT_RULES #22).
 *
 *   appointments.user_id    = the RESPONSIBLE person picked in the modal (the reminder recipient)
 *   appointments.created_by = the SCHEDULER, stamped once by CalendarContext.addAppointment, never rewritten
 *
 * Before the fix CalendarPage built ONE `localPayload` for both paths with `user_id: user.id` and
 * `created_by: user.id`, so an Admin booking for Agent A saved the Admin as the owner, and every edit
 * silently re-assigned the row to the editor and rewrote its scheduler.
 *
 * Harness: the REAL CalendarPage renders the List view. AppointmentModal is replaced by a recorder that
 * captures the props CalendarPage hands it (`open`, `editing`, `onSave`), so each test drives the page's
 * own `handleSave` closure exactly as the modal would. Clicking a List row drives the real `openEdit`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, within, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalendarAppointment } from "@/contexts/CalendarContext";

type SaveData = Omit<CalendarAppointment, "id">;
type ModalProps = {
  open: boolean;
  editing?: CalendarAppointment | null;
  onSave: (data: SaveData) => void | boolean | Promise<boolean | void>;
};

const ids = vi.hoisted(() => ({
  ADMIN: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  AGENT_A: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  AGENT_B: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  QUICK_CALLER: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
  ORG: "0f000000-0000-4000-8000-0000000000aa",
  LEAD: "11111111-1111-4111-8111-111111111111",
  EXISTING_APPT: "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0",
  NULL_OWNER_APPT: "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
  NEW_APPT: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
  LEAD_EMAIL: "charlotte@example.com",
}));

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  organizationId: null as string | null,
  calendarState: {} as Record<string, unknown>,
  /** Latest props CalendarPage rendered AppointmentModal with. */
  modal: null as ModalProps | null,
  googleStatus: null as Record<string, unknown> | null,
  toast: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/contexts/CalendarContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCalendar: () => h.calendarState,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: h.organizationId }),
}));

vi.mock("@/hooks/useAppointmentTypes", () => ({
  useAppointmentTypes: () => ({ types: [] }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: h.toast,
  useToast: () => ({ toast: h.toast }),
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

/** Records the props CalendarPage passes; renders nothing interactive. */
vi.mock("@/components/calendar/AppointmentModal", () => ({
  default: (props: ModalProps) => {
    h.modal = props;
    return null;
  },
}));

vi.mock("@/components/contacts/FullScreenContactView", () => ({
  default: () => null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "gte", "lte", "or", "order", "limit", "insert", "update", "delete", "in", "not", "is"]) {
      q[m] = chain;
    }
    // resolveAttendeeEmail: leads.select("email").eq(id).eq(org).maybeSingle()
    const single = () =>
      Promise.resolve(table === "leads" ? { data: { email: ids.LEAD_EMAIL }, error: null } : { data: null, error: null });
    q.maybeSingle = single;
    q.single = single;
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => makeQuery(table),
      functions: { invoke: h.invoke },
    },
  };
});

import CalendarPage from "@/pages/CalendarPage";

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const APPT_DAY = new Date(2026, 9, 5); // Oct 5 2026, local midnight — never "today", so the Agenda stays empty

const row = (over: Partial<CalendarAppointment>): CalendarAppointment => ({
  id: ids.EXISTING_APPT,
  title: "Policy review with Charlotte",
  type: "Policy Review",
  status: "Scheduled",
  date: APPT_DAY,
  startTime: "10:00 AM",
  endTime: "11:00 AM",
  contactName: "Charlotte Kearney",
  contactId: ids.LEAD,
  agent: "",
  notes: "",
  ...over,
});

/** Agent A's appointment, booked by the Admin. */
const ASSIGNED_ROW = row({ user_id: ids.AGENT_A, created_by: ids.ADMIN });
/** A FloatingDialer quick-call row: user_id NULL, created_by = the agent who booked it (#22 fallback). */
const NULL_OWNER_ROW = row({
  id: ids.NULL_OWNER_APPT,
  title: "Quick-call follow-up with Dana",
  contactName: "Dana Quill",
  user_id: null as unknown as string,
  created_by: ids.QUICK_CALLER,
});

/** What AppointmentModal emits (its `handleSave` shape). */
const modalData = (over: Partial<SaveData> = {}): SaveData => ({
  title: "Policy review with Charlotte",
  type: "Policy Review",
  status: "Confirmed",
  contactName: "Charlotte Kearney",
  contactId: ids.LEAD,
  date: new Date(2026, 9, 5),
  startTime: "2:30 PM",
  endTime: "3:15 PM",
  agent: "Alice Agent",
  notes: "Bring the renewal quote",
  ...over,
});

/** The appointment columns CalendarPage derives from `modalData()` — local wall-clock times, TZ-independent. */
const expectedFields = () => ({
  title: "Policy review with Charlotte",
  contact_name: "Charlotte Kearney",
  contact_id: ids.LEAD,
  type: "Policy Review",
  start_time: new Date(2026, 9, 5, 14, 30, 0, 0).toISOString(),
  end_time: new Date(2026, 9, 5, 15, 15, 0, 0).toISOString(),
  notes: "Bring the renewal quote",
  status: "Confirmed",
  sync_source: "internal",
});

// ---------------------------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------------------------

const addAppointment = () => h.calendarState.addAppointment as ReturnType<typeof vi.fn>;
const updateAppointment = () => h.calendarState.updateAppointment as ReturnType<typeof vi.fn>;

const googleSyncCalls = () =>
  h.invoke.mock.calls.filter(([name]) => name === "google-calendar-sync-appointment") as Array<
    [string, { body: Record<string, unknown> }]
  >;

const toastArgs = () => h.toast.mock.calls.map(([arg]) => arg as { title?: string; description?: string; variant?: string });

async function renderCalendar() {
  render(
    <MemoryRouter initialEntries={["/calendar?view=List"]}>
      <CalendarPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("google-calendar-status", expect.anything()));
  if (h.googleStatus?.connected) {
    // Two-way mode renders the Sync Now button — proof that `googleConnected` is true in the
    // closure the modal now holds (handleSave reads it from render state).
    await screen.findByTitle("Import new Google Calendar events into AgentFlow");
  }
  await act(async () => {});
  expect(h.modal).not.toBeNull();
}

/** Drives the real `openSchedule` through the header Schedule button. */
async function openCreate() {
  fireEvent.click(screen.getByText("Schedule"));
  await waitFor(() => expect(h.modal?.open).toBe(true));
  expect(h.modal?.editing ?? null).toBeNull();
}

/** Drives the real `openEdit` by clicking the appointment's List-table row. */
async function openEditFor(title: string) {
  fireEvent.click(within(screen.getByRole("table")).getByText(title));
  await waitFor(() => expect(h.modal?.editing?.title).toBe(title));
  expect(h.modal?.open).toBe(true);
}

/** Calls the page's CURRENT handleSave exactly as AppointmentModal does, and returns its result. */
async function save(data: SaveData): Promise<unknown> {
  const onSave = h.modal?.onSave;
  if (!onSave) throw new Error("AppointmentModal was never rendered");
  let result: unknown;
  await act(async () => {
    result = await onSave(data);
  });
  return result;
}

beforeEach(() => {
  h.user = { id: ids.ADMIN };
  h.organizationId = ids.ORG;
  h.modal = null;
  h.googleStatus = { connected: false };
  h.toast.mockReset();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (name: string) =>
    name === "google-calendar-status" ? { data: h.googleStatus, error: null } : { data: { success: true }, error: null },
  );
  h.calendarState = {
    appointments: [ASSIGNED_ROW, NULL_OWNER_ROW],
    loading: false,
    addAppointment: vi.fn(async (a: Record<string, unknown>) => ({ id: ids.NEW_APPT, ...a })),
    updateAppointment: vi.fn(async () => {}),
    deleteAppointment: vi.fn(async () => {}),
    fetchAppointments: vi.fn(async () => {}),
    todayCount: 0,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

describe("CalendarPage create → addAppointment keeps the picked assignee", () => {
  it("an Admin scheduling for Agent A sends user_id = A exactly once, with NO created_by / organization_id (the context stamps those)", async () => {
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: ids.AGENT_A }));

    expect(result).toBe(true);
    expect(addAppointment()).toHaveBeenCalledTimes(1);
    const payload = addAppointment().mock.calls[0][0] as Record<string, unknown>;
    expect(payload.user_id).toBe(ids.AGENT_A);
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
    expect(payload).toEqual({ ...expectedFields(), user_id: ids.AGENT_A });
    expect(updateAppointment()).not.toHaveBeenCalled();
    expect(h.modal?.open).toBe(false);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("with the modal's user_id %s the appointment is self-assigned to the scheduler", async (_label, explicit) => {
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: explicit as string | undefined }));

    expect(result).toBe(true);
    expect(addAppointment()).toHaveBeenCalledTimes(1);
    const payload = addAppointment().mock.calls[0][0] as Record<string, unknown>;
    expect(payload.user_id).toBe(ids.ADMIN);
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
  });

  it("a falsy addAppointment result resolves false with the failure toast and leaves the modal open", async () => {
    addAppointment().mockResolvedValueOnce(null);
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: ids.AGENT_A }));

    expect(result).toBe(false);
    expect(toastArgs()).toEqual([{ title: "Failed to save appointment", variant: "destructive" }]);
    expect(googleSyncCalls()).toHaveLength(0);
    expect(h.modal?.open).toBe(true);
  });

  it("a rejected addAppointment resolves false with the failure toast and never reports success", async () => {
    addAppointment().mockRejectedValueOnce(new Error("new row violates row-level security policy"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: ids.AGENT_A }));

    expect(result).toBe(false);
    expect(toastArgs()).toEqual([{ title: "Failed to save appointment", variant: "destructive" }]);
    expect(toastArgs().some((t) => t.title === "Appointment scheduled")).toBe(false);
    expect(googleSyncCalls()).toHaveLength(0);
    expect(h.modal?.open).toBe(true);
    consoleError.mockRestore();
  });
});

describe("CalendarPage create → Google Calendar guard (D-4)", () => {
  it("assigned to someone else while Google is connected: no Google create push, and the toast says why", async () => {
    h.googleStatus = { connected: true, syncMode: "two_way" };
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: ids.AGENT_A, agent: "Alice Agent" }));

    expect(result).toBe(true);
    expect(googleSyncCalls()).toHaveLength(0);
    expect(toastArgs()).toEqual([
      {
        title: "Appointment scheduled",
        description: "Not added to your Google Calendar — it's assigned to Alice Agent.",
      },
    ]);
  });

  it("names 'another user' when the modal emitted no assignee display name", async () => {
    h.googleStatus = { connected: true, syncMode: "two_way" };
    await renderCalendar();
    await openCreate();

    await save(modalData({ user_id: ids.AGENT_B, agent: "  " }));

    expect(googleSyncCalls()).toHaveLength(0);
    expect(toastArgs()).toEqual([
      {
        title: "Appointment scheduled",
        description: "Not added to your Google Calendar — it's assigned to another user.",
      },
    ]);
  });

  it("assigned to someone else while Google is NOT connected: no push and no Google wording at all", async () => {
    h.googleStatus = { connected: false };
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: ids.AGENT_A, agent: "Alice Agent" }));

    expect(result).toBe(true);
    expect(googleSyncCalls()).toHaveLength(0);
    expect(toastArgs()).toEqual([{ title: "Appointment scheduled" }]);
    expect(JSON.stringify(toastArgs())).not.toMatch(/Google/);
  });

  it.each([
    ["connected", { connected: true, syncMode: "two_way" }],
    ["not connected", { connected: false }],
  ])("self-assigned (%s): the Google create push is sent exactly once for the new row, with no 'Not added' note", async (_label, status) => {
    h.googleStatus = status;
    await renderCalendar();
    await openCreate();

    const result = await save(modalData({ user_id: ids.ADMIN, agent: "Ada Admin" }));

    expect(result).toBe(true);
    const calls = googleSyncCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body).toMatchObject({
      action: "create",
      appointment_id: ids.NEW_APPT,
      title: "Policy review with Charlotte",
      start_time: expectedFields().start_time,
      end_time: expectedFields().end_time,
      attendee_email: ids.LEAD_EMAIL,
    });
    expect(toastArgs()).toEqual([{ title: "Appointment scheduled" }]);
    expect(JSON.stringify(toastArgs())).not.toMatch(/Not added to your Google Calendar/);
  });
});

// ---------------------------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------------------------

describe("CalendarPage edit → updateAppointment never rewrites the scheduler or the tenant", () => {
  it("sends updateAppointment(id, payload) with the modal's user_id and NO created_by / organization_id", async () => {
    await renderCalendar();
    await openEditFor(ASSIGNED_ROW.title);

    const result = await save(modalData({ user_id: ids.AGENT_A }));

    expect(result).toBe(true);
    expect(updateAppointment()).toHaveBeenCalledTimes(1);
    const [id, payload] = updateAppointment().mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(ids.EXISTING_APPT);
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
    expect(payload).toEqual({ ...expectedFields(), user_id: ids.AGENT_A });
    expect(addAppointment()).not.toHaveBeenCalled();
  });

  it("an Admin editing Agent A's row without an explicit assignee keeps Agent A (the editor does not take it over)", async () => {
    await renderCalendar();
    await openEditFor(ASSIGNED_ROW.title);

    await save(modalData({ user_id: undefined }));

    const [, payload] = updateAppointment().mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.user_id).toBe(ids.AGENT_A);
    expect(payload.user_id).not.toBe(ids.ADMIN);
    expect(payload).not.toHaveProperty("created_by");
  });

  it("an explicit reassignment A → B persists as user_id = B", async () => {
    await renderCalendar();
    await openEditFor(ASSIGNED_ROW.title);
    expect(h.modal?.editing?.user_id).toBe(ids.AGENT_A);

    const result = await save(modalData({ user_id: ids.AGENT_B, agent: "Bob Agent" }));

    expect(result).toBe(true);
    const [id, payload] = updateAppointment().mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(ids.EXISTING_APPT);
    expect(payload.user_id).toBe(ids.AGENT_B);
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
  ])("a NULL-user_id row (created_by = X) edited with the modal's user_id %s keeps X as the responsible user (#22)", async (_label, explicit) => {
    await renderCalendar();
    await openEditFor(NULL_OWNER_ROW.title);
    expect(h.modal?.editing?.user_id ?? null).toBeNull();
    expect(h.modal?.editing?.created_by).toBe(ids.QUICK_CALLER);

    const result = await save(
      modalData({ title: NULL_OWNER_ROW.title, contactName: "Dana Quill", user_id: explicit as string | undefined }),
    );

    expect(result).toBe(true);
    const [id, payload] = updateAppointment().mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(ids.NULL_OWNER_APPT);
    expect(payload.user_id).toBe(ids.QUICK_CALLER);
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
  });

  it("a successful edit resolves true, toasts 'Appointment updated', closes the modal and keeps the (unchanged) Google update call", async () => {
    await renderCalendar();
    await openEditFor(ASSIGNED_ROW.title);

    const result = await save(modalData({ user_id: ids.AGENT_B }));

    expect(result).toBe(true);
    expect(toastArgs()).toEqual([{ title: "Appointment updated" }]);
    expect(h.modal?.open).toBe(false);
    const calls = googleSyncCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1].body).toMatchObject({ action: "update", appointment_id: ids.EXISTING_APPT });
  });

  it("a rejected updateAppointment (e.g. an RLS-hidden zero-row update) resolves false, shows the failure toast and keeps the modal open", async () => {
    updateAppointment().mockRejectedValueOnce(new Error("Appointment update was not applied (not found or not permitted)"));
    await renderCalendar();
    await openEditFor(ASSIGNED_ROW.title);

    const result = await save(modalData({ user_id: ids.AGENT_B }));

    expect(result).toBe(false);
    expect(updateAppointment()).toHaveBeenCalledTimes(1);
    expect(toastArgs()).toEqual([{ title: "Failed to update appointment", variant: "destructive" }]);
    expect(toastArgs().some((t) => t.title === "Appointment updated")).toBe(false);
    expect(googleSyncCalls()).toHaveLength(0);
    expect(h.modal?.open).toBe(true);
    expect(h.modal?.editing?.id).toBe(ids.EXISTING_APPT);
  });
});

// ---------------------------------------------------------------------------------------------
// Missing context
// ---------------------------------------------------------------------------------------------

describe("CalendarPage handleSave with missing context", () => {
  it.each([
    ["create", "organization"],
    ["create", "user"],
    ["edit", "organization"],
    ["edit", "user"],
  ])("%s with no %s resolves false, toasts the context error and writes nothing", async (path, missing) => {
    if (missing === "organization") h.organizationId = null;
    else h.user = null;
    await renderCalendar();
    if (path === "create") await openCreate();
    else await openEditFor(ASSIGNED_ROW.title);

    const result = await save(modalData({ user_id: ids.AGENT_A }));

    expect(result).toBe(false);
    expect(addAppointment()).not.toHaveBeenCalled();
    expect(updateAppointment()).not.toHaveBeenCalled();
    expect(googleSyncCalls()).toHaveLength(0);
    expect(toastArgs()).toEqual([
      {
        title: "Cannot save appointment",
        description: "Missing organization or user context. Please refresh and try again.",
        variant: "destructive",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Google sync never holds the save (review finding: late close)
// ---------------------------------------------------------------------------------------------

describe("CalendarPage handleSave resolves on the database write, not on the Google sync", () => {
  function holdGoogleSync() {
    let settle!: (outcome: "ok" | "fail") => void;
    const held = new Promise<"ok" | "fail">((r) => {
      settle = r;
    });
    h.invoke.mockImplementation(async (name: string) => {
      if (name === "google-calendar-status") return { data: h.googleStatus, error: null };
      if ((await held) === "fail") throw new Error("sync down");
      return { data: { success: true }, error: null };
    });
    return settle;
  }

  it.each(["create", "edit"] as const)(
    "%s: resolves true while the sync is still pending; a later sync failure only toasts",
    async (path) => {
      h.googleStatus = { connected: true, syncMode: "two_way" };
      const settleSync = holdGoogleSync();
      await renderCalendar();
      if (path === "create") await openCreate();
      else await openEditFor(ASSIGNED_ROW.title);

      const result = await save(modalData({ user_id: path === "create" ? ids.ADMIN : ids.AGENT_B }));

      expect(result, "the modal is released before the sync settles").toBe(true);
      expect(h.modal?.open).toBe(false);
      expect(googleSyncCalls()).toHaveLength(1);
      expect(toastArgs().some((t) => /Google Calendar sync failed/.test(t.description ?? ""))).toBe(false);

      await act(async () => {
        settleSync("fail");
      });
      await waitFor(() =>
        expect(toastArgs().some((t) => t.variant === "destructive" && /Google Calendar sync failed/.test(t.description ?? ""))).toBe(true),
      );
    },
  );
});
