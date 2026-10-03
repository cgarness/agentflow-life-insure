/**
 * Contact page "Schedule" → AppointmentModal.onSave, and the Follow-ups card mount
 * (plan 2026-09-28-contact-followups §4.5, §7.4, §11 `fullScreenContactViewSchedule`).
 *
 * Renders the REAL FullScreenContactView with per-file mocks. AppointmentModal and
 * ContactFollowUpsCard are replaced by props-recording stand-ins so the test can drive the
 * page's own `onSave` handler and read exactly what the card is handed.
 *
 * Pinned:
 *  - ONE write, through CalendarContext.addAppointment, with a snake_case payload that keeps the
 *    modal's picked assignee (`user_id`) and status, uses the page's `contact.id` (the modal emits
 *    an empty `contactId` here) and carries NO `created_by` / `organization_id` (the context stamps
 *    those). The page never inserts into `appointments` itself (the old double write).
 *  - The handler resolves `true` only after the save actually succeeded, `false` on every failure
 *    path (rejected save, missing org, missing user), and toasts accordingly (D-16).
 *  - Success bumps the card's `refreshKey`; failure does not.
 *  - The mounted card receives `contactId = contact.id`, `contactType` and `organizationId`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import type { CalendarAppointment } from "@/contexts/CalendarContext";
import type { ContactFollowUpsCardProps } from "@/components/contacts/followups/ContactFollowUpsCard";

type ModalSaveData = Omit<CalendarAppointment, "id">;
type ModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (data: ModalSaveData) => void | boolean | Promise<boolean | void>;
  prefillContactName?: string;
  prefillContactId?: string;
};

const SCHEDULER_ID = "5c4ed01e-0b1a-4c2d-9e3f-0a1b2c3d4e5f";
const AGENT_A = "a9e1c7d2-3b4f-4a5e-8c6d-7e8f9a0b1c2d";
const ORG_ID = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
const CONTACT_ID = "c0a7ac71-2d3e-4f50-8a1b-2c3d4e5f6a7b";
const OTHER_CONTACT_ID = "d1b8bd82-3e4f-4061-9b2c-3d4e5f6a7b8c";

const h = vi.hoisted(() => ({
  historyRefresh: vi.fn(),
  addAppointment: vi.fn(),
  successToasts: [] as string[],
  errorToasts: [] as string[],
  activityAdds: [] as Array<Record<string, unknown>>,
  /** Every table the page touched through the Supabase client. */
  fromTables: [] as string[],
  /** Every direct `.insert()` made through the Supabase client. */
  inserts: [] as Array<{ table: string; rows: unknown }>,
  tableData: {} as Record<string, unknown>,
  modal: null as null | Record<string, any>,
  cardRenders: [] as Array<Record<string, any>>,
  orgId: null as string | null,
  user: null as null | { id: string },
  profile: null as null | { id: string; first_name: string; last_name: string },
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (table: string) => {
    const result = () => ({ data: h.tableData[table] ?? null, error: null });
    const q: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    for (const m of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lte", "lt", "neq", "is", "range", "abortSignal"]) {
      q[m] = () => q;
    }
    q.maybeSingle = () => Promise.resolve(result());
    q.single = () => Promise.resolve(result());
    q.insert = (rows: unknown) => {
      h.inserts.push({ table, rows });
      return q;
    };
    q.update = () => q;
    q.delete = () => q;
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        h.fromTables.push(table);
        return makeQuery(table);
      },
      auth: { getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (msg: string) => h.successToasts.push(msg),
    error: (msg: string) => h.errorToasts.push(msg),
    info: () => undefined,
    warning: () => undefined,
  },
}));

