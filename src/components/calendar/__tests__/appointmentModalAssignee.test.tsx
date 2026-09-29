/**
 * AppointmentModal: truthful assignee (plan §4.4) and "never report a save that did not happen" (D-16).
 *
 * Renders the REAL AppointmentModal + AppointmentAssigneeField. Only the data/identity edges are mocked:
 * Supabase (profiles roster + leads lookup), useAuth, useOrganization, useAppointmentTypes, PermissionGate
 * and the sonner toast (recorded).
 *
 * Pins:
 *   - edit-init: editing.user_id, else editing.created_by (invariant #22 — a NULL user_id row belongs to its
 *     creator, not the editor), else the viewer; asserted both on the <select>'s displayed value and on the
 *     user_id emitted by onSave after CONFIRM;
 *   - an assignee missing from the Admin's roster is rendered as the SELECTED "Current assignee" option
 *     (the display always equals the value that will be saved);
 *   - Agent branch: someone else's id reads "Current assignee", the viewer's own id reads the viewer's name;
 *   - onSave receives user_id unchanged;
 *   - D-16: false / throw keeps the modal open with no success toast; true closes without the modal's own
 *     toast; a void return keeps the legacy "Scheduled"/"Saved" toast + close; CONFIRM is disabled while saving.
 */

import React from "react";
import { render, screen, cleanup, within, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarAppointment } from "@/contexts/CalendarContext";
import type { AppointmentTypeRecord } from "@/lib/calendar/appointmentTypes";

const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** A real user who is NOT in the viewer's roster (e.g. inactive, or outside a Team Leader's downline). */
const OUTSIDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LEAD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type ProfileRow = { id: string; first_name: string; last_name: string; status: string };

const h = vi.hoisted(() => ({
  auth: {
    current: null as null | {
      user: { id: string };
      profile: { id: string; first_name: string; last_name: string; role: string; organization_id: string };
    },
  },
  roster: [] as ProfileRow[],
  queries: [] as { table: string; eq: Record<string, unknown>; or: string[] }[],
  toasts: { success: [] as string[], error: [] as string[] },
  // STABLE reference: the modal's init effect depends on `apptTypes`; a fresh array per render would re-run
  // it on every render and measure the mock instead of the component.
  types: [] as AppointmentTypeRecord[],
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec = { table, eq: {} as Record<string, unknown>, or: [] as string[] };
    h.queries.push(rec);
    const b: Record<string, unknown> = {
      select() { return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      or(expr: string) { rec.or.push(expr); return b; },
      order() { return b; }, limit() { return b; },
      gte() { return b; }, lte() { return b; },
      insert() { return b; }, update() { return b; }, delete() { return b; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() {
        if (table === "leads") {
          return Promise.resolve({
            data: { id: LEAD, first_name: "Pat", last_name: "Doe", phone: "5550100", email: "", state: "CA", status: "New" },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const data = table === "profiles" ? h.roster : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
      auth: {},
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => h.auth.current,
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: ORG }),
}));

vi.mock("@/hooks/useAppointmentTypes", () => ({
  useAppointmentTypes: () => ({ types: h.types }),
}));

vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: unknown) => { h.toasts.success.push(String(m)); },
    error: (m: unknown) => { h.toasts.error.push(String(m)); },
    message: () => {},
    info: () => {},
  },
}));

import AppointmentModal from "@/components/calendar/AppointmentModal";

type SaveFn = (data: Omit<CalendarAppointment, "id">) => void | boolean | Promise<boolean | void>;
type SavedPayload = Omit<CalendarAppointment, "id">;

const SALES_CALL: AppointmentTypeRecord = {
  id: "f0000000-0000-4000-8000-000000000001",
  organizationId: ORG,
  name: "Sales Call",
  color: "#3B82F6",
  durationMinutes: 30,
  sortOrder: 0,
  isDefault: true,
  isLocked: true,
  isActive: true,
  createdBy: null,
  createdAt: null,
  updatedAt: null,
};

const ROSTER: ProfileRow[] = [
  { id: ADMIN, first_name: "Ada", last_name: "Admin", status: "Active" },
  { id: AGENT_A, first_name: "Alice", last_name: "Agent", status: "Active" },
  { id: AGENT_B, first_name: "Bob", last_name: "Bee", status: "Active" },
];

