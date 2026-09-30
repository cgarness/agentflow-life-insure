/**
 * Main Dialer live save path — appointment / callback-shadow writer (implementation_plan.md root §19).
 *
 * Mounts the REAL DialerPage on a campaign lead, picks a scheduler disposition, fills date + time and
 * clicks Save or Save & Next, then inspects every write that reaches the (mocked) Supabase client:
 *
 *   - ONE `appointments` INSERT per intended row (appointment, callback shadow, or both) — never an extra
 *     insert from CalendarContext.addAppointment;
 *   - the callback shadow's `start_time` is EXACTLY the canonical `p_callback_due_at` sent to
 *     `advance_campaign_lead` (string equality + an offset guard: an offset-less string would parse as LOCAL
 *     time in JS and hide the bug, while Postgres timestamptz reads it as UTC);
 *   - `created_by` = `user_id` = the dialing agent;
 *   - ONE silent Calendar refresh after a successful scheduler write, none after a failed one;
 *   - a failed shadow write never blocks the call save or the canonical advancement.
 *
 * Process boundaries are mocked (Supabase client, auth/org/Twilio/branding/permission contexts, toast); the
 * dialer-api WRITERS run for real. TimeSelect (a Radix Select) is swapped for a native input that emits the
 * same "h:mm AM/PM" values. Run under `TZ=UTC` and `TZ=America/Los_Angeles`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { ORG, USER, CAMP, CL, LEAD, CLIENT, STAGE } = vi.hoisted(() => ({
  ORG: "aaaaaaaa-0000-4000-8000-00000000000a",
  USER: "bbbbbbbb-0000-4000-8000-00000000000b",
  CAMP: "cccccccc-0000-4000-8000-00000000000c",
  CL: "dddddddd-0000-4000-8000-00000000000d",
  LEAD: "eeeeeeee-0000-4000-8000-00000000000e",
  CLIENT: "ffffffff-0000-4000-8000-00000000000f",
  STAGE: "99999999-0000-4000-8000-000000000009",
}));

const h = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; op: string; payload: unknown }>,
  rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
  events: [] as string[],
  failAppointmentInsert: false,
  /** Fail only the appointments INSERTs whose payload matches (e.g. the appointment but not the shadow). */
  failAppointmentWhen: null as null | ((payload: Record<string, unknown>) => boolean),
  /** How the Calendar refresh behaves: resolves, rejects, throws synchronously, or is missing entirely. */
  refreshMode: "resolve" as "resolve" | "reject" | "throw" | "missing",
  tableData: {} as Record<string, unknown[]>,
  campaignType: "Personal",
  fetchAppointments: vi.fn(async (_opts?: { silent?: boolean }) => {}),
  toast: Object.assign(vi.fn(), {
    error: vi.fn(), success: vi.fn(), loading: vi.fn(() => "tid"), dismiss: vi.fn(),
    info: vi.fn(), warning: vi.fn(), message: vi.fn(),
  }),
}));

const LEAD_ROW = {
  id: CL, lead_id: LEAD, campaign_id: CAMP, first_name: "Jane", last_name: "Probe", phone: "+15125550123",
  email: "jane@probe.local", state: "TX", status: "Queued", call_attempts: 0, last_called_at: null,
};