vi.mock("@/hooks/useContactHistory", () => ({ useContactHistory: () => ({
  conversation:{items:[],loading:false,error:null,hasMore:false}, activity:{items:[],loading:false,error:null,hasMore:false},
  refresh:h.historyRefresh, loadConversation:vi.fn(), loadActivity:vi.fn(),
}) }));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: {
    getByContact: vi.fn(async () => []),
    add: vi.fn(async (payload: Record<string, unknown>) => {
      h.activityAdds.push(payload);
      return { id: `act-${h.activityAdds.length}`, ...payload };
    }),
  },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-dispositions", () => ({ dispositionsSupabaseApi: { getAll: vi.fn(async () => []) } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: h.user, profile: h.profile }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: h.addAppointment }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
    branding: { companyName: "AgentFlow" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.orgId }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({
  default: (props: Record<string, any>) => {
    h.modal = props;
    return null;
  },
}));
vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({
  ContactFollowUpsCard: (props: Record<string, any>) => {
    h.cardRenders.push(props);
    return null;
  },
}));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("@/components/contacts/TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const IS_LA = TZ === "America/Los_Angeles";
const laOnly = IS_LA ? it : it.skip;

/** Canonical lead, as Contacts.tsx hands it to the view (assigned to the scheduler). */
const LEAD = {
  id: CONTACT_ID,
  firstName: "Charlotte",
  lastName: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  leadSource: "Facebook Ads",
  leadScore: 7,
  assignedAgentId: SCHEDULER_ID,
  userId: SCHEDULER_ID,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** Exactly what AppointmentModal emits from this page (no prefillContactId ⇒ contactId ""). */
function modalData(overrides: Partial<ModalSaveData> = {}): ModalSaveData {
  return {
    title: "Final Expense Consultation - Charlotte Kearney",
    type: "Sales Call",
    status: "Confirmed",
    contactName: "Charlotte Kearney",
    contactId: "",
    date: new Date(2026, 9, 15),
    startTime: "2:30 PM",
    endTime: "3:00 PM",
    agent: "Avery Agent",
    notes: "Bring the carrier quotes",
    user_id: AGENT_A,
    ...overrides,
  };
}

function latestModal(): ModalProps {
  if (!h.modal) throw new Error("AppointmentModal was never rendered");
  return h.modal as ModalProps;
}

function latestCard(): ContactFollowUpsCardProps {
  const last = h.cardRenders[h.cardRenders.length - 1];
  if (!last) throw new Error("ContactFollowUpsCard was never rendered");
  return last as ContactFollowUpsCardProps;
}

/** Invoke the page's CURRENT onSave closure and flush the resulting state updates. */
async function save(data: ModalSaveData): Promise<boolean | void> {
  let result: boolean | void = undefined;
  await act(async () => {
    result = await latestModal().onSave(data);
  });
  return result;
}

function renderView(contact: Record<string, unknown> = LEAD, type: "lead" | "client" | "recruit" = "lead") {
  return render(
    <FullScreenContactView
      contact={contact}
      type={type}
      onClose={vi.fn()}
      onUpdate={vi.fn(async () => {})}
      onDelete={vi.fn(async () => {})}
    />,
  );
}

/** Render, let the page's initial load settle (roster loaded), and open the Schedule modal. */
async function renderAndOpenSchedule(contact: Record<string, unknown> = LEAD, type: "lead" | "client" | "recruit" = "lead") {
  const view = renderView(contact, type);
  await waitFor(() => expect(latestCard().agents.some((a) => a.id === AGENT_A)).toBe(true));
  expect(latestModal().open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /^schedule$/i }));
  await waitFor(() => expect(latestModal().open).toBe(true));
  return view;
}

function appointmentActivities() {
  return h.activityAdds.filter((a) => a.type === "appointment");
}

beforeEach(() => {
  h.historyRefresh.mockClear();
  h.addAppointment.mockReset();
  h.addAppointment.mockImplementation(async (row: Record<string, unknown>) => ({ id: "appt-new", ...row }));
  h.successToasts = [];
  h.errorToasts = [];
  h.activityAdds = [];
  h.fromTables = [];
  h.inserts = [];
  h.modal = null;
  h.cardRenders = [];
  h.orgId = ORG_ID;
  h.user = { id: SCHEDULER_ID };
  h.profile = { id: SCHEDULER_ID, first_name: "Sam", last_name: "Scheduler" };
  h.tableData = {
    profiles: [
      { id: SCHEDULER_ID, first_name: "Sam", last_name: "Scheduler", status: "Active" },
      { id: AGENT_A, first_name: "Avery", last_name: "Agent", status: "Active" },
    ],
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Schedule → onSave writes ONE appointment through CalendarContext", () => {
  it("calls addAppointment once with the picked assignee, status and this contact's id, in snake_case", async () => {
    await renderAndOpenSchedule();

    const result = await save(modalData());

    expect(result).toBe(true);
    expect(h.addAppointment).toHaveBeenCalledTimes(1);
    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual({
      title: "Final Expense Consultation - Charlotte Kearney",
      contact_name: "Charlotte Kearney",
      contact_id: CONTACT_ID,
      type: "Sales Call",
      status: "Confirmed",
      start_time: new Date(2026, 9, 15, 14, 30, 0, 0).toISOString(),
      end_time: new Date(2026, 9, 15, 15, 0, 0, 0).toISOString(),
      notes: "Bring the carrier quotes",
      sync_source: "internal",
      user_id: AGENT_A,
    });
  });

  it("uses contact.id, never the modal's empty contactId (the page passes no prefillContactId)", async () => {
    await renderAndOpenSchedule();
    expect(latestModal().prefillContactId).toBeUndefined();
    expect(latestModal().prefillContactName).toBe("Charlotte Kearney");

    await save(modalData({ contactId: "" }));

    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload.contact_id).toBe(CONTACT_ID);
    expect(payload.contact_id).not.toBe("");
  });

  it("keeps the assignee as user_id (not the scheduler) and leaves created_by / organization_id to the context", async () => {
    await renderAndOpenSchedule();

    await save(modalData({ user_id: AGENT_A }));

    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload.user_id).toBe(AGENT_A);
    expect(payload.user_id).not.toBe(SCHEDULER_ID);
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("organization_id");
    // No camelCase modal keys leak into the row (PostgREST would reject them).
    for (const k of ["contactName", "contactId", "startTime", "endTime", "date", "agent"]) {
      expect(payload).not.toHaveProperty(k);
    }
  });

  it("never writes to the appointments table directly (no double write)", async () => {
    await renderAndOpenSchedule();

    await save(modalData());

    expect(h.addAppointment).toHaveBeenCalledTimes(1);
    expect(h.inserts).toEqual([]);
    expect(h.fromTables).not.toContain("appointments");
  });

  it("converts 12-hour times on the picked local date, including 12 AM and 12 PM", async () => {
    await renderAndOpenSchedule();

    await save(modalData({ date: new Date(2026, 9, 16), startTime: "12:15 AM", endTime: "12:45 PM" }));

    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload.start_time).toBe(new Date(2026, 9, 16, 0, 15, 0, 0).toISOString());
    expect(payload.end_time).toBe(new Date(2026, 9, 16, 12, 45, 0, 0).toISOString());
  });
});

