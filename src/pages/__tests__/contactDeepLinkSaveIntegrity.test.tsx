/**
 * Deep-linked contact save integrity — `/leads/:id`, `/clients/:id`, `/recruits/:id`.
 *
 * THE DEFECT THESE PIN (AGENT_RULES invariant #35 open follow-up 3, and the R4 exclusion recorded
 * in WORK_LOG.md:2331). `ContactDeepLinkPage.handleUpdate` used to:
 *
 *     SELECT the row  →  setContact(that PRE-UPDATE row)  →  UPDATE  →  discard what it returned
 *
 * `FullScreenContactView` renders its own `editForm` for the field grid but reads the PARENT
 * `contact` prop for Quick Call, SMS, Email, the record header, the template merge input,
 * appointment prefill and the assigned-agent load. So after saving phone 1111 → 2222 the screen
 * showed 2222 while Call and SMS still dialled 1111 — and because `handleCancel` reseeds the form
 * from that stale parent, a later unrelated edit wrote 1111 back over the committed 2222.
 *
 * These tests drive the REAL page, the REAL `FullScreenContactView` and the REAL canonical
 * `leadsSupabaseApi` / `clientsSupabaseApi` / `recruitsSupabaseApi` over a STATEFUL Supabase stub,
 * so "the database now holds X" and "exactly one write, zero extra reads" are assertions about
 * operations that actually happened.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QUICK_CALL_EVENT } from "@/lib/quick-call";

const ORG = "0f000000-0000-4000-8000-0000000000aa";
const LEAD_A = "11111111-1111-4111-8111-111111111111";
const LEAD_B = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const RECRUIT_ID = "44444444-4444-4444-8444-444444444444";

const CONTACT_TABLES = new Set(["leads", "clients", "recruits"]);

type Op = { table: string; kind: "select" | "list" | "update"; id: string | null; payload?: Record<string, unknown> };

/**
 * Stateful Supabase stub.
 *
 * `singles` / `contacts` answer `.maybeSingle()` / `.single()`; `lists` / `duplicates` answer a
 * directly-awaited builder. An UPDATE MERGES into the stored row and returns it, so the canonical
 * `update()` really does hand back the saved record and `rowToLead`/`rowToClient`/`rowToRecruit`
 * really do map it.
 */
const db = vi.hoisted(() => ({
  contacts: {} as Record<string, Record<string, unknown>>,
  singles: {} as Record<string, unknown>,
  lists: {} as Record<string, unknown[]>,
  duplicates: {} as Record<string, unknown[]>,
  ops: [] as { table: string; kind: string; id: string | null; payload?: Record<string, unknown> }[],
  /** Hold UPDATEs pending so a save can be made to resolve AFTER the route changed. */
  manualUpdates: false,
  queue: [] as { table: string; id: string | null; settle: () => void; fail: (e: unknown) => void }[],
  updateError: null as string | null,
  /** Stands in for server-side normalisation (state, currency, dates, payment frequency). */
  normalize: null as null | ((row: Record<string, unknown>) => Record<string, unknown>),
}));

vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    const eqs: [string, unknown][] = [];
    let kind: "select" | "update" | "delete" = "select";
    let payload: Record<string, unknown> = {};

    const idOf = () => {
      const hit = eqs.find(([c]) => c === "id");
      return hit ? String(hit[1]) : null;
    };

    const commit = () => {
      const id = idOf();
      const base = { ...((id && db.contacts[id]) || (db.singles[table] as Record<string, unknown>) || {}) };
      const merged = { ...base, ...payload };
      const next = db.normalize ? db.normalize(merged) : merged;
      if (CONTACT_TABLES.has(table) && id) db.contacts[id] = next;
      else db.singles[table] = next;
      return { data: next, error: null };
    };

    const runUpdate = () => {
      db.ops.push({ table, kind: "update", id: idOf(), payload });
      if (db.updateError) return Promise.resolve({ data: null, error: { message: db.updateError } });
      if (!db.manualUpdates) return Promise.resolve(commit());
      return new Promise((resolve, reject) => {
        db.queue.push({
          table,
          id: idOf(),
          settle: () => resolve(commit()),
          fail: (e: unknown) => reject(e),
        });
      });
    };

    const readSingle = () => {
      const id = idOf();
      db.ops.push({ table, kind: "select", id });
      const data = CONTACT_TABLES.has(table)
        ? (id ? db.contacts[id] ?? null : null)
        : db.singles[table] ?? null;
      return Promise.resolve({ data, error: null });
    };

    const readList = () => {
      db.ops.push({ table, kind: "list", id: idOf() });
      const data = CONTACT_TABLES.has(table) ? db.duplicates[table] ?? [] : db.lists[table] ?? [];
      return Promise.resolve({ data, error: null, count: (data as unknown[]).length });
    };

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
      neq: () => b, in: () => b, or: () => b, not: () => b, is: () => b,
      order: () => b, limit: () => b, range: () => b, gte: () => b, lt: () => b, lte: () => b,
      update: (p: Record<string, unknown>) => { kind = "update"; payload = p; return b; },
      insert: (p: Record<string, unknown>) => { kind = "update"; payload = p; return b; },
      delete: () => { kind = "delete"; return b; },
      maybeSingle: () => (kind === "update" ? runUpdate() : readSingle()),
      single: () => (kind === "update" ? runUpdate() : readSingle()),
      then: (resolve: (v: unknown) => unknown) =>
        (kind === "update" ? runUpdate() : readList()).then(resolve),
    };
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
vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: h.routeId }),
  useNavigate: () => vi.fn(),
}));

const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));
vi.mock("sonner", () => ({
  toast: {
    success: (m: unknown) => { toasts.success.push(String(m)); },
    error: (m: unknown) => { toasts.error.push(String(m)); },
    message: () => {},
    info: () => {},
  },
}));

const activityAdd = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/supabase-notes", () => ({
  notesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "n1" })) },
}));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: {
    getByContact: vi.fn(async () => []),
    add: vi.fn(async (payload: unknown) => { activityAdd.calls.push(payload); return { id: "a1" }; }),
  },
}));