function makeBuilder(table: string) {
  let op = "select";
  let single = false;
  let writePayload: unknown = null;
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "gt", "lte", "lt", "like", "ilike",
    "contains", "order", "limit", "range", "or", "filter", "match", "abortSignal", "csv"]) b[m] = () => b;
  const write = (kind: string) => (payload?: unknown) => {
    op = kind;
    writePayload = payload;
    h.writes.push({ table, op: kind, payload });
    h.events.push(`${kind}:${table}`);
    return b;
  };
  b.insert = write("insert"); b.update = write("update"); b.upsert = write("upsert"); b.delete = write("delete");
  b.single = () => { single = true; return b; };
  b.maybeSingle = () => { single = true; return b; };
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const failThisInsert =
      h.failAppointmentInsert || (h.failAppointmentWhen?.((writePayload ?? {}) as Record<string, unknown>) ?? false);
    if (table === "appointments" && op === "insert" && failThisInsert) {
      return Promise.resolve({ data: null, error: { message: "boom:appointments" } }).then(res, rej);
    }
    const rows = h.tableData[table] ?? [];
    const data = op === "select" ? (single ? rows[0] ?? null : rows) : null;
    return Promise.resolve({ data, error: null }).then(res, rej);
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => makeBuilder(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      h.rpc.push({ name, args });
      h.events.push(`rpc:${name}`);
      if (name === "advance_campaign_lead") {
        return Promise.resolve({ data: {
          id: args.p_campaign_lead_id, call_attempts: 1, last_called_at: new Date().toISOString(),
          retry_eligible_at: null, status: "Called", callback_due_at: args.p_callback_due_at,
          scheduled_callback_at: args.p_callback_due_at, callback_agent_id: USER,
        }, error: null });
      }
      if (name === "get_next_queue_lead") return Promise.resolve({ data: [LEAD_ROW], error: null });
      if (name === "renew_lead_lock" || name === "release_lead_lock") return Promise.resolve({ data: true, error: null });
      if (name === "start_dialer_session") {
        return Promise.resolve({ data: { id: "sess-1", campaign_id: CAMP, started_at: new Date().toISOString() }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: { id: USER } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe() {} }; return ch; },
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({ toast: h.toast, Toaster: () => null }));

// Every mocked hook returns the SAME object on every render (a fresh object per render re-runs effects).
const stable = vi.hoisted(() => {
  const profile = { id: "bbbbbbbb-0000-4000-8000-00000000000b", organization_id: "aaaaaaaa-0000-4000-8000-00000000000a", role: "Agent", status: "Active", first_name: "QA", last_name: "Agent" };
  const auth = { user: { id: profile.id, email: "qa@dialer.test" }, profile, realProfile: profile, session: {}, loading: false, isImpersonating: false };
  const org = { organizationId: profile.organization_id, loading: false };
  const twilio = {
    status: "ready", errorMessage: null, callState: "idle", callDuration: 0,
    currentCall: null, availableNumbers: [], selectedCallerNumber: null,
    setSelectedCallerNumber: () => {}, makeCall: async () => null, hangUp: () => {},
    lastCallDirection: null, hangUpOrphan: () => {}, dismissOrphanCall: () => {},
    orphanCall: null, initializeClient: async () => {}, destroyClient: () => {},
    getSmartCallerId: async () => null, setCallerIdCampaignGroupId: () => {},
    applyDialSessionRingTimeout: () => {},
  };
  const branding = { formatDate: (d: unknown) => String(d), formatDateTime: (d: unknown) => String(d), branding: {} };
  const perms = { isLoading: false, permissions: {}, has: () => true, getDataScope: () => "own", hasFeatureAccess: () => false, hasContactsPermission: () => true };
  return { auth, org, twilio, branding, perms };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => stable.auth }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => stable.org }));
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => stable.twilio }));
vi.mock("@/contexts/BrandingContext", () => ({ useBranding: () => stable.branding }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => stable.perms }));

// CalendarContext: `addAppointment` is exposed ONLY to prove the Dialer never calls it; the Dialer's
// Calendar synchronisation is the silent `fetchAppointments` refresh.
const calendar = vi.hoisted(() => ({ v: null as null | Record<string, unknown>, addAppointment: vi.fn(async () => ({})) }));
vi.mock("@/contexts/CalendarContext", () => ({
  // Built once per test (reset in beforeEach) so the value is stable across renders.
  useCalendar: () => (calendar.v ??= {
    addAppointment: calendar.addAppointment,
    ...(h.refreshMode === "missing"
      ? {}
      : {
          fetchAppointments: (opts?: { silent?: boolean }) => {
            h.events.push("calendar:fetchAppointments");
            void h.fetchAppointments(opts);
            if (h.refreshMode === "throw") throw new Error("refresh threw synchronously");
            if (h.refreshMode === "reject") return Promise.reject(new Error("refresh rejected"));
            return Promise.resolve();
          },
        }),
  }),
}));