describe("Schedule → success is reported only after the save succeeded", () => {
  it("resolves true, toasts once, refreshes saved history, closes the modal and bumps the card's refreshKey", async () => {
    await renderAndOpenSchedule();
    expect(latestCard().refreshKey).toBe(0);

    const result = await save(modalData());

    expect(result).toBe(true);
    expect(h.successToasts).toEqual(["Appointment scheduled"]);
    expect(h.errorToasts).toEqual([]);
    expect(appointmentActivities()).toHaveLength(0);
    expect(h.historyRefresh).toHaveBeenCalledTimes(1);
    expect(latestModal().open).toBe(false);
    expect(latestCard().refreshKey).toBe(1);
  });

  it("does not toast or bump refreshKey while addAppointment is still pending", async () => {
    await renderAndOpenSchedule();
    let resolveAdd!: (row: unknown) => void;
    h.addAppointment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        }),
    );

    let settled: unknown = "pending";
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = Promise.resolve(latestModal().onSave(modalData())).then((v) => {
        settled = v;
        return v;
      });
    });

    expect(h.addAppointment).toHaveBeenCalledTimes(1);
    expect(settled).toBe("pending");
    expect(h.successToasts).toEqual([]);
    expect(latestCard().refreshKey).toBe(0);
    expect(latestModal().open).toBe(true);

    await act(async () => {
      resolveAdd({ id: "appt-late" });
      await pending;
    });

    expect(settled).toBe(true);
    expect(h.successToasts).toEqual(["Appointment scheduled"]);
    expect(latestCard().refreshKey).toBe(1);
  });

  it("bumps refreshKey again on each subsequent successful save", async () => {
    await renderAndOpenSchedule();

    await save(modalData());
    expect(latestCard().refreshKey).toBe(1);

    await act(async () => {
      latestCard().onAddAppointment();
    });
    expect(latestModal().open).toBe(true);
    await save(modalData({ title: "Policy review", type: "Policy Review", status: "Scheduled" }));

    expect(h.addAppointment).toHaveBeenCalledTimes(2);
    expect(latestCard().refreshKey).toBe(2);
  });
});