const asAdmin = () => {
  h.auth.current = {
    user: { id: ADMIN },
    profile: { id: ADMIN, first_name: "Ada", last_name: "Admin", role: "Admin", organization_id: ORG },
  };
};
const asAgentA = () => {
  h.auth.current = {
    user: { id: AGENT_A },
    profile: { id: AGENT_A, first_name: "Alice", last_name: "Agent", role: "Agent", organization_id: ORG },
  };
};

/** A future date so the "past unresolved" guard never disables CONFIRM, whatever today is. */
const FUTURE = () => new Date(2030, 0, 15);

const editingRow = (over: Partial<CalendarAppointment> = {}): CalendarAppointment => ({
  id: "90000000-0000-4000-8000-000000000001",
  title: "Sales Call with Pat",
  type: "Sales Call",
  status: "Scheduled",
  date: FUTURE(),
  startTime: "10:00 AM",
  endTime: "10:30 AM",
  contactName: "Pat Doe",
  contactId: LEAD,
  agent: "",
  notes: "",
  user_id: AGENT_A,
  created_by: ADMIN,
  raw_status: "Scheduled",
  ...over,
});

function renderModal(props: { editing?: CalendarAppointment | null; onSave?: SaveFn; prefillContactName?: string } = {}) {
  const onSave = vi.fn<SaveFn>(props.onSave ?? (() => true));
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <AppointmentModal
        open
        onClose={onClose}
        onSave={onSave}
        editing={props.editing ?? null}
        defaultDate={props.editing ? undefined : FUTURE()}
        prefillContactName={props.prefillContactName}
      />
    </MemoryRouter>,
  );
  return { onSave, onClose };
}

const assigneeCell = () => screen.getByText("Assigned Agent").parentElement as HTMLElement;
const assigneeSelect = () => within(assigneeCell()).getByRole("combobox") as HTMLSelectElement;
const confirmButton = () => screen.getByRole("button", { name: "CONFIRM" });
/** The Admin/TL roster arrives asynchronously from the profiles query. */
const rosterLoaded = () => within(assigneeCell()).findByRole("option", { name: "Alice Agent" });

async function clickConfirm() {
  await act(async () => {
    fireEvent.click(confirmButton());
  });
}

const savedPayload = (onSave: ReturnType<typeof vi.fn<SaveFn>>): SavedPayload => {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0];
};

beforeEach(() => {
  h.queries = [];
  h.toasts.success = [];
  h.toasts.error = [];
  h.roster = ROSTER;
  h.types = [SALES_CALL];
  asAdmin();
});
afterEach(cleanup);

describe("AppointmentModal edit-init assignee (invariant #22)", () => {
  it("uses editing.user_id when it is set, even though created_by is someone else", async () => {
    const { onSave } = renderModal({ editing: editingRow({ user_id: AGENT_A, created_by: ADMIN }) });
    await rosterLoaded();

    expect(assigneeSelect()).toHaveValue(AGENT_A);
    expect(assigneeSelect()).toHaveDisplayValue("Alice Agent");

    await clickConfirm();
    expect(savedPayload(onSave).user_id).toBe(AGENT_A);
  });

  it("falls back to editing.created_by for a NULL user_id row (quick-call callback), not the editor", async () => {
    // The mapper passes a DB NULL straight through as null.
    const { onSave } = renderModal({
      editing: editingRow({ user_id: null as unknown as string, created_by: AGENT_B }),
    });
    await rosterLoaded();

    expect(assigneeSelect()).toHaveValue(AGENT_B);
    expect(assigneeSelect()).toHaveDisplayValue("Bob Bee");

    await clickConfirm();
    const payload = savedPayload(onSave);
    expect(payload.user_id).toBe(AGENT_B);
    expect(payload.user_id).not.toBe(ADMIN);
    expect(payload.agent).toBe("Bob Bee");
  });

  it("falls back to editing.created_by when user_id is empty/undefined", async () => {
    const { onSave } = renderModal({ editing: editingRow({ user_id: undefined, created_by: AGENT_A }) });
    await rosterLoaded();

    expect(assigneeSelect()).toHaveValue(AGENT_A);
    await clickConfirm();
    expect(savedPayload(onSave).user_id).toBe(AGENT_A);
  });

  it("falls back to the viewer only when neither user_id nor created_by is set", async () => {
    const { onSave } = renderModal({
      editing: editingRow({ user_id: null as unknown as string, created_by: null }),
    });
    await rosterLoaded();

    expect(assigneeSelect()).toHaveValue(ADMIN);
    expect(assigneeSelect()).toHaveDisplayValue("Ada Admin");
    await clickConfirm();
    expect(savedPayload(onSave).user_id).toBe(ADMIN);
  });

  it("a new appointment defaults to the viewer", async () => {
    const { onSave } = renderModal({ prefillContactName: "Pat Doe" });
    await rosterLoaded();

    expect(assigneeSelect()).toHaveValue(ADMIN);
    await clickConfirm();
    const payload = savedPayload(onSave);
    expect(payload.user_id).toBe(ADMIN);
    expect(payload.agent).toBe("Ada Admin");
  });
});