// Radix Select → native input; the emitted value format ("h:mm AM/PM") is unchanged.
vi.mock("@/components/dialer/TimeSelect", () => {
  const TimeSelect = ({ value, onChange, "aria-label": aria }: { value?: string; onChange: (v: string) => void; "aria-label"?: string }) =>
    React.createElement("input", { "aria-label": aria, value: value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) });
  return { default: TimeSelect, TimeSelect };
});

// ConvertLeadModal → completes the conversion to CLIENT when opened (the real modal's success contract:
// onSuccess(clientId) then onClose()).
vi.mock("@/components/contacts/ConvertLeadModal", () => ({
  default: ({ open, onSuccess, onClose }: { open: boolean; onSuccess: (id: string) => void; onClose: () => void }) =>
    open
      ? React.createElement("button", { onClick: () => { onSuccess(CLIENT); onClose(); } }, "Complete conversion (test)")
      : null,
}));

const { DISPS } = vi.hoisted(() => {
  const base = {
    color: "#00f", isLocked: false, requireNotes: false, minNoteChars: 0, automationTrigger: false,
    campaignAction: "none", dncAutoAdd: false, countsAsContacted: true, usageCount: 0, createdAt: "", updatedAt: "",
  };
  return { DISPS: [
    { ...base, id: "f0000000-0000-4000-8000-000000000001", name: "Call Back", order: 1, callbackScheduler: true, appointmentScheduler: false, pipelineStageId: null },
    { ...base, id: "f0000000-0000-4000-8000-000000000002", name: "Appt Set", order: 2, callbackScheduler: false, appointmentScheduler: true, pipelineStageId: null },
    { ...base, id: "f0000000-0000-4000-8000-000000000003", name: "Both Sched", order: 3, callbackScheduler: true, appointmentScheduler: true, pipelineStageId: null },
    { ...base, id: "f0000000-0000-4000-8000-000000000004", name: "Sold Later", order: 4, callbackScheduler: true, appointmentScheduler: false, pipelineStageId: "99999999-0000-4000-8000-000000000009" },
  ] };
});
vi.mock("@/lib/supabase-dispositions", async (orig) => ({
  ...(await orig<object>()),
  dispositionsSupabaseApi: { getAll: vi.fn(async () => DISPS) },
}));

// Only the dialer-api READ helpers are stubbed; saveAppointment / saveCall / saveNote / updateLeadStatus /
// advanceCampaignLead run for real against the mocked client. saveAppointment is spied (call count).
const api = vi.hoisted(() => ({ saveAppointmentSpy: vi.fn() }));
vi.mock("@/lib/dialer-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/dialer-api")>();
  return {
    ...actual,
    getCampaignLeads: vi.fn(async () => [LEAD_ROW]),
    getLeadHistory: vi.fn(async () => []),
    getContactCallStats: vi.fn(async () => ({})),
    saveAppointment: (...args: Parameters<typeof actual.saveAppointment>) => {
      api.saveAppointmentSpy(...args);
      return actual.saveAppointment(...args);
    },
  };
});

import DialerPage from "@/pages/DialerPage";

/** An offset-bearing ISO instant (see header). */
const ABSOLUTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;

beforeEach(() => {
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as Record<string, unknown>).IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  h.writes = []; h.rpc = []; h.events = []; h.failAppointmentInsert = false; h.campaignType = "Personal";
  h.failAppointmentWhen = null; h.refreshMode = "resolve"; calendar.v = null;
  h.tableData = {};
  calendar.addAppointment.mockClear(); h.fetchAppointments.mockClear(); api.saveAppointmentSpy.mockClear();
  for (const k of ["error", "success", "loading", "dismiss", "info"] as const) h.toast[k].mockClear();
});
afterEach(() => { cleanup(); });