const settingsState = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
  loads: 0,
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
  contactManagementSettingsSupabaseApi: {
    getSettings: vi.fn(async () => { settingsState.loads += 1; return settingsState.value; }),
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
  useBranding: () => ({
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
    branding: { companyName: "AgentFlow" },
  }),
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

// ── fixtures ────────────────────────────────────────────────────────────────
const leadRow = (over: Record<string, unknown> = {}) => ({
  id: LEAD_A,
  first_name: "Charlotte",
  last_name: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  lead_source: "Facebook Ads",
  lead_score: 7,
  assigned_agent_id: "aaaa0000-0000-4000-8000-000000000001",
  organization_id: ORG,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const clientRow = () => ({
  id: CLIENT_ID,
  first_name: "Marcus", last_name: "Webb",
  phone: "5125550124", email: "marcus@example.com",
  state: "TX", policy_type: "Term", carrier: "Mutual",
  premium: 120, face_amount: 250000,
  organization_id: ORG,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
});

const recruitRow = () => ({
  id: RECRUIT_ID,
  first_name: "Dana", last_name: "Olsen",
  phone: "5125550125", email: "dana@example.com",
  state: "TX", status: "Prospect",
  organization_id: ORG,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
});

let quickCalls: Record<string, unknown>[] = [];
const captureQuickCall = (e: Event) => quickCalls.push((e as CustomEvent).detail as Record<string, unknown>);

beforeEach(() => {
  db.contacts = {}; db.singles = {}; db.lists = {}; db.duplicates = {};
  db.ops = []; db.queue = []; db.manualUpdates = false; db.updateError = null; db.normalize = null;
  settingsState.value = null; settingsState.loads = 0;
  activityAdd.calls = [];
  toasts.success = []; toasts.error = [];
  quickCalls = [];
  window.addEventListener(QUICK_CALL_EVENT, captureQuickCall);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener(QUICK_CALL_EVENT, captureQuickCall);
  cleanup();
  vi.clearAllMocks();
});

// ── helpers ─────────────────────────────────────────────────────────────────
async function mountLead(row = leadRow()) {
  db.contacts[String(row.id)] = row;
  h.routeId = String(row.id);
  const utils = render(<ContactDeepLinkPage contactType="lead" />);
  await screen.findByRole("button", { name: /^call$/i });
  return utils;
}

const clickEdit = async () => fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
const clickSave = async () => fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
const clickCancel = async () => fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));

/** Type into the field currently showing `current`. */
function typeInto(current: string, next: string) {
  fireEvent.change(screen.getByDisplayValue(current), { target: { value: next } });
}

const contactOps = (table: string) => db.ops.filter((o) => o.table === table);
const updatesTo = (table: string) => contactOps(table).filter((o) => o.kind === "update");

describe("D1 — UPDATE first, and never a pre-update SELECT", () => {
  it("issues exactly ONE operation on the contact table per save, and it is the UPDATE", async () => {
    await mountLead();
    db.ops = [];

    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();

    await waitFor(() => expect(updatesTo("leads")).toHaveLength(1));
    // The pre-update re-read this replaces would appear here as a `select` of the row by id.
    expect(contactOps("leads").filter((o) => o.kind === "select")).toHaveLength(0);
    // The only other contact-table traffic is the duplicate-detection lookup, which is the
    // parity feature this build adds — never a re-read of the row being saved.
    expect(contactOps("leads").map((o) => o.kind)).toEqual(["list", "update"]);
  });

  it("writes the new value and reports success exactly once", async () => {
    await mountLead();
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();

    await waitFor(() => expect(db.contacts[LEAD_A].phone).toBe("15125559999"));
    expect(toasts.success).toEqual(["Lead updated successfully"]);
    expect(toasts.error).toEqual([]);
  });
});

describe("D2 — the returned row becomes the parent, so ACTIONS use the saved values", () => {
  it("Quick Call dials the NEW phone after a save", async () => {
    await mountLead();
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();
    await waitFor(() => expect(toasts.success).toHaveLength(1));

    quickCalls = [];
    fireEvent.click(await screen.findByRole("button", { name: /^call$/i }));
    await waitFor(() => expect(quickCalls).toHaveLength(1));

    // Before the fix this was the PRE-update "5125550123".
    expect(quickCalls[0].phone).toBe("15125559999");
    expect(quickCalls[0].contactId).toBe(LEAD_A);
  });

  it("Quick Call carries the NEW name, and the header shows it", async () => {
    await mountLead();
    await clickEdit();
    typeInto("Charlotte", "Charlie");
    await clickSave();
    await waitFor(() => expect(toasts.success).toHaveLength(1));

    expect(await screen.findByText("Charlie Kearney")).toBeInTheDocument();
    expect(screen.queryByText("Charlotte Kearney")).not.toBeInTheDocument();

    quickCalls = [];
    fireEvent.click(await screen.findByRole("button", { name: /^call$/i }));
    await waitFor(() => expect(quickCalls).toHaveLength(1));
    expect(quickCalls[0].name).toBe("Charlie Kearney");
  });

  it("an email change reaches the parent contact, so the compose path targets the new address", async () => {
    await mountLead();
    await clickEdit();
    typeInto("charlotte@example.com", "new@example.com");
    await clickSave();

    await waitFor(() => expect(db.contacts[LEAD_A].email).toBe("new@example.com"));
    // The parent prop is what the send path reads; prove the view re-rendered from the returned row.
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(screen.queryByText("charlotte@example.com")).not.toBeInTheDocument();
  });

  it("an assigned-agent change lands in the parent contact", async () => {
    const NEW_AGENT = "aaaa0000-0000-4000-8000-000000000002";
    db.lists.profiles = [
      { id: "aaaa0000-0000-4000-8000-000000000001", first_name: "Alexa", last_name: "Segura" },
      { id: NEW_AGENT, first_name: "Jordan", last_name: "Pike" },
    ];
    await mountLead();
    await clickEdit();

    const agentSelect = await screen.findByRole("combobox", { name: "" }).catch(() => null);
    // The assigned-agent control is a plain <select>; pick it by its option set rather than a label.
    const selects = Array.from(document.querySelectorAll("select"));
    const target = selects.find((s) => Array.from(s.options).some((o) => o.value === NEW_AGENT));
    expect(target, "assigned-agent select should be rendered in edit mode").toBeTruthy();
    void agentSelect;
    fireEvent.change(target as HTMLSelectElement, { target: { value: NEW_AGENT } });
    await clickSave();

    await waitFor(() => expect(db.contacts[LEAD_A].assigned_agent_id).toBe(NEW_AGENT));
    await waitFor(() => expect(toasts.success).toHaveLength(1));
  });
});

describe("D3 — the lost update: a committed save survives Edit → Cancel → unrelated edit", () => {
  it("a later unrelated save carries the SAVED phone, never the pre-update one", async () => {
    await mountLead();

    // 1. change phone 5125550123 -> 5125559999 and save
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();
    await waitFor(() => expect(db.contacts[LEAD_A].phone).toBe("15125559999"));

    // 2. re-enter edit, then Cancel — `handleCancel` reseeds editForm from the PARENT contact.
    await clickEdit();
    await clickCancel();

    // 3. edit something unrelated and save the whole form again
    await clickEdit();
    typeInto("charlotte@example.com", "later@example.com");
    await clickSave();

    await waitFor(() => expect(updatesTo("leads")).toHaveLength(2));
    const second = updatesTo("leads")[1].payload as Record<string, unknown>;

    // Before the fix the stale parent put "5125550123" back into this payload and reverted the save.
    expect(second.phone).toBe("15125559999");
    expect(second.email).toBe("later@example.com");
    expect(db.contacts[LEAD_A].phone).toBe("15125559999");
  });
});

describe("D3b — the server-returned value wins over the submitted payload", () => {
  it("a value canonicalised on write is what the view shows and what the NEXT payload carries", async () => {
    // Stands in for any server-side canonicalisation the submitted payload does not carry:
    // normalized state, normalized dates, coerced numerics, a mapper-derived representation.
    db.normalize = (row) => ({ ...row, first_name: String(row.first_name ?? "").toUpperCase() });

    db.contacts[CLIENT_ID] = clientRow();
    h.routeId = CLIENT_ID;
    render(<ContactDeepLinkPage contactType="client" />);
    await screen.findByRole("button", { name: /^call$/i });

    await clickEdit();
    typeInto("Marcus", "marcus");
    await clickSave();
    await waitFor(() => expect(toasts.success).toHaveLength(1));

    // The database canonicalised it on write...
    expect(db.contacts[CLIENT_ID].first_name).toBe("MARCUS");
    // ...and the view adopted the SERVER's value, not the "marcus" that was typed.
    expect(await screen.findByText("MARCUS")).toBeInTheDocument();

    await clickEdit();
    typeInto("marcus@example.com", "marcus2@example.com");
    await clickSave();

    await waitFor(() => expect(updatesTo("clients")).toHaveLength(2));
    expect((updatesTo("clients")[1].payload as Record<string, unknown>).first_name).toBe("MARCUS");
  });
});

describe("D4 — a late save result may never repaint a different contact", () => {
  it("contact A's update resolving after navigating to B leaves B on screen", async () => {
    db.contacts[LEAD_A] = leadRow();
    db.contacts[LEAD_B] = leadRow({ id: LEAD_B, first_name: "Brett", last_name: "Nakamura", phone: "5125557777" });
    h.routeId = LEAD_A;

    const { rerender } = render(<ContactDeepLinkPage contactType="lead" />);
    await screen.findByText("Charlotte Kearney");

    db.manualUpdates = true;
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();
    await waitFor(() => expect(db.queue).toHaveLength(1));

    // Navigate to contact B on the SAME route — React reuses this component instance.
    h.routeId = LEAD_B;
    await act(async () => { rerender(<ContactDeepLinkPage contactType="lead" />); });
    await screen.findByText("Brett Nakamura");

    // Now let A's committed save resolve.
    await act(async () => { db.queue[0].settle(); await Promise.resolve(); });

    // A's write DID land in the database — it was committed; only the stale local echo is dropped.
    expect(db.contacts[LEAD_A].phone).toBe("15125559999");
    // B must still be the record on screen.
    expect(screen.getByText("Brett Nakamura")).toBeInTheDocument();
    expect(screen.queryByText("Charlotte Kearney")).not.toBeInTheDocument();
  });

  it("a save that resolves after unmount updates no state and raises no act() warning", async () => {
    const { unmount } = await mountLead();

    db.manualUpdates = true;
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();
    await waitFor(() => expect(db.queue).toHaveLength(1));

    unmount();
    await act(async () => { db.queue[0].settle(); await Promise.resolve(); });

    expect(db.contacts[LEAD_A].phone).toBe("15125559999");
    const warned = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some((c) => String(c[0] ?? "").includes("not wrapped in act"));
    expect(warned).toBe(false);
  });

  it("a superseded save (older result arriving last) does not overwrite the newer one", async () => {
    await mountLead();
    db.manualUpdates = true;

    await clickEdit();
    typeInto("Charlotte", "Aaa");
    await clickSave();
    await waitFor(() => expect(db.queue).toHaveLength(1));

    // A second save starts while the first is still in flight (the first never resolved, so the
    // view is still in edit mode with the Save button live).
    typeInto("Aaa", "Bbb");
    await clickSave();
    await waitFor(() => expect(db.queue).toHaveLength(2));

    // Newest resolves first...
    await act(async () => { db.queue[1].settle(); await Promise.resolve(); });
    expect(await screen.findByText("Bbb Kearney")).toBeInTheDocument();

    // ...then the older one. It must be discarded, not repainted over the newer result.
    await act(async () => { db.queue[0].settle(); await Promise.resolve(); });
    expect(screen.getByText("Bbb Kearney")).toBeInTheDocument();
    expect(screen.queryByText("Aaa Kearney")).not.toBeInTheDocument();
  });
});

describe("D5 — a failed save installs nothing and is never reported as a success", () => {
  it("leaves the parent contact untouched, keeps edit mode open and keeps the typed value", async () => {
    await mountLead();
    db.updateError = "permission denied for table leads";

    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();

    await waitFor(() => expect(toasts.error).toContain("permission denied for table leads"));
    expect(toasts.success).toEqual([]);

    // Nothing was written, and nothing was installed locally.
    expect(db.contacts[LEAD_A].phone).toBe("5125550123");
    // Still in edit mode with the typed value intact.
    expect(screen.getByDisplayValue("(512) 555-9999")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    // No "details updated" activity for a save that did not happen (PR #376 contract).
    expect(activityAdd.calls).toHaveLength(0);

    // The Call button still uses the UNCHANGED stored value — no half-applied state.
    quickCalls = [];
    fireEvent.click(screen.getByRole("button", { name: /^call$/i }));
    await waitFor(() => expect(quickCalls).toHaveLength(1));
    expect(quickCalls[0].phone).toBe("5125550123");
  });

  it("a retry after a failure saves normally", async () => {
    await mountLead();
    db.updateError = "boom";
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();
    await waitFor(() => expect(toasts.error).toHaveLength(1));

    db.updateError = null;
    await clickSave();
    await waitFor(() => expect(db.contacts[LEAD_A].phone).toBe("15125559999"));
    expect(toasts.success).toEqual(["Lead updated successfully"]);
  });
});

describe("round-trip budget", () => {
  it("a read-only deep link costs zero settings reads and zero writes", async () => {
    await mountLead();
    expect(settingsState.loads).toBe(0);
    expect(updatesTo("leads")).toHaveLength(0);
  });

  it("a save is one write and no extra read of the contact row", async () => {
    await mountLead();
    db.ops = [];
    await clickEdit();
    typeInto("(512) 555-0123", "5125559999");
    await clickSave();
    await waitFor(() => expect(updatesTo("leads")).toHaveLength(1));

    expect(contactOps("leads").filter((o) => o.kind === "select")).toHaveLength(0);
  });
});

describe("all three contact types", () => {
  it("client: saves, and the parent adopts the returned row", async () => {
    db.contacts[CLIENT_ID] = clientRow();
    h.routeId = CLIENT_ID;
    render(<ContactDeepLinkPage contactType="client" />);
    await screen.findByRole("button", { name: /^call$/i });
    db.ops = [];

    await clickEdit();
    typeInto("(512) 555-0124", "5125558888");
    await clickSave();

    await waitFor(() => expect(db.contacts[CLIENT_ID].phone).toBe("15125558888"));
    expect(contactOps("clients").filter((o) => o.kind === "select")).toHaveLength(0);
    quickCalls = [];
    fireEvent.click(await screen.findByRole("button", { name: /^call$/i }));
    await waitFor(() => expect(quickCalls).toHaveLength(1));
    expect(quickCalls[0].phone).toBe("15125558888");
    expect(quickCalls[0].type).toBe("client");
  });

  it("recruit: saves, and the parent adopts the returned row", async () => {
    db.contacts[RECRUIT_ID] = recruitRow();
    h.routeId = RECRUIT_ID;
    render(<ContactDeepLinkPage contactType="recruit" />);
    await screen.findByRole("button", { name: /^call$/i });
    db.ops = [];

    await clickEdit();
    typeInto("(512) 555-0125", "5125556666");
    await clickSave();

    await waitFor(() => expect(db.contacts[RECRUIT_ID].phone).toBe("15125556666"));
    expect(contactOps("recruits").filter((o) => o.kind === "select")).toHaveLength(0);
    quickCalls = [];
    fireEvent.click(await screen.findByRole("button", { name: /^call$/i }));
    await waitFor(() => expect(quickCalls).toHaveLength(1));
    expect(quickCalls[0].phone).toBe("15125556666");
    expect(quickCalls[0].type).toBe("recruit");
  });

  it("client and recruit failures are reported and install nothing", async () => {
    for (const [type, id, row, table] of [
      ["client", CLIENT_ID, clientRow(), "clients"],
      ["recruit", RECRUIT_ID, recruitRow(), "recruits"],
    ] as const) {
      cleanup();
      db.contacts = {}; db.ops = []; toasts.success = []; toasts.error = []; activityAdd.calls = [];
      db.contacts[id] = { ...row };
      h.routeId = id;
      render(<ContactDeepLinkPage contactType={type} />);
      await screen.findByRole("button", { name: /^call$/i });

      db.updateError = "nope";
      await clickEdit();
      typeInto(String(row.first_name), "Changed");
      await clickSave();

      await waitFor(() => expect(toasts.error).toContain("nope"));
      expect(toasts.success).toEqual([]);
      expect(db.contacts[id].first_name).toBe(row.first_name);
      expect(activityAdd.calls).toHaveLength(0);
      expect(updatesTo(table)).toHaveLength(1);
      db.updateError = null;
    }
  });
});