describe("AppointmentModal assignee display (Admin roster)", () => {
  it("renders an assignee missing from the roster as the SELECTED 'Current assignee' option and saves it unchanged", async () => {
    const { onSave } = renderModal({ editing: editingRow({ user_id: OUTSIDER, created_by: ADMIN }) });
    await rosterLoaded();

    const select = assigneeSelect();
    expect(select).toHaveValue(OUTSIDER);
    expect(select).toHaveDisplayValue("Current assignee");
    // The roster is still offered, and the first roster member is NOT what the field shows.
    const options = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual([OUTSIDER, ADMIN, AGENT_A, AGENT_B]);
    expect(select).not.toHaveDisplayValue("Ada Admin");

    await clickConfirm();
    const payload = savedPayload(onSave);
    expect(payload.user_id).toBe(OUTSIDER);
    // The display name is not borrowed from the viewer for someone else's row.
    expect(payload.agent).toBe("");
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
  });

  it("the roster query is org- and Active-scoped", async () => {
    renderModal({ editing: editingRow() });
    await rosterLoaded();
    const profileQueries = h.queries.filter((q) => q.table === "profiles");
    expect(profileQueries).toHaveLength(1);
    expect(profileQueries[0].eq).toEqual({ status: "Active", organization_id: ORG });
    expect(profileQueries[0].or).toEqual([]);
  });

  it("an explicit reassignment in the select is emitted as the new user_id", async () => {
    const { onSave } = renderModal({ editing: editingRow({ user_id: OUTSIDER, created_by: ADMIN }) });
    await rosterLoaded();

    fireEvent.change(assigneeSelect(), { target: { value: AGENT_B } });
    expect(assigneeSelect()).toHaveValue(AGENT_B);
    expect(within(assigneeSelect()).queryByRole("option", { name: "Current assignee" })).toBeNull();

    await clickConfirm();
    const payload = savedPayload(onSave);
    expect(payload.user_id).toBe(AGENT_B);
    expect(payload.agent).toBe("Bob Bee");
  });
});

describe("AppointmentModal assignee display (Agent read-only branch)", () => {
  beforeEach(asAgentA);

  it("shows 'Current assignee' (not the viewer's name) for a row assigned to someone else, and saves that id unchanged", async () => {
    const { onSave } = renderModal({ editing: editingRow({ user_id: AGENT_B, created_by: AGENT_A }) });

    const cell = assigneeCell();
    expect(within(cell).getByText("Current assignee")).toBeInTheDocument();
    expect(within(cell).queryByText("Alice Agent")).toBeNull();
    expect(within(cell).queryByRole("combobox")).toBeNull();
    // Agents never load a roster.
    expect(h.queries.filter((q) => q.table === "profiles")).toHaveLength(0);

    await clickConfirm();
    const payload = savedPayload(onSave);
    expect(payload.user_id).toBe(AGENT_B);
    expect(payload.agent).toBe("");
  });

  it("shows the viewer's own name for the viewer's own row", async () => {
    const { onSave } = renderModal({ editing: editingRow({ user_id: AGENT_A, created_by: ADMIN }) });

    const cell = assigneeCell();
    expect(within(cell).getByText("Alice Agent")).toBeInTheDocument();
    expect(within(cell).queryByText("Current assignee")).toBeNull();

    await clickConfirm();
    const payload = savedPayload(onSave);
    expect(payload.user_id).toBe(AGENT_A);
    expect(payload.agent).toBe("Alice Agent");
  });

  it("a NULL user_id row the Agent created reads as the Agent's own (created_by fallback)", async () => {
    const { onSave } = renderModal({
      editing: editingRow({ user_id: null as unknown as string, created_by: AGENT_A }),
    });

    expect(within(assigneeCell()).getByText("Alice Agent")).toBeInTheDocument();
    await clickConfirm();
    expect(savedPayload(onSave).user_id).toBe(AGENT_A);
  });

  it("a NULL user_id row created by someone else reads 'Current assignee' and keeps that creator", async () => {
    const { onSave } = renderModal({
      editing: editingRow({ user_id: null as unknown as string, created_by: AGENT_B }),
    });

    expect(within(assigneeCell()).getByText("Current assignee")).toBeInTheDocument();
    await clickConfirm();
    expect(savedPayload(onSave).user_id).toBe(AGENT_B);
  });
});