async function mountOnLead(campaignType: "Personal" | "Team" = "Personal") {
  h.campaignType = campaignType;
  h.tableData = {
    campaigns: [{ id: CAMP, name: "Mine", type: campaignType, status: "Active", user_id: USER, assigned_agent_ids: [USER], created_by: USER }],
    // One converting lead stage (read by the conversion gate and the lead-status colour lookup).
    pipeline_stages: [{ id: STAGE, name: "Sold", color: "#22c55e", convert_to_client: true, pipeline_type: "lead", order: 1 }],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(
    <MemoryRouter initialEntries={[`/dialer?campaign=${CAMP}`]}>
      <QueryClientProvider client={qc}><DialerPage /></QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: /^call back$/i }, { timeout: 8000 });
}

function pickDisposition(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function fillCallback(ymd: string, time: string) {
  const section = screen.getByText("Schedule Callback").parentElement!;
  fireEvent.change(section.querySelector('input[type="date"]')!, { target: { value: ymd } });
  fireEvent.change(screen.getByLabelText("Callback time"), { target: { value: time } });
}
function fillAppointment(ymd: string, start: string, end: string) {
  const section = screen.getByText("Schedule Appointment").parentElement!;
  fireEvent.change(section.querySelector('input[type="date"]')!, { target: { value: ymd } });
  fireEvent.change(screen.getByLabelText("Appointment start time"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("Appointment end time"), { target: { value: end } });
}
async function save(which: "Save" | "Save & Next") {
  fireEvent.click(screen.getByRole("button", { name: which === "Save" ? /^save$/i : /^save & next$/i }));
  await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(expect.stringMatching(/saved successfully/i), expect.anything()), { timeout: 8000 });
}

const appointmentInserts = () =>
  h.writes.filter((w) => w.table === "appointments" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
const advanceCalls = () => h.rpc.filter((r) => r.name === "advance_campaign_lead");
const canonicalDue = () => advanceCalls()[0]?.args.p_callback_due_at as string | undefined;

function expectSilentRefreshAfterInserts(expectedInserts: number) {
  expect(h.fetchAppointments).toHaveBeenCalledTimes(1);
  expect(h.fetchAppointments).toHaveBeenCalledWith({ silent: true });
  const lastInsert = h.events.lastIndexOf("insert:appointments");
  expect(h.events.filter((e) => e === "insert:appointments")).toHaveLength(expectedInserts);
  expect(h.events.indexOf("calendar:fetchAppointments")).toBeGreaterThan(lastInsert);
}

describe.each(["Save", "Save & Next"] as const)("Personal campaign — %s", (which) => {
  it("callback: ONE shadow insert at exactly the canonical callback instant, created_by = user_id = agent, one silent refresh", async () => {
    await mountOnLead("Personal");
    pickDisposition(/^call back$/i);
    fillCallback("2026-10-15", "2:30 PM");
    await save(which);

    expect(api.saveAppointmentSpy).toHaveBeenCalledTimes(1);
    expect(calendar.addAppointment).not.toHaveBeenCalled();
    const inserts = appointmentInserts();
    expect(inserts).toHaveLength(1);
    const shadow = inserts[0];
    expect(shadow.title).toBe("Callback");

    // Canonical campaign callback instant (unchanged DialerPage computation) → advance_campaign_lead.
    expect(advanceCalls()).toHaveLength(1);
    const due = canonicalDue();
    expect(due).toBe(new Date(2026, 9, 15, 14, 30).toISOString());
    // THE regression: the shadow is the same absolute instant, as an offset-bearing string.
    expect(shadow.start_time).toMatch(ABSOLUTE_ISO);
    expect(shadow.start_time).toBe(due);
    expect(shadow.end_time).toBeNull();

    expect(shadow.user_id).toBe(USER);
    expect(shadow.created_by).toBe(USER);
    expect(shadow.organization_id).toBe(ORG);
    expect(shadow.contact_id).toBe(LEAD);
    expect(shadow.status).toBe("Scheduled");
    expect(shadow).not.toHaveProperty("type");

    expectSilentRefreshAfterInserts(1);
  }, 30000);

  it("appointment: ONE insert with absolute start/end instants, created_by = agent, one silent refresh", async () => {
    await mountOnLead("Personal");
    pickDisposition(/^appt set$/i);
    fillAppointment("2026-10-15", "2:30 PM", "3:00 PM");
    await save(which);

    expect(api.saveAppointmentSpy).toHaveBeenCalledTimes(1);
    expect(calendar.addAppointment).not.toHaveBeenCalled();
    const inserts = appointmentInserts();
    expect(inserts).toHaveLength(1);
    const appt = inserts[0];
    expect(appt.start_time).toMatch(ABSOLUTE_ISO);
    expect(appt.end_time).toMatch(ABSOLUTE_ISO);
    expect(appt.start_time).toBe(new Date(2026, 9, 15, 14, 30).toISOString());
    expect(appt.end_time).toBe(new Date(2026, 9, 15, 15, 0).toISOString());
    expect(appt.user_id).toBe(USER);
    expect(appt.created_by).toBe(USER);
    expect(appt.organization_id).toBe(ORG);
    expectSilentRefreshAfterInserts(1);
  }, 30000);
});

describe("Personal campaign — other cases", () => {
  it("both schedulers on one disposition: exactly TWO intentional inserts (appointment + callback shadow), one refresh", async () => {
    await mountOnLead("Personal");
    pickDisposition(/^both sched$/i);
    fillAppointment("2026-10-15", "10:00 AM", "10:30 AM");
    fillCallback("2026-10-16", "9:15 AM");
    await save("Save");

    expect(api.saveAppointmentSpy).toHaveBeenCalledTimes(2);
    expect(calendar.addAppointment).not.toHaveBeenCalled();
    const inserts = appointmentInserts();
    expect(inserts).toHaveLength(2);
    const shadow = inserts.find((p) => p.title === "Callback")!;
    const appt = inserts.find((p) => p.title !== "Callback")!;
    expect(appt.start_time).toBe(new Date(2026, 9, 15, 10, 0).toISOString());
    expect(shadow.start_time).toMatch(ABSOLUTE_ISO);
    expect(shadow.start_time).toBe(canonicalDue());
    expect(shadow.start_time).toBe(new Date(2026, 9, 16, 9, 15).toISOString());
    for (const p of inserts) {
      expect(p.created_by).toBe(USER);
      expect(p.user_id).toBe(USER);
    }
    expectSilentRefreshAfterInserts(2);
  }, 30000);

  it("a failed shadow write stays non-blocking: call saved, canonical advancement unchanged, no refresh", async () => {
    h.failAppointmentInsert = true;
    await mountOnLead("Personal");
    pickDisposition(/^call back$/i);
    fillCallback("2026-10-15", "2:30 PM");
    await save("Save");

    expect(h.toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Callback may not have saved — continuing call save: boom:appointments/), expect.anything());
    expect(h.writes.some((w) => w.table === "calls")).toBe(true);
    expect(advanceCalls()).toHaveLength(1);
    expect(canonicalDue()).toBe(new Date(2026, 9, 15, 14, 30).toISOString());
    expect(h.toast.success).toHaveBeenCalledWith("Call saved successfully", expect.anything());
    expect(h.fetchAppointments).not.toHaveBeenCalled();
    expect(calendar.addAppointment).not.toHaveBeenCalled();
  }, 30000);

  it("conversion path: the shadow attaches to the NEW client id, still one insert at the canonical instant", async () => {
    await mountOnLead("Personal");
    pickDisposition(/^sold later$/i);
    fillCallback("2026-10-15", "2:30 PM");
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /complete conversion \(test\)/i }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Call saved successfully", expect.anything()), { timeout: 8000 });

    const inserts = appointmentInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].contact_id).toBe(CLIENT);
    expect(inserts[0].start_time).toBe(canonicalDue());
    expect(inserts[0].created_by).toBe(USER);
    expect(calendar.addAppointment).not.toHaveBeenCalled();
    expectSilentRefreshAfterInserts(1);
  }, 30000);
});