describe("Schedule → every failure path resolves false", () => {
  it("a rejected addAppointment toasts the error, resolves false, and reports no success", async () => {
    await renderAndOpenSchedule();
    h.addAppointment.mockRejectedValueOnce(new Error("new row violates row-level security policy"));

    const result = await save(modalData());

    expect(result).toBe(false);
    expect(h.addAppointment).toHaveBeenCalledTimes(1);
    expect(h.errorToasts).toEqual(["Failed to schedule appointment"]);
    expect(h.successToasts).toEqual([]);
    expect(appointmentActivities()).toHaveLength(0);
    expect(latestCard().refreshKey).toBe(0);
    // The modal stays open so the user's input is not lost (D-16).
    expect(latestModal().open).toBe(true);
    // Still no direct fallback write.
    expect(h.inserts).toEqual([]);
    expect(h.fromTables).not.toContain("appointments");
  });

  it("missing organization context resolves false without writing", async () => {
    h.orgId = null;
    renderView();
    await waitFor(() => expect(h.cardRenders.length).toBeGreaterThan(0));

    const result = await save(modalData());

    expect(result).toBe(false);
    expect(h.addAppointment).not.toHaveBeenCalled();
    expect(h.errorToasts).toEqual(["Cannot schedule appointment: missing organization or user context"]);
    expect(h.successToasts).toEqual([]);
    expect(latestCard().refreshKey).toBe(0);
    expect(h.inserts).toEqual([]);
  });

  it("missing user context resolves false without writing", async () => {
    h.user = null;
    h.profile = null;
    renderView();
    await waitFor(() => expect(h.cardRenders.length).toBeGreaterThan(0));

    const result = await save(modalData());

    expect(result).toBe(false);
    expect(h.addAppointment).not.toHaveBeenCalled();
    expect(h.errorToasts).toEqual(["Cannot schedule appointment: missing organization or user context"]);
    expect(h.successToasts).toEqual([]);
    expect(h.inserts).toEqual([]);
  });
});

describe("Follow-ups card mount", () => {
  it("receives this contact's id, type and organization, with refreshKey 0 on mount", async () => {
    renderView();
    await waitFor(() => expect(h.cardRenders.length).toBeGreaterThan(0));

    expect(latestCard()).toMatchObject({
      contactId: CONTACT_ID,
      contactType: "lead",
      organizationId: ORG_ID,
      refreshKey: 0,
    });
    // Every render hands the card this contact — never another id.
    expect(h.cardRenders.every((p) => p.contactId === CONTACT_ID)).toBe(true);
  });

  it("passes the contact type through for a client and a recruit", async () => {
    renderView({ ...LEAD }, "client");
    await waitFor(() => expect(h.cardRenders.length).toBeGreaterThan(0));
    expect(latestCard()).toMatchObject({ contactId: CONTACT_ID, contactType: "client", organizationId: ORG_ID });

    cleanup();
    h.cardRenders = [];
    renderView({ ...LEAD }, "recruit");
    await waitFor(() => expect(h.cardRenders.length).toBeGreaterThan(0));
    expect(latestCard()).toMatchObject({ contactId: CONTACT_ID, contactType: "recruit", organizationId: ORG_ID });
  });

  it("follows the page to another contact", async () => {
    const view = renderView();
    await waitFor(() => expect(latestCard().contactId).toBe(CONTACT_ID));

    view.rerender(
      <FullScreenContactView
        contact={{ ...LEAD, id: OTHER_CONTACT_ID, firstName: "Dana" }}
        type="lead"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onDelete={vi.fn(async () => {})}
      />,
    );

    await waitFor(() => expect(latestCard().contactId).toBe(OTHER_CONTACT_ID));
    expect(latestCard().contactType).toBe("lead");
  });

  it("gets the page's roster and name resolver, and its add action opens the Schedule modal", async () => {
    renderView();
    await waitFor(() => expect(latestCard().agents.some((a) => a.id === AGENT_A)).toBe(true));

    expect(latestCard().resolveAgentName(AGENT_A)).toBe("Avery Agent");
    expect(latestModal().open).toBe(false);

    await act(async () => {
      latestCard().onAddAppointment();
    });

    expect(latestModal().open).toBe(true);
  });
});

describe("Schedule → stored instants in the viewer's zone (America/Los_Angeles only)", () => {
  laOnly("a PDT afternoon is stored as the matching UTC instant", async () => {
    await renderAndOpenSchedule();

    await save(modalData({ date: new Date(2026, 9, 15), startTime: "2:30 PM", endTime: "3:00 PM" }));

    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload.start_time).toBe("2026-10-15T21:30:00.000Z");
    expect(payload.end_time).toBe("2026-10-15T22:00:00.000Z");
  });

  laOnly("a late-evening slot lands on the next UTC day without shifting the local date", async () => {
    await renderAndOpenSchedule();

    await save(modalData({ date: new Date(2026, 9, 31), startTime: "11:30 PM", endTime: "11:45 PM" }));

    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload.start_time).toBe("2026-11-01T06:30:00.000Z");
    expect(payload.end_time).toBe("2026-11-01T06:45:00.000Z");
  });

  laOnly("the day after DST ends uses the PST offset", async () => {
    await renderAndOpenSchedule();

    await save(modalData({ date: new Date(2026, 10, 2), startTime: "9:00 AM", endTime: "9:30 AM" }));

    const [payload] = h.addAppointment.mock.calls[0] as [Record<string, unknown>];
    expect(payload.start_time).toBe("2026-11-02T17:00:00.000Z");
    expect(payload.end_time).toBe("2026-11-02T17:30:00.000Z");
  });
});
