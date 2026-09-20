/**
 * Duplicate-detection parity on the contact deep links — `/leads/:id`, `/clients/:id`,
 * `/recruits/:id`.
 *
 * THE GAP THESE PIN. The agency's Contact Management settings (`duplicate_detection_rule`,
 * `duplicate_detection_scope`, `manual_action`) were enforced on the Contacts page but NOT on the
 * deep-link pages, so the very same full-record edit that the Contacts surface blocked or warned
 * about saved silently from `/leads/:id`. Clients and recruits had the same hole on BOTH
 * full-screen surfaces even though their Add / Edit modals had always enforced it.
 *
 * A REFUSAL IS NOT A SUCCESS. `FullScreenContactView` treats a resolved `onUpdate` as proof the
 * write happened — it exits edit mode, clears the dirty flags, writes a "<Type> details updated"
 * activity row and toasts success. So a blocked duplicate, or a cancelled warning, must REJECT.
 * These tests assert that on every path, by counting the UPDATEs that actually reached the stub.
 *
 * The REAL page, the REAL `FullScreenContactView`, the REAL `findDuplicates` and the REAL canonical
 * update APIs all run here; only Supabase itself is stubbed.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";

const ORG = "0f000000-0000-4000-8000-0000000000aa";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const RECRUIT_ID = "44444444-4444-4444-8444-444444444444";
const AGENT_ID = "aaaa0000-0000-4000-8000-000000000001";

const CONTACT_TABLES = new Set(["leads", "clients", "recruits"]);

const db = vi.hoisted(() => ({
  contacts: {} as Record<string, Record<string, unknown>>,
  singles: {} as Record<string, unknown>,
  lists: {} as Record<string, unknown[]>,
  /** Rows the duplicate lookup will see, per table. */
  duplicates: {} as Record<string, unknown[]>,
  ops: [] as {
    table: string; kind: string; id: string | null;
    payload?: Record<string, unknown>; eq: [string, unknown][]; neq: [string, unknown][];
  }[],
  duplicateLookupError: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    const eq: [string, unknown][] = [];
    const neq: [string, unknown][] = [];
    let kind: "select" | "update" | "delete" = "select";
    let payload: Record<string, unknown> = {};
    const idOf = () => { const hit = eq.find(([c]) => c === "id"); return hit ? String(hit[1]) : null; };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { eq.push([c, v]); return b; },
      neq: (c: string, v: unknown) => { neq.push([c, v]); return b; },
      in: () => b, or: () => b, not: () => b, is: () => b,
      order: () => b, limit: () => b, range: () => b, gte: () => b, lt: () => b, lte: () => b,
      update: (p: Record<string, unknown>) => { kind = "update"; payload = p; return b; },
      insert: (p: Record<string, unknown>) => { kind = "update"; payload = p; return b; },
      delete: () => { kind = "delete"; return b; },
      maybeSingle: () => run("single"),
      single: () => run("single"),
      then: (resolve: (v: unknown) => unknown) => run("list").then(resolve),
    };

    function run(shape: "single" | "list") {
      const id = idOf();
      if (kind === "update") {
        db.ops.push({ table, kind: "update", id, payload, eq, neq });
        const next = { ...(id ? db.contacts[id] ?? {} : {}), ...payload };
        if (CONTACT_TABLES.has(table) && id) db.contacts[id] = next;
        return Promise.resolve({ data: next, error: null });
      }
      if (shape === "single") {
        db.ops.push({ table, kind: "select", id, eq, neq });
        const data = CONTACT_TABLES.has(table)
          ? (id ? db.contacts[id] ?? null : null)
          : db.singles[table] ?? null;
        return Promise.resolve({ data, error: null });
      }
      db.ops.push({ table, kind: "list", id, eq, neq });
      if (CONTACT_TABLES.has(table) && db.duplicateLookupError) {
        return Promise.resolve({ data: null, error: { message: "permission denied" } });
      }
      const data = CONTACT_TABLES.has(table) ? db.duplicates[table] ?? [] : db.lists[table] ?? [];
      return Promise.resolve({ data, error: null, count: (data as unknown[]).length });
    }

    return b;
  }
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    },
  };
});

const h = vi.hoisted(() => ({ routeId: "" }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: h.routeId }), useNavigate: () => vi.fn() }));

const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("sonner", () => ({
  toast: {
    success: (m: unknown) => { toasts.success.push(String(m)); },
    error: (m: unknown) => { toasts.error.push(String(m)); },
    message: () => {}, info: () => {},
  },
}));

