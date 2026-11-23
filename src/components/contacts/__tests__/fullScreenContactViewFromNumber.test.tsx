/** Shared FROM integration. Real screen, selection/affinity hooks, quick-call event and SMS sender;
 * only external context, database replies and HTTP transport are synthetic. No voice device exists. */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContactNumberAffinity } from "@/lib/number-affinity";
import { ContactCallerRoutingContext } from "@/contexts/ContactCallerRoutingContext";
import { QUICK_CALL_EVENT, type QuickCallDetail } from "@/lib/quick-call";

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };
const h = vi.hoisted(() => ({
  actor: "00000000-0000-4000-8000-000000000001", org: "11111111-1111-4111-8111-111111111111", impersonating: false,
  saved: null as ContactNumberAffinity | null,
  rpc: [] as { name: string; args: Row }[], posts: [] as Row[], messages: [] as Row[], errors: [] as string[],
  options: [] as Row[], changeError: null as string | null,
  inventory: [] as Row[], readInventory: null as null | (() => Promise<Row[]>),
  previewReply: null as null | ((args: Row) => Promise<RpcResult>),
  changeReply: null as null | ((args: Row) => Promise<RpcResult>),
}));

const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const N_A = "+15550002222";
const N_B = "+15550003333";
const CONTACT = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", firstName: "Jordan", lastName: "Rivera", phone: "5125550123", email: "jordan@example.test", state: "TX", status: "New", leadSource: "Referral", assignedAgentId: h.actor, userId: h.actor, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