describe("AppointmentModal save outcome (D-16)", () => {
  it("onSave resolving false keeps the modal open and shows NO success toast", async () => {
    const { onSave, onClose } = renderModal({ editing: editingRow(), onSave: () => Promise.resolve(false) });
    await rosterLoaded();

    await clickConfirm();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(h.toasts.success).toEqual([]);
    expect(screen.getByText("Edit Appointment")).toBeInTheDocument();
    // The user can retry.
    expect(confirmButton()).toBeEnabled();
  });

  it("a synchronous false is treated the same way", async () => {
    const { onClose } = renderModal({ prefillContactName: "Pat Doe", onSave: () => false });
    await rosterLoaded();

    await clickConfirm();
    expect(onClose).not.toHaveBeenCalled();
    expect(h.toasts.success).toEqual([]);
  });

  it("a rejected onSave keeps the modal open with no success toast", async () => {
    const { onSave, onClose } = renderModal({
      editing: editingRow(),
      onSave: () => Promise.reject(new Error("RLS denied")),
    });
    await rosterLoaded();

    await clickConfirm();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(h.toasts.success).toEqual([]);
    expect(confirmButton()).toBeEnabled();
  });

  it("onSave resolving true closes WITHOUT the modal's own toast (the parent owns it)", async () => {
    const { onClose } = renderModal({ editing: editingRow(), onSave: () => Promise.resolve(true) });
    await rosterLoaded();

    await clickConfirm();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.toasts.success).toEqual([]);
    expect(h.toasts.error).toEqual([]);
  });

  it("a void return keeps the legacy behaviour: 'Saved' toast + close when editing", async () => {
    const { onClose } = renderModal({ editing: editingRow(), onSave: () => undefined });
    await rosterLoaded();

    await clickConfirm();
    expect(h.toasts.success).toEqual(["Saved"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a void return keeps the legacy behaviour: 'Scheduled' toast + close when creating", async () => {
    const { onClose } = renderModal({ prefillContactName: "Pat Doe", onSave: () => Promise.resolve(undefined) });
    await rosterLoaded();

    await clickConfirm();
    expect(h.toasts.success).toEqual(["Scheduled"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables CONFIRM while the save is in flight and ignores a second click", async () => {
    let settle!: (v: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { settle = resolve; });
    const { onSave, onClose } = renderModal({ editing: editingRow(), onSave: () => pending });
    await rosterLoaded();

    await clickConfirm();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(h.toasts.success).toEqual([]);

    await clickConfirm();
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => { settle(true); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(h.toasts.success).toEqual([]);
    expect(confirmButton()).toBeEnabled();
  });

  it("a save still pending from an earlier open neither closes nor disables a reopened modal", async () => {
    let settle!: (v: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { settle = resolve; });
    const onSave = vi.fn<SaveFn>(() => pending);
    const onClose = vi.fn();
    const ui = (open: boolean) => (
      <MemoryRouter>
        <AppointmentModal open={open} onClose={onClose} onSave={onSave} editing={editingRow()} />
      </MemoryRouter>
    );
    const { rerender } = render(ui(true));
    await rosterLoaded();

    await clickConfirm();
    expect(confirmButton()).toBeDisabled();

    // The user leaves the first session and opens the modal again before that save settles.
    rerender(ui(false));
    rerender(ui(true));
    await rosterLoaded();
    expect(confirmButton(), "a new session starts enabled").toBeEnabled();

    await act(async () => { settle(true); });
    expect(onClose, "the stale result must not close the new session").not.toHaveBeenCalled();
    expect(confirmButton()).toBeEnabled();
  });

  it("a validation failure never calls onSave", async () => {
    const { onSave, onClose } = renderModal({ editing: editingRow({ title: "   " }) });
    await rosterLoaded();

    await clickConfirm();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(h.toasts.success).toEqual([]);
  });
});