const activityAdd = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/supabase-notes", () => ({
  notesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "n1" })) },
}));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: {
    getByContact: vi.fn(async () => []),
    add: vi.fn(async (p: unknown) => { activityAdd.calls.push(p); return { id: "a1" }; }),
  },
}));

const settingsState = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
  loads: 0,
  fail: false,
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
  contactManagementSettingsSupabaseApi: {
    getSettings: vi.fn(async () => {
      settingsState.loads += 1;
      if (settingsState.fail) throw new Error("settings unavailable");
      return settingsState.value;
    }),
  },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { id: "user-1", first_name: "Alexa", last_name: "Segura" } }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: string) => v, formatDateTime: (v: string) => v, branding: { companyName: "AgentFlow" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("@/components/contacts/TasksPanel", () => ({ TasksPanel: () => null }));

import ContactDeepLinkPage from "@/pages/ContactDeepLinkPage";

type Kind = "lead" | "client" | "recruit";

const FIXTURES: Record<Kind, { id: string; table: string; row: Record<string, unknown>; phoneDisplay: string }> = {
  lead: {
    id: LEAD_ID, table: "leads", phoneDisplay: "(512) 555-0123",
    row: {
      id: LEAD_ID, first_name: "Charlotte", last_name: "Kearney",
      phone: "5125550123", email: "charlotte@example.com", state: "TX", status: "New",
      lead_source: "Facebook Ads", lead_score: 7, assigned_agent_id: AGENT_ID,
      organization_id: ORG, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    },
  },
  client: {
    id: CLIENT_ID, table: "clients", phoneDisplay: "(512) 555-0124",
    row: {
      id: CLIENT_ID, first_name: "Marcus", last_name: "Webb",
      phone: "5125550124", email: "marcus@example.com", state: "TX",
      policy_type: "Term", carrier: "Mutual", premium: 120, face_amount: 250000,
      assigned_agent_id: AGENT_ID,
      organization_id: ORG, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    },
  },
  recruit: {
    id: RECRUIT_ID, table: "recruits", phoneDisplay: "(512) 555-0125",
    row: {
      id: RECRUIT_ID, first_name: "Dana", last_name: "Olsen",
      phone: "5125550125", email: "dana@example.com", state: "TX", status: "Prospect",
      assigned_agent_id: AGENT_ID,
      organization_id: ORG, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    },
  },
};

/** A row that will match on phone under the default `phone_or_email` rule. */
const duplicateRow = (phone: string) => ({
  id: "existing-duplicate",
  first_name: "Someone", last_name: "Else",
  phone, email: "someone@example.com", assigned_agent_id: AGENT_ID,
});

beforeEach(() => {
  db.contacts = {}; db.singles = {}; db.lists = {}; db.duplicates = {}; db.ops = [];
  db.duplicateLookupError = false;
  settingsState.value = null; settingsState.loads = 0; settingsState.fail = false;
  activityAdd.calls = []; toasts.success = []; toasts.error = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function mount(kind: Kind) {
  const f = FIXTURES[kind];
  db.contacts[f.id] = { ...f.row };
  h.routeId = f.id;
  render(<ContactDeepLinkPage contactType={kind} />);
  await screen.findByRole("button", { name: /^call$/i });
  db.ops = [];
  return f;
}

const clickEdit = async () => fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
const clickSave = async () => fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

const updatesTo = (table: string) => db.ops.filter((o) => o.table === table && o.kind === "update");
const lookupsOn = (table: string) => db.ops.filter((o) => o.table === table && o.kind === "list");

/** Change the phone to one that already belongs to another contact, then save. */
async function editPhoneAndSave(f: { phoneDisplay: string }) {
  await clickEdit();
  fireEvent.change(screen.getByDisplayValue(f.phoneDisplay), { target: { value: "5125559999" } });
  await clickSave();
}

const KINDS: Kind[] = ["lead", "client", "recruit"];

describe.each(KINDS)("deep link — %s: the agency's duplicate settings are enforced", (kind) => {
  it("manual_action = block → zero UPDATEs, still editing, no success, no activity", async () => {
    settingsState.value = { manualAction: "block" };
    const f = await mount(kind);
    db.duplicates[f.table] = [duplicateRow("15125559999")];

    await editPhoneAndSave(f);

    await waitFor(() => expect(toasts.error.some((t) => /blocked by agency settings/i.test(t))).toBe(true));
    expect(updatesTo(f.table)).toHaveLength(0);
    expect(toasts.success).toEqual([]);
    expect(activityAdd.calls).toHaveLength(0);
    // Still in edit mode with the typed value intact — a refusal must not look like a save.
    expect(screen.getByDisplayValue("(512) 555-9999")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    // And nothing was written.
    expect(db.contacts[f.id].phone).toBe(f.row.phone);
  });

  it("manual_action = warn + Cancel → zero UPDATEs, still editing, no success, no activity", async () => {
    settingsState.value = { manualAction: "warn" };
    const f = await mount(kind);
    db.duplicates[f.table] = [duplicateRow("15125559999")];

    await editPhoneAndSave(f);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/possible duplicate/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updatesTo(f.table)).toHaveLength(0);
    expect(toasts.success).toEqual([]);
    expect(activityAdd.calls).toHaveLength(0);
    expect(screen.getByDisplayValue("(512) 555-9999")).toBeInTheDocument();
    expect(db.contacts[f.id].phone).toBe(f.row.phone);
  });

  it("manual_action = warn + Save Anyway → exactly ONE canonical UPDATE", async () => {
    settingsState.value = { manualAction: "warn" };
    const f = await mount(kind);
    db.duplicates[f.table] = [duplicateRow("15125559999")];

    await editPhoneAndSave(f);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /save anyway/i }));

    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(1));
    expect(db.contacts[f.id].phone).toBe("15125559999");
    await waitFor(() => expect(toasts.success).toHaveLength(1));
    expect(activityAdd.calls).toHaveLength(1);
  });

  it("manual_action = allow → one UPDATE, no prompt", async () => {
    settingsState.value = { manualAction: "allow" };
    const f = await mount(kind);
    db.duplicates[f.table] = [duplicateRow("15125559999")];

    await editPhoneAndSave(f);

    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.contacts[f.id].phone).toBe("15125559999");
  });

  it("no duplicate match → one UPDATE, no prompt", async () => {
    settingsState.value = { manualAction: "block" };
    const f = await mount(kind);
    db.duplicates[f.table] = [];

    await editPhoneAndSave(f);

    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts.success).toEqual([`${kind[0].toUpperCase()}${kind.slice(1)} updated successfully`]);
  });

  it("the lookup excludes the contact's OWN id, so it never flags itself", async () => {
    settingsState.value = { manualAction: "block" };
    const f = await mount(kind);

    await editPhoneAndSave(f);

    await waitFor(() => expect(lookupsOn(f.table)).toHaveLength(1));
    expect(lookupsOn(f.table)[0].neq).toContainEqual(["id", f.id]);
    expect(lookupsOn(f.table)[0].eq).toContainEqual(["organization_id", ORG]);
  });
});