function affinity(id = A, number = N_A): ContactNumberAffinity {
  const choice = { id, number, readiness: "ready", provisional: true, state: "established", version: 1 };
  return { voice_mode: "enforced", sms_mode: "enforced", generation: 1, history: "reconciled", voice: { ...choice }, sms: { ...choice }, reply: null };
}
function unassignedAffinity(): ContactNumberAffinity {
  const data = affinity();
  return { ...data, history: "new", voice: { ...data.voice, state: "unassigned", version: 0 },
    sms: { ...data.sms, state: "unassigned", version: 0 } };
}
const callerRouting = {
  resolveContactLocalCaller: vi.fn(async () => N_B),
  getContactCallerRole: vi.fn((_id: string, _number: string): "agency" | "personal" | null => "agency"),
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function inventoryNumber(id: string, phone_number: string, friendly_name: string | null, organization_id: string | null = h.org) {
  return { id, phone_number, friendly_name, organization_id, is_default: id === A };
}

function query(table: string) {
  const filters: Row = {};
  let columns = "*";
  const resolve = (single = false): RpcResult => {
    if (table === "messages") {
      const matches = h.messages.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
      return { data: single ? matches[0] ?? null : matches, error: null };
    }
    return { data: single ? null : [], error: null };
  };
  const read = async (): Promise<RpcResult> => {
    if (table !== "phone_numbers") return resolve();
    const rows = h.readInventory ? await h.readInventory() : h.inventory;
    const keys = columns.split(",").map(key => key.trim());
    return { data: columns === "*" ? rows : rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]]))), error: null };
  };
  const api: Row = { then: (done: (v: RpcResult) => unknown) => read().then(done) };
  for (const method of ["in", "or", "not", "order", "limit", "gte", "lt", "neq", "is"]) api[method] = () => api;
  api.select = (projection = "*") => { columns = projection; return api; };
  api.eq = (key: string, value: unknown) => { filters[key] = value; return api; };
  api.single = api.maybeSingle = () => Promise.resolve(resolve(true));
  return api;
}
async function rpc(name: string, args: Row): Promise<RpcResult> {
  h.rpc.push({ name, args: clone(args) });
  if (name === "preview_contact_numbers") return h.previewReply ? h.previewReply(args) : { data: clone(h.saved), error: null };
  if (name === "contact_number_options") return { data: clone(h.options), error: null };
  if (name === "change_contact_number") {
    if (h.changeReply) return h.changeReply(args);
    if (h.changeError) return { data: null, error: { message: h.changeError } };
    const number = h.options.find(option => option.id === args.p_number);
    h.saved = { ...affinity(String(number!.id), String(number!.number)), generation: 2 };
    return { data: clone(h.saved), error: null };
  }
  if (name === "authorize_contact_call") throw new Error("A quick-call event must not authorize or place a call in this fixture");
  return { data: [], error: null };
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => query(table), rpc: (name: string, args: Row) => rpc(name, args),
  channel: () => { const api = { on: () => api, subscribe: () => api }; return api; }, removeChannel: () => {},
  auth: {
    getSession: async () => ({ data: { session: { access_token: "synthetic-token", user: { id: h.actor } } } }),
    getUser: async () => ({ data: { user: { id: h.actor } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: h.actor }, profile: { id: h.actor, organization_id: h.org, first_name: "Avery", last_name: "Agent", role: "Admin" }, isImpersonating: h.impersonating }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org, role: "Admin", isSuperAdmin: false }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/hooks/useSmsConsentStatus", () => ({ useSmsConsentStatus: () => ({ data: { enforced: false }, error: null, refetch: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: (message: string) => h.errors.push(message), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useContactHistory", () => ({ useContactHistory: () => ({ conversation: { items: [], loading: false, error: null, hasMore: false }, activity: { items: [], loading: false, error: null, hasMore: false }, refresh: vi.fn(), loadConversation: vi.fn(), loadActivity: vi.fn() }) }));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-activities", () => ({ activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "activity" })) } }));
vi.mock("@/lib/supabase-settings", () => ({ pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) }, customFieldsSupabaseApi: { getAll: vi.fn(async () => []) }, leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-email", () => ({ emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) } }));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({ useBranding: () => ({ formatDate: (v: unknown) => String(v), formatDateTime: (v: unknown) => String(v), branding: { companyName: "AgentFlow" } }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({ ContactFollowUpsCard: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("@/components/contacts/TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { PendingSmsAuthorityBridge } from "@/components/messaging/PendingSmsAuthorityBridge";
import { pendingSmsStore } from "@/lib/sms-send/pendingSmsStore";

let client: QueryClient;
let calls: QuickCallDetail[];
const captureCall = (event: Event) => calls.push((event as CustomEvent<QuickCallDetail>).detail);
beforeEach(() => {
  h.actor = "00000000-0000-4000-8000-000000000001"; h.org = "11111111-1111-4111-8111-111111111111"; h.impersonating = false;
  h.saved = affinity(); h.rpc = []; h.posts = []; h.messages = []; h.errors = []; h.previewReply = null; h.changeReply = null; h.changeError = null;
  h.options = [{ id: A, number: N_A, readiness: "ready", voice_readiness: "ready", provisional: true }, { id: B, number: N_B, readiness: "ready", voice_readiness: "ready", provisional: true }];
  h.readInventory = null;
  h.inventory = [inventoryNumber(A, N_A.slice(1), "Denver, CO"), inventoryNumber(B, N_B, "Phoenix, AZ")];
  callerRouting.resolveContactLocalCaller.mockReset().mockResolvedValue(N_B);
  callerRouting.getContactCallerRole.mockReset().mockReturnValue("agency");
  pendingSmsStore.reset(); calls = []; window.addEventListener(QUICK_CALL_EVENT, captureCall);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as Row; h.posts.push(payload);
    const messageId = `90000000-0000-4000-8000-${String(h.posts.length).padStart(12, "0")}`;
    const selected = h.options.find(option => option.id === (payload.override_sender_id ?? payload.expected_sender_id));
    h.messages.push({ id: messageId, organization_id: h.org, created_by: h.actor, contact_id: payload.contact_id, contact_type: payload.contact_type, lead_id: null, direction: "outbound", body: (payload.first_use as Row | undefined)?.body ?? payload.body, to_number: payload.to, from_number: selected?.number ?? N_A, status: "queued", sent_at: "2026-11-21T00:00:00Z", created_at: "2026-11-21T00:00:00Z", provider_message_id: `SM${"1".repeat(31)}${h.posts.length}` });
    return { status: 200, text: async () => JSON.stringify({ success: true, message_id: messageId, provider_message_id: `SM${"1".repeat(31)}${h.posts.length}`, status: "queued" }) } as Response;
  }));
});
afterEach(() => { cleanup(); client.clear(); pendingSmsStore.reset(); window.removeEventListener(QUICK_CALL_EVENT, captureCall); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>
    <ContactCallerRoutingContext.Provider value={callerRouting}>
      <PendingSmsAuthorityBridge />{children}
    </ContactCallerRoutingContext.Provider>
  </QueryClientProvider>
);
const view = (contact = CONTACT, type: "lead" | "client" | "recruit" = "lead") => <FullScreenContactView contact={contact} type={type} onClose={vi.fn()} onUpdate={vi.fn(async () => {})} onDelete={vi.fn(async () => {})} />;
function mount() { return render(view(), { wrapper: Wrapper }); }
const picker = () => screen.getByLabelText("From number") as HTMLSelectElement;
const digits = (value: string) => { const number = value.replace(/\D/g, ""); return number.length === 11 && number.startsWith("1") ? number.slice(1) : number; };
const selectedDigits = () => digits(picker().selectedOptions[0]?.textContent ?? "");
const mutations = () => h.rpc.filter(call => call.name === "change_contact_number");
async function loaded() { await waitFor(() => expect(selectedDigits()).toContain(digits(N_A))); }
async function autoSelected() {
  await waitFor(() => {
    expect(picker()).toBeEnabled();
    expect(picker().selectedOptions[0]).toHaveTextContent("AI Local Presence");
  });
}
function expectNoOutboundAction() {
  expect(mutations()).toHaveLength(0);
  expect(calls).toHaveLength(0);
  expect(h.posts).toHaveLength(0);
  expect(h.rpc.some(call => call.name === "authorize_contact_call")).toBe(false);
}
async function choose(number = N_B) {
  await waitFor(() => expect(picker()).toBeEnabled());
  const option = Array.from(picker().options).find(item => digits(item.textContent ?? "").includes(digits(number)));
  expect(option, "The requested number is actually offered by the scoped options").toBeDefined();
  fireEvent.change(picker(), { target: { value: option!.value } });
  return screen.findByRole("dialog");
}
async function confirmTemporary() {
  const dialog = await choose();
  expect(within(dialog).getByRole("checkbox", { name: "Make this the assigned number" })).not.toBeChecked();
  fireEvent.click(within(dialog).getByRole("button", { name: "Use number" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(selectedDigits()).toContain(digits(N_B));
}
async function send(body: string) {
  const count = h.posts.length;
  fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: body } });
  fireEvent.click(screen.getByTitle("Send SMS"));
  await waitFor(() => expect(h.posts).toHaveLength(count + 1));
  await waitFor(() => expect(screen.queryByTestId("pending-sms-status")).toBeNull());
}

describe("Full contact shared FROM", () => {
  it.each(["lead", "client", "recruit"] as const)("uses automatic calling and texting candidates independently for an unassigned %s", async type => {
    h.saved = unassignedAffinity();
    render(view(CONTACT, type), { wrapper: Wrapper });
    await autoSelected();
    expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("Not assigned");
    expectNoOutboundAction();

    await waitFor(() => expect(screen.getByRole("button", { name: "Call" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ contactId: CONTACT.id, type, fromNumber: N_B, expectedCallerNumber: N_B });
    expect(calls[0].oneCallNumberId).toBeUndefined();
    expect(calls[0].isSelectionCurrent?.()).toBe(true);
    await send(`Automatic ${type} sender`);
    expect(h.posts[0]).toMatchObject({ contact_id: CONTACT.id, contact_type: type, expected_sender_id: A });
    expect(h.posts[0].override_sender_id).toBeUndefined();
    expect(h.messages[0].from_number).toBe(N_A);
    expect(mutations()).toHaveLength(0);
  });

  it.each(["off", "shadow"] as const)("offers automatic calls for clean %s contacts and respects the existing SMS role restriction", async mode => {
    h.saved = { ...unassignedAffinity(), voice_mode: mode, sms_mode: mode };
    callerRouting.getContactCallerRole.mockImplementation(id => id === B ? "personal" : "agency");
    callerRouting.resolveContactLocalCaller.mockResolvedValue(N_A);
    mount(); await autoSelected();
    const callButton = screen.getByRole("button", { name: "Call" });
    await waitFor(() => expect(callButton).toBeEnabled());
    fireEvent.click(callButton);
    expect(calls[0]).toMatchObject({ fromNumber: N_A, expectedCallerNumber: N_A });
    expect(calls[0].oneCallNumberId).toBeUndefined();
    fireEvent.change(picker(), { target: { value: B } });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "Personal SMS restricted" } });
    expect(screen.getByTitle("Send SMS")).toBeDisabled();
    fireEvent.click(callButton);
    expect(calls[1]).toMatchObject({ fromNumber: N_B, oneCallNumberId: B });
    expect(h.posts).toHaveLength(0);
    expect(mutations()).toHaveLength(0);
  });

  it("allows an automatic text while caller routing fails and refuses to dial a fallback", async () => {
    h.saved = unassignedAffinity();
    callerRouting.resolveContactLocalCaller.mockRejectedValue(new Error("Unavailable routing"));
    mount(); await autoSelected();
    await waitFor(() => expect(callerRouting.resolveContactLocalCaller).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
    await send("Available SMS channel");
    expect(h.posts[0]).toMatchObject({ expected_sender_id: A });
    expect(calls).toHaveLength(0);
    expect(mutations()).toHaveLength(0);
  });

  it("keeps automatic calling available when the first SMS sender is not ready", async () => {
    h.saved = unassignedAffinity();
    h.saved.sms.readiness = "setup_required";
    mount(); await autoSelected();
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "Texting unavailable" } });
    expect(screen.getByTitle("Send SMS")).toBeDisabled();
    const callButton = screen.getByRole("button", { name: "Call" });
    await waitFor(() => expect(callButton).toBeEnabled());
    fireEvent.click(callButton);
    expect(calls[0]).toMatchObject({ fromNumber: N_B, expectedCallerNumber: N_B });
    expect(h.posts).toHaveLength(0);
    expect(mutations()).toHaveLength(0);
  });

  it("switches an unassigned contact between named choices and automatic mode without confirmation, assignment or communication", async () => {
    h.saved = unassignedAffinity();
    mount(); await autoSelected();
    const auto = picker().value;
    const rpcBefore = h.rpc.length;
    const details = screen.getByLabelText("Contact numbers");
    for (const id of [B, A, auto]) {
      fireEvent.change(picker(), { target: { value: id } });
      expect(picker()).toHaveValue(id);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(details).toHaveTextContent("Not assigned");
      expectNoOutboundAction();
    }
    expect(h.rpc).toHaveLength(rpcBefore);
    expect(picker().selectedOptions[0]).toHaveTextContent("AI Local Presence");
    expect(within(picker()).getByRole("option", { name: "Phoenix, AZ - (555) 000-3333" })).toHaveValue(B);
  });

  it("drops a clean manual choice and its call authorization when the server establishes an assignment within the same generation", async () => {
    h.saved = unassignedAffinity();
    mount(); await autoSelected();
    fireEvent.change(picker(), { target: { value: B } });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ fromNumber: N_B, expectedCallerNumber: N_B });
    expect(calls[0].oneCallNumberId).toBeUndefined();
    expect(calls[0].isSelectionCurrent?.()).toBe(true);

    h.saved = affinity();
    await act(async () => { await client.refetchQueries({ queryKey: ["contact-numbers"] }); });
    await waitFor(() => expect(picker()).toHaveValue(A));
    expect(calls[0].isSelectionCurrent?.()).toBe(false);
    expect(within(picker()).queryByRole("option", { name: "AI Local Presence" })).toBeNull();
    expect(await choose()).toHaveTextContent("Use a different number?");
    expect(mutations()).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it.each(["enforced", "off", "shadow"] as const)("uses a generation-bound first SMS selection when voice mode is %s", async voice_mode => {
    const empty = { ...unassignedAffinity(), voice_mode, generation: 0 };
    // A read after the synthetic send returns the number now saved by the server.
    h.previewReply = async () => ({ data: h.posts.length ? affinity(B, N_B) : empty, error: null });
    mount(); await autoSelected();
    fireEvent.change(picker(), { target: { value: B } });
    expectNoOutboundAction();
    await send("Follow up");
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({
      expected_sender_id: B, from: N_B, first_use: { sender_id: B, generation: 0, body: "Follow up" },
    });
    expect(h.posts[0]).not.toHaveProperty("body");
    expect(h.posts[0]).not.toHaveProperty("override_sender_id");
    await waitFor(() => expect(within(picker()).queryByRole("option", { name: "AI Local Presence" })).toBeNull());
    expect(picker()).toHaveValue(B);
    expect(mutations()).toHaveLength(0);
  });

  it("restores a first text only after its same-key replay proves rejection, without sending the draft automatically", async () => {
    h.saved = unassignedAffinity();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      h.posts.push(JSON.parse(String(init.body)));
      const unknown = h.posts.length === 1;
      return { status: unknown ? 503 : 409, text: async () => JSON.stringify({
        success: false, code: unknown ? "SEND_UNCERTAIN" : "FIRST_CONTACT_REJECTED",
      }) } as Response;
    }));
    mount(); await autoSelected();
    fireEvent.change(picker(), { target: { value: B } });
    const draft = screen.getByPlaceholderText("Type SMS message…");
    fireEvent.change(draft, { target: { value: "Check back tomorrow" } });
    fireEvent.click(screen.getByTitle("Send SMS"));
    await waitFor(() => expect(pendingSmsStore.getSnapshot()[0]?.state).toBe("uncertain"));
    expect(draft).toHaveValue("");
    fireEvent.change(draft, { target: { value: "Check back tomorrow" } });
    fireEvent.click(screen.getByTitle("Send SMS"));
    await waitFor(() => expect(draft).toHaveValue("Check back tomorrow"));
    expect(h.posts).toHaveLength(2);
    expect(h.posts[1]).toEqual(h.posts[0]);
    expect(pendingSmsStore.getSnapshot()).toHaveLength(1);
    fireEvent.click(screen.getByTitle("Send SMS"));
    await waitFor(() => expect(h.posts).toHaveLength(3));
    expect(h.posts[2].request_id).not.toBe(h.posts[0].request_id);
    expect(mutations()).toHaveLength(0);
  });

  it("offers a personal alternate for this visit only when the contact already has an assignment", async () => {
    callerRouting.getContactCallerRole.mockImplementation(id => id === B ? "personal" : "agency");
    mount(); await loaded();
    const dialog = await choose(N_B);
    expect(within(dialog).queryByRole("checkbox", { name: "Make this the assigned number" })).toBeNull();
    expect(dialog).toHaveTextContent("for this visit");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use number" }));
    expect(picker()).toHaveValue(B);
    await send("Keep agency number");
    expect(h.posts[0]).toMatchObject({ override_sender_id: B, expected_sender_id: B });
    expect(h.posts[0]).not.toHaveProperty("first_use");
    expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-2222");
    expect(mutations()).toHaveLength(0);
  });

  it("preserves one-call behavior for a manual personal number on an unassigned contact", async () => {
    h.saved = unassignedAffinity();
    callerRouting.getContactCallerRole.mockImplementation(id => id === B ? "personal" : "agency");
    mount(); await autoSelected();
    fireEvent.change(picker(), { target: { value: B } });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ fromNumber: N_B, expectedCallerNumber: N_B, oneCallNumberId: B });
    await send("Personal sender");
    expect(h.posts[0]).toMatchObject({ override_sender_id: B, expected_sender_id: B, body: "Personal sender" });
    expect(h.posts[0]).not.toHaveProperty("first_use");
    expect(mutations()).toHaveLength(0);
  });

  it.each(["voice", "sms"] as const)("defaults to the saved %s number when only one channel has been established", async channel => {
    h.saved = unassignedAffinity();
    h.saved[channel] = { ...h.saved[channel], id: B, number: N_B, state: "established", version: 1 };
    mount();
    await waitFor(() => expect(picker()).toHaveValue(B));
    expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-3333");
    expect(within(picker()).queryByRole("option", { name: "AI Local Presence" })).toBeNull();
    expect(await choose(N_A)).toHaveTextContent("Use a different number?");
    expectNoOutboundAction();
  });

  it.each(["reserved", "review", "missing states"])("keeps %s contacts out of the clean unassigned workflow", async state => {
    h.saved = unassignedAffinity();
    if (state === "reserved") h.saved.sms.state = "reserved";
    if (state === "review") h.saved.history = "needs_review";
    if (state === "missing states") { delete h.saved.voice.state; delete h.saved.sms.state; }
    mount();
    await waitFor(() => expect(picker()).toBeEnabled());
    expect(within(picker()).queryByRole("option", { name: "AI Local Presence" })).toBeNull();
    await choose();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expectNoOutboundAction();
  });

  it.each(["pending", "error"] as const)("never falls back to a legacy sender while the preview is %s", async (state) => {
    const preview = deferred<RpcResult>(); h.previewReply = () => preview.promise;
    mount();
    await waitFor(() => expect(h.rpc.some(call => call.name === "preview_contact_numbers")).toBe(true));
    if (state === "error") await act(async () => preview.resolve({ data: null, error: { message: "affinity_scope" } }));
    expect(picker()).toBeDisabled(); expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "No unverified fallback" } });
    expect(screen.getByTitle("Send SMS")).toBeDisabled();
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0); expect(mutations()).toHaveLength(0);
  });

  it("uses the saved shared number for both explicit actions without a confirmation or automatic action", async () => {
    mount(); await loaded();
    await waitFor(() => expect(picker().selectedOptions[0]).toHaveTextContent("Denver, CO - (555) 000-2222"));
    expect(within(picker()).getByRole("option", { name: "Phoenix, AZ - (555) 000-3333" })).toHaveValue(B);
    const details = screen.getByLabelText("Contact numbers");
    expect(details).toHaveTextContent("Assigned Number"); expect(details).not.toHaveTextContent("Calls & texts");
    expect(within(details).queryByRole("button", { name: "Change" })).toBeNull(); expect(details.querySelector("svg")).toBeNull();
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0); expect(mutations()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ contactId: CONTACT.id, fromNumber: N_A, expectedCallerNumber: N_A });
    expect(calls[0].oneCallNumberId).toBeUndefined();
    await send("Saved sender");
    expect(h.posts[0]).toMatchObject({ expected_sender_id: A }); expect(h.posts[0].override_sender_id).toBeUndefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirms one temporary choice, then calls and texts repeatedly from that exact number without changing the saved identity", async () => {
    mount(); await loaded(); await confirmTemporary();
    expect(picker().selectedOptions[0]).toHaveTextContent("Phoenix, AZ - (555) 000-3333");
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0); expect(mutations()).toHaveLength(0);
    expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-2222");
    for (let index = 0; index < 2; index++) {
      fireEvent.click(screen.getByRole("button", { name: "Call" }));
      await send(`Temporary sender ${index}`);
    }
    expect(calls).toHaveLength(2); for (const call of calls) expect(call).toMatchObject({ fromNumber: N_B, oneCallNumberId: B, expectedCallerNumber: N_B });
    for (const payload of h.posts) expect(payload).toMatchObject({ expected_sender_id: B, override_sender_id: B });
    expect(h.messages.every(message => message.from_number === N_B)).toBe(true);
    expect(mutations()).toHaveLength(0); expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only labels eligible rows by agency and ID, with formatted numbers for blank or unmatched names", async () => {
    h.inventory = [
      inventoryNumber("dddddddd-dddd-4ddd-8ddd-dddddddddddd", N_A, "Another row with the same digits"),
      inventoryNumber(A, N_A, "Shared inventory name", null),
      inventoryNumber(B, N_B, "   "),
    ];
    mount(); await loaded();
    await waitFor(() => expect(Array.from(picker().options).map(option => [option.value, option.textContent])).toEqual([
      [A, "(555) 000-2222"], [B, "(555) 000-3333"],
    ]));
  });

  it("labels a saved number that is missing from the options without offering extra inventory rows", async () => {
    h.options = h.options.filter(row => row.id === B);
    h.inventory.push(inventoryNumber("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "+15550004444", "Inventory only"));
    mount();
    await waitFor(() => expect(picker().selectedOptions[0]).toHaveTextContent("Denver, CO - (555) 000-2222"));
    expect(picker()).toHaveValue(A);
    expect(within(picker()).getByRole("option", { name: "Phoenix, AZ - (555) 000-3333" })).toHaveValue(B);
    expect(picker()).not.toHaveTextContent("Inventory only");
  });

  it("keeps phone numbers as option values when sticky selection is off", async () => {
    h.saved = { ...affinity(), voice_mode: "off", sms_mode: "off" };
    mount();
    const alternate = await within(picker()).findByRole("option", { name: "Phoenix, AZ - (555) 000-3333" });
    expect(alternate).toHaveValue(N_B);
    expect(picker().selectedOptions[0]).toHaveTextContent("Denver, CO - (555) 000-2222");
    fireEvent.change(picker(), { target: { value: N_B } });
    expect(picker()).toHaveValue(N_B);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutations()).toHaveLength(0);
  });

  it("clears old names while another agency loads and ignores its late inventory after the next switch", async () => {
    const mounted = mount();
    await waitFor(() => expect(picker().selectedOptions[0]).toHaveTextContent("Denver, CO"));
    const delayed = deferred<Row[]>();
    h.org = "22222222-2222-4222-8222-222222222222";
    const delayedRow = inventoryNumber(A, N_A, "Previous agency");
    const readDelayed = vi.fn(() => delayed.promise);
    h.readInventory = readDelayed;
    mounted.rerender(view());
    expect(picker()).not.toHaveTextContent("Denver, CO");
    await waitFor(() => expect(readDelayed).toHaveBeenCalled());
    await loaded();
    expect(picker().selectedOptions[0].textContent).toBe("(555) 000-2222");

    h.org = "33333333-3333-4333-8333-333333333333";
    h.readInventory = null;
    h.inventory = [inventoryNumber(A, N_A, "Current agency")];
    mounted.rerender(view());
    await waitFor(() => expect(picker().selectedOptions[0]).toHaveTextContent("Current agency - (555) 000-2222"));
    await act(async () => delayed.resolve([delayedRow]));
    expect(picker()).not.toHaveTextContent("Previous agency");
    expect(picker().selectedOptions[0]).toHaveTextContent("Current agency - (555) 000-2222");
  });

  it("preserves an in-flight and then uncertain SMS identity when FROM changes, without sending the same body again", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      h.posts.push(JSON.parse(String(init.body)) as Row); return response.promise;
    }));
    mount(); await loaded();
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "Preserve this attempt" } });
    fireEvent.click(screen.getByTitle("Send SMS"));
    await waitFor(() => expect(h.posts).toHaveLength(1));
    const original = pendingSmsStore.getSnapshot()[0].snapshot;
    expect(original).toMatchObject({ senderPreference: N_A, expectedSenderId: A, overrideSenderId: null });
    expect(pendingSmsStore.getSnapshot()[0].state).toBe("sending");
    await confirmTemporary();
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "Preserve this attempt" } });
    expect(screen.getByTitle("Send SMS")).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText("Type SMS message…"), { key: "Enter" });
    expect(h.posts).toHaveLength(1); expect(pendingSmsStore.getSnapshot()[0].snapshot).toBe(original);
    await act(async () => response.resolve({ status: 503, text: async () => JSON.stringify({ success: false, code: "SEND_UNCERTAIN", error: "Delivery could not be confirmed." }) } as Response));
    await waitFor(() => expect(screen.getByTestId("pending-sms-status")).toHaveTextContent("Not confirmed"));
    expect(selectedDigits()).toContain(digits(N_B));
    fireEvent.click(screen.getByTitle("Send SMS"));
    await waitFor(() => expect(h.errors).toContain("An earlier attempt of this text isn't confirmed. Edit the text to send a new message."));
    expect(h.posts).toHaveLength(1); expect(pendingSmsStore.getSnapshot()).toHaveLength(1);
    expect(pendingSmsStore.getSnapshot()[0]).toMatchObject({ state: "uncertain", snapshot: original });
    expect(h.posts[0].request_id).toBe(original.requestId); expect(calls).toHaveLength(0); expect(mutations()).toHaveLength(0);
  });

  it("cancels an alternate without changing FROM, draft, identity or starting communication", async () => {
    mount(); await loaded(); fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "Keep my draft" } });
    const dialog = await choose(); fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(selectedDigits()).toContain(digits(N_A)); expect(screen.getByPlaceholderText("Type SMS message…")).toHaveValue("Keep my draft");
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0); expect(mutations()).toHaveLength(0);
  });

  it("changes both permanent channels only after checked confirmation and an authoritative success", async () => {
    const pending = deferred<RpcResult>(); h.changeReply = () => pending.promise;
    mount(); await loaded(); const dialog = await choose();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Make this the assigned number" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use number" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0].args).toMatchObject({ p_contact: CONTACT.id, p_type: "lead", p_channel: "both", p_number: B, p_generation: 1 });
    expect(String(mutations()[0].args.p_reason).trim().length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-2222");
    h.saved = { ...affinity(B, N_B), generation: 2 };
    await act(async () => pending.resolve({ data: clone(h.saved), error: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(selectedDigits()).toContain(digits(N_B)); expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-3333");
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0);
  });

  it("keeps prior choice on permanent failure and never silently applies a temporary override", async () => {
    h.changeError = "affinity_admin_resolution"; mount(); await loaded(); const dialog = await choose();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Make this the assigned number" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use number" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/administrator needs to resolve/i)).toBeInTheDocument());
    expect(selectedDigits()).toContain(digits(N_A)); expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-2222");
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    const reopened = await choose(); expect(within(reopened).getByRole("checkbox", { name: "Make this the assigned number" })).not.toBeChecked();
  });

  it("ignores stale pre-change readback but accepts current-generation readiness changes", async () => {
    const oldPreview = affinity();
    h.changeReply = async () => {
      h.saved = { ...affinity(B, N_B), generation: 2 };
      h.previewReply = async () => ({ data: clone(oldPreview), error: null });
      return { data: clone(h.saved), error: null };
    };
    mount(); await loaded(); const dialog = await choose();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Make this the assigned number" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use number" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(h.rpc.filter(call => call.name === "preview_contact_numbers").length).toBeGreaterThan(1));
    expect(selectedDigits()).toContain(digits(N_B));
    expect(screen.getByLabelText("Contact numbers")).toHaveTextContent("(555) 000-3333");
    h.previewReply = null; h.saved!.sms.readiness = "setup_required";
    await act(async () => { await client.refetchQueries({ queryKey: ["contact-numbers"] }); });
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "Do not fall back" } });
    expect(screen.getByTitle("Send SMS")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Call" })).toBeEnabled();
    expect(selectedDigits()).toContain(digits(N_B)); expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0);
  });

  it("retains explicit different saved channels until a deliberate shared temporary choice", async () => {
    h.saved!.sms = { ...h.saved!.sms, id: B, number: N_B }; mount();
    await waitFor(() => expect(h.rpc.some(call => call.name === "contact_number_options")).toBe(true));
    const details = screen.getByLabelText("Contact numbers");
    expect(details).toHaveTextContent("Calls"); expect(details).toHaveTextContent("Texts"); expect(details).toHaveTextContent("(555) 000-2222"); expect(details).toHaveTextContent("(555) 000-3333");
    expect(selectedDigits()).not.toContain(digits(N_A)); expect(selectedDigits()).not.toContain(digits(N_B));
    expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
    await confirmTemporary(); expect(details).toHaveTextContent("(555) 000-2222"); expect(mutations()).toHaveLength(0);
  });

  it.each(["contact", "phone", "type", "actor", "organization", "view_as"] as const)("discards temporary selection when %s changes", async (kind) => {
    const mounted = mount(); await loaded(); await confirmTemporary();
    let contact = CONTACT; let type: "lead" | "client" = "lead";
    if (kind === "contact") contact = { ...CONTACT, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
    if (kind === "phone") contact = { ...CONTACT, phone: "5125550456" };
    if (kind === "type") type = "client";
    if (kind === "actor") h.actor = "00000000-0000-4000-8000-000000000002";
    if (kind === "organization") h.org = "22222222-2222-4222-8222-222222222222";
    if (kind === "view_as") h.impersonating = true;
    mounted.rerender(view(contact, type));
    expect(selectedDigits()).not.toContain(digits(N_B));
    if (kind === "view_as") { expect(picker()).toBeDisabled(); expect(screen.getByRole("button", { name: "Call" })).toBeDisabled(); await act(async () => { await Promise.resolve(); }); }
    else await loaded();
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0); expect(mutations()).toHaveLength(0);
  });

  it.each([false, true])("does not apply a late permanent response after leaving its contact visit (return to original: %s)", async (returnToOriginal) => {
    const pending = deferred<RpcResult>(); h.changeReply = () => pending.promise;
    const mounted = mount(); await loaded(); const dialog = await choose();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Make this the assigned number" })); fireEvent.click(within(dialog).getByRole("button", { name: "Use number" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    mounted.rerender(view({ ...CONTACT, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
    await loaded();
    if (returnToOriginal) { mounted.rerender(view()); await loaded(); }
    await act(async () => pending.resolve({ data: { ...affinity(B, N_B), generation: 2 }, error: null }));
    await loaded(); expect(screen.queryByRole("dialog")).toBeNull(); expect(selectedDigits()).not.toContain(digits(N_B));
    expect(calls).toHaveLength(0); expect(h.posts).toHaveLength(0);
  });

  it("blocks only an unavailable text channel without silently substituting a sender", async () => {
    h.options[1].readiness = "setup_required"; mount(); await loaded(); await confirmTemporary();
    expect(screen.getByRole("button", { name: "Call" })).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText("Type SMS message…"), { target: { value: "No fallback" } });
    expect(screen.getByTitle("Send SMS")).toBeDisabled();
    expect(screen.getByText(/texting setup required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Call" })); expect(calls[0]).toMatchObject({ oneCallNumberId: B, expectedCallerNumber: N_B });
    expect(h.posts).toHaveLength(0); expect(mutations()).toHaveLength(0);
  });
});