describe("Team/Open campaign (lock mode)", () => {
  it("Save & Next callback: ONE shadow insert at exactly the canonical callback instant, one refresh, lock released", async () => {
    await mountOnLead("Team");
    pickDisposition(/^call back$/i);
    fillCallback("2026-10-15", "2:30 PM");
    await save("Save & Next");

    expect(api.saveAppointmentSpy).toHaveBeenCalledTimes(1);
    expect(calendar.addAppointment).not.toHaveBeenCalled();
    const inserts = appointmentInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].start_time).toMatch(ABSOLUTE_ISO);
    expect(advanceCalls()).toHaveLength(1);
    expect(inserts[0].start_time).toBe(canonicalDue());
    expect(inserts[0].created_by).toBe(USER);
    expect(inserts[0].user_id).toBe(USER);
    expectSilentRefreshAfterInserts(1);
    // Team/Open lifecycle continues exactly as before: the lock is released and the next lead requested.
    await waitFor(() => expect(h.rpc.some((r) => r.name === "release_lead_lock")).toBe(true));
  }, 30000);
});

describe("failure isolation", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  beforeEach(() => { unhandled.length = 0; process.on("unhandledRejection", onUnhandled); });
  afterEach(() => { process.off("unhandledRejection", onUnhandled); });

  const noScheduleFailureToast = () =>
    expect(h.toast.error.mock.calls.map((c) => String(c[0])).filter((m) => /may not have saved/.test(m))).toEqual([]);

  it.each(["reject", "throw", "missing"] as const)(
    "a Calendar refresh that %s never makes the saved callback look failed or blocks the save",
    async (mode) => {
      h.refreshMode = mode;
      await mountOnLead("Personal");
      pickDisposition(/^call back$/i);
      fillCallback("2026-10-15", "2:30 PM");
      await save("Save & Next");

      expect(appointmentInserts()).toHaveLength(1);
      expect(appointmentInserts()[0].start_time).toBe(canonicalDue());
      expect(advanceCalls()).toHaveLength(1);
      expect(h.writes.some((w) => w.table === "calls")).toBe(true);
      expect(h.toast.success).toHaveBeenCalledWith("Saved successfully", expect.anything());
      noScheduleFailureToast();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    },
    30000,
  );

  it("an appointment write that fails on its own: no refresh, call saved, canonical advancement unchanged", async () => {
    h.failAppointmentWhen = (p) => p.title !== "Callback";
    await mountOnLead("Personal");
    pickDisposition(/^appt set$/i);
    fillAppointment("2026-10-15", "2:30 PM", "3:00 PM");
    await save("Save");

    expect(h.toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Appointment may not have saved — continuing call save: boom:appointments/), expect.anything());
    expect(h.fetchAppointments).not.toHaveBeenCalled();
    expect(advanceCalls()).toHaveLength(1);
    expect(h.writes.some((w) => w.table === "calls")).toBe(true);
    expect(h.toast.success).toHaveBeenCalledWith("Call saved successfully", expect.anything());
    expect(calendar.addAppointment).not.toHaveBeenCalled();
  }, 30000);

  it("mixed: the appointment fails but the callback shadow succeeds — exactly one refresh, after the shadow", async () => {
    h.failAppointmentWhen = (p) => p.title !== "Callback";
    await mountOnLead("Personal");
    pickDisposition(/^both sched$/i);
    fillAppointment("2026-10-15", "10:00 AM", "10:30 AM");
    fillCallback("2026-10-16", "9:15 AM");
    await save("Save");

    expect(api.saveAppointmentSpy).toHaveBeenCalledTimes(2);
    const shadow = appointmentInserts().find((p) => p.title === "Callback")!;
    expect(shadow.start_time).toBe(canonicalDue());
    expect(h.toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Appointment may not have saved/), expect.anything());
    expect(h.fetchAppointments).toHaveBeenCalledTimes(1);
    expect(h.fetchAppointments).toHaveBeenCalledWith({ silent: true });
    expect(h.events.indexOf("calendar:fetchAppointments")).toBeGreaterThan(h.events.lastIndexOf("insert:appointments"));
    expect(calendar.addAppointment).not.toHaveBeenCalled();
  }, 30000);
});