describe("deep link — the gate, the fail-open posture and the settings round trip", () => {
  it("a { status }-only update runs NO duplicate lookup", async () => {
    settingsState.value = { manualAction: "block" };
    const f = await mount("lead");
    db.duplicates[f.table] = [duplicateRow("5125550123")];

    // The status dropdown sends a partial payload that cannot match on phone or email.
    fireEvent.click(await screen.findByRole("button", { name: /new/i }));
    const option = await screen.findByRole("button", { name: /contacted/i });
    fireEvent.click(option);

    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(1));
    expect(lookupsOn(f.table)).toHaveLength(0);
    expect(settingsState.loads).toBe(0);
  });

  it("a duplicate-lookup FAILURE does not block the save (documented fail-open posture)", async () => {
    settingsState.value = { manualAction: "block" };
    const f = await mount("lead");
    db.duplicateLookupError = true;

    await editPhoneAndSave(f);

    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(1));
    expect(db.contacts[f.id].phone).toBe("15125559999");
    expect(toasts.success).toEqual(["Lead updated successfully"]);
  });

  it("a settings-read FAILURE falls back to the defaults and still enforces them", async () => {
    settingsState.fail = true;
    const f = await mount("lead");
    db.duplicates[f.table] = [duplicateRow("15125559999")];

    await editPhoneAndSave(f);

    // Defaults are phone_or_email + warn, so the prompt appears rather than the save going through.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(updatesTo(f.table)).toHaveLength(0);
  });

  it("settings are read once per organization, not once per save", async () => {
    settingsState.value = { manualAction: "allow" };
    const f = await mount("lead");

    await editPhoneAndSave(f);
    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(1));

    await clickEdit();
    fireEvent.change(screen.getByDisplayValue("charlotte@example.com"), { target: { value: "x@example.com" } });
    await clickSave();
    await waitFor(() => expect(updatesTo(f.table)).toHaveLength(2));

    expect(settingsState.loads).toBe(1);
  });

  it("reading a deep link without saving costs no settings read and no duplicate lookup", async () => {
    settingsState.value = { manualAction: "block" };
    const f = await mount("lead");
    expect(settingsState.loads).toBe(0);
    expect(lookupsOn(f.table)).toHaveLength(0);
  });
});
