/**
 * Phase 2A: the REAL sale modals save through the commission companions. Proves what each save sends as its
 * commission payload (never manufactured), that an unknown outcome locks the form and Retry replays the exact
 * submission, that a conflict is closeable but never editable, that a confirmed refusal stays editable, and that
 * nothing about the submission leaks into logs or toasts. Only Supabase, the session, permissions and toasts are
 * stubbed; synthetic data only.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  ids: {
    a: "00000000-0000-4000-8000-0000000000a1",
    b: "00000000-0000-4000-8000-0000000000b2",
    viewed: "00000000-0000-4000-8000-0000000000c3",
    org: "00000000-0000-4000-8000-0000000000d4",
    lead: "00000000-0000-4000-8000-0000000000e5",
    client: "00000000-0000-4000-8000-0000000000f6",
    newClient: "00000000-0000-4000-8000-0000000000f7",
  },
  role: "Agent",
  impersonating: false,
  perms: new Set<string>(),
  leadOwner: null as string | null,
  clientOwner: null as string | null,
  context: null as unknown,
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  saleResponses: [] as Array<{ data: unknown; error: unknown; status?: number }>,
  commission: { status: "evidence_recorded", slots: [] } as unknown,
  toasts: [] as unknown[][],
}));

import { installComboboxDomStubs, pickCarrier } from "@/test/carrierComboboxTestUtils";
vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, () => unknown> = {
    leads: () => ({ assigned_agent_id: h.leadOwner }),
    clients: () => ({ assigned_agent_id: h.clientOwner }),
    profiles: () => ({ id: h.ids.b, first_name: "Synthetic", last_name: "B", email: "b@example.test", commission_level: "100" }),
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "in", "limit", "eq"]) builder[method] = () => builder;
    builder.maybeSingle = async () => ({ data: rows[table]?.() ?? null, error: null });
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === "carriers" ? [{ name: "Synthetic Carrier North" }, { name: "Synthetic Carrier South" }] : [], error: null })
        .then(resolve, reject);
    return builder;
  };
  const respond = async (name: string, args: Record<string, unknown>) => {
    h.rpcCalls.push([name, JSON.parse(JSON.stringify(args ?? null))]);
    if (name === "get_commission_calculator_context") return { data: h.context, error: null };
    if (name === "get_contact_scope_agents") return { data: [], error: null };
    if (name === "notify_win") return { data: 1, error: null };
    if (name === "get_policy_sale_operation_status") return { data: { state: "committed", same_payload: false, this_request: true }, error: null };
    if (!name.endsWith("_handoff") && !["update_client_with_policy_sale"].includes(name)) return { data: null, error: null };
    const queued = h.saleResponses.shift();
    if (queued) return queued;
    const clientId = name === "convert_lead_to_client_with_sales_handoff" ? h.ids.newClient : h.ids.client;
    return { data: { client: { id: clientId }, client_id: clientId, win_ids: ["00000000-0000-4000-8000-000000000101"], idempotent: false,
      commission: h.commission }, error: null, status: 200 };
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    const request = respond(name, args);
    return Object.assign(request, { abortSignal: () => request });
  };
  return { supabase: { from, rpc } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: h.ids.a },
    profile: { id: h.impersonating ? h.ids.viewed : h.ids.a, role: h.role, organization_id: h.ids.org, first_name: "Synthetic", last_name: "Operator" },
    isImpersonating: h.impersonating,
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.ids.org, role: h.role }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canSeeCommission: (name: string) => h.perms.has(name), isLoading: false, error: null }),
}));
vi.mock("sonner", () => {
  const record = (kind: string) => (...args: unknown[]) => { h.toasts.push([kind, ...args]); };
  return { toast: { error: record("error"), success: record("success"), warning: record("warning") } };
});
vi.mock("@/lib/activityLogger", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/components/shared/DateInput", () => ({
  DateInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="date" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/shared/PhoneInput", () => ({
  PhoneInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Phone" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/shared/StateSelector", () => ({ StateSelector: () => null }));

import AddClientModal from "../AddClientModal";
import ConvertLeadModal from "../ConvertLeadModal";
import RecordPolicyModal from "../RecordPolicyModal";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { IDS, syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import { OTHERS_COMMISSION_PERMISSION as OTHERS, OWN_COMMISSION_PERMISSION as OWN } from "@/lib/commission/policyPreview";
import type { Client, Lead } from "@/lib/types";

const { a: A, b: B, org: ORG, lead: LEAD_ID, client: CLIENT_ID } = h.ids;
const NORTH = "Synthetic Carrier North";
const SOUTH = "Synthetic Carrier South";

function rawContext() {
  const c = syntheticContext("100");
  return {
    status: "ready",
    commission_level: c.commissionLevel,
    grid: { id: c.grid.id, name: c.grid.name, effective_date: c.grid.effectiveDate, contract_levels: c.grid.contractLevels, revision: c.grid.revision },
    products: c.products.map((p) => ({ id: p.id, category: p.category, carrier: p.carrier, product_name: p.productName })),
    variants: c.variants.map((v) => ({ id: v.id, product_id: v.productId, label: v.label, min_age: v.minAge, max_age: v.maxAge, term_years: v.termYears })),
    rates: c.rates.map((r) => ({ variant_id: r.variantId, contract_level: r.contractLevel, rate_percent: r.ratePercent })),
  };
}

let uuid = 0;
function mount(ui: React.ReactElement) {
  uuid = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `00000000-0000-4000-9000-${String(++uuid).padStart(12, "0")}` });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}
const regions = () => screen.queryAllByRole("region", { name: "Commission estimate" });
const choose = (region: HTMLElement, label: string, value: string) => fireEvent.change(within(region).getByLabelText(label), { target: { value } });
const sent = (name: string) => h.rpcCalls.filter(([n]) => n === name).map(([, args]) => args);
const slotsOf = (args: Record<string, unknown>) => (args.p_commission as { v: string; slots: Array<Record<string, unknown>> }).slots;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const lost = { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 };

beforeEach(() => {
  installComboboxDomStubs();
  Object.assign(h, { role: "Agent", impersonating: false, leadOwner: A, clientOwner: A, saleResponses: [], toasts: [],
    commission: { status: "evidence_recorded", slots: [] } });
  h.perms = new Set([OWN]);
  h.context = rawContext();
  h.rpcCalls = [];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ── Conversion ────────────────────────────────────────────────────────────────────────────────────────
const LEAD = { id: LEAD_ID, firstName: "Pat", lastName: "Lee", assignedAgentId: A, age: 60 } as unknown as Lead;
function openConvert() {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  mount(<ConvertLeadModal open lead={LEAD} onSuccess={onSuccess} onClose={onClose} campaignId={null} />);
  return { onSuccess, onClose };
}
const typeSelects = () => screen.getAllByRole("combobox").filter((s) => Array.from((s as HTMLSelectElement).options).some((o) => o.text === "Final Expense"));
const carrierSelects = () => screen.getAllByRole("combobox").filter((s) => Array.from((s as HTMLSelectElement).options).some((o) => o.text === "Select carrier…"));
async function fillPolicy(index: number, type: string, premium: string, carrier = NORTH) {
  await waitFor(() => expect(carrierSelects()[index].querySelectorAll("option").length).toBeGreaterThan(1));
  fireEvent.change(typeSelects()[index], { target: { value: type } });
  fireEvent.change(carrierSelects()[index], { target: { value: carrier } });
  fireEvent.change(screen.getAllByPlaceholderText("125.00")[index], { target: { value: premium } });
}
const convert = () => fireEvent.click(screen.getByRole("button", { name: /convert lead/i }));
const CONVERT = "convert_lead_to_client_with_sales_handoff";

describe("ConvertLeadModal commission payload", () => {
  it("no estimate displayed, or no commission permission: an explicit empty payload and the same sale", async () => {
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()).toHaveLength(1));
    convert();
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledWith(h.ids.newClient));
    cleanup();
    h.perms = new Set();
    const contextReads = h.rpcCalls.filter(([name]) => name === "get_commission_calculator_context").length;
    const second = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    convert();
    await waitFor(() => expect(second.onSuccess).toHaveBeenCalledTimes(1));
    const [withPanel, withoutPermission] = sent(CONVERT);
    expect(withPanel.p_commission).toEqual({ v: "policy-commission-v1", slots: [] });
    expect(withoutPermission).toEqual(withPanel);
    expect(h.rpcCalls.filter(([name]) => name === "get_commission_calculator_context")).toHaveLength(contextReads);
  });

  it("an unassigned stored lead manufactures no seller and no estimate", async () => {
    h.leadOwner = null;
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()[0]?.textContent).toBe("No assigned agent"));
    convert();
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
    expect(slotsOf(sent(CONVERT)[0])).toEqual([]);
  });

  it("one slot per displayed estimate; an additional row is keyed by its own UUID, which is also its stored policy id", async () => {
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    fireEvent.click(screen.getByTitle("Add another policy"));
    await fillPolicy(1, "IUL", "200", SOUTH);
    fireEvent.click(screen.getByTitle("Add another policy"));
    await fillPolicy(2, "Final Expense", "50");
    await waitFor(() => expect(regions()).toHaveLength(3));
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[1], "Product", IDS.juvenile);
    choose(regions()[1], "Insured age", "10");
    // The third row shows its panel but no product is chosen, so no estimate and no slot.
    convert();
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
    const [args] = sent(CONVERT);
    const rows = (args.p_client as { custom_fields: { additional_policies: Array<{ policyId: string }> } }).custom_fields.additional_policies;
    expect(rows.map((row) => row.policyId)).toHaveLength(2);
    expect(slotsOf(args).map((slot) => slot.slot)).toEqual(["primary", rows[0].policyId]);
    expect(slotsOf(args)[0]).toEqual({
      slot: "primary", credited_agent_id: A, grid_id: IDS.grid, grid_revision: 3, product_id: IDS.finalPlan, variant_id: expect.any(String),
      insured_age: 60, term_years: null, contract_level: 100, rate_percent: expect.any(String), monthly_premium: "100",
      first_year_cents: 85800, advance_cents: 64350,
    });
    expect(slotsOf(args)[1]).toMatchObject({ product_id: IDS.juvenile, insured_age: 10, monthly_premium: "200", first_year_cents: 153600 });
    expect(args.p_request_id).toMatch(/^00000000-0000-4000-9000-/);
  });

  it("an unknown outcome locks every field; Retry replays the identical submission, through an auth failure too", async () => {
    h.saleResponses = [lost, { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 }];
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    convert();
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't confirm/);
    expect(screen.getAllByPlaceholderText("125.00")[0]).toBeDisabled();
    expect(within(regions()[0]).getByLabelText("Product")).toBeDisabled();
    expect(screen.getByTitle("Add another policy")).toBeDisabled();
    convert();
    await waitFor(() => expect(sent(CONVERT)).toHaveLength(2));
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/JWT expired/);
    expect(screen.getAllByPlaceholderText("125.00")[0]).toBeDisabled();
    expect(view.onSuccess).not.toHaveBeenCalled();
    convert();
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
    const attempts = sent(CONVERT).map((args) => JSON.stringify(args));
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts).size).toBe(1);
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it("a conflict is closeable and never editable", async () => {
    h.saleResponses = [{ data: null, error: { message: "This lead is already converted; refresh the client before editing", code: "PT409" }, status: 409 }];
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    convert();
    expect((await screen.findByRole("alert")).textContent).toMatch(/already saved/);
    expect(screen.getByRole("button", { name: /convert lead/i })).toBeDisabled();
    expect(screen.getAllByPlaceholderText("125.00")[0]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "CLOSE" }));
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(sent("get_policy_sale_operation_status")[0]).toMatchObject({ p_kind: "convert", p_lead_id: LEAD_ID });
  });

  it("a confirmed refusal stays editable and the corrected save reuses the request id", async () => {
    h.saleResponses = [{ data: null, error: { message: "Invalid conversion policy payload", code: "22023" }, status: 400 }];
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    convert();
    await waitFor(() => expect(h.toasts).toContainEqual(["error", "Invalid conversion policy payload"]));
    expect(screen.getAllByPlaceholderText("125.00")[0]).not.toBeDisabled();
    fireEvent.change(screen.getAllByPlaceholderText("125.00")[0], { target: { value: "110" } });
    convert();
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
    const [refused, corrected] = sent(CONVERT);
    expect(corrected.p_request_id).toBe(refused.p_request_id);
    expect((corrected.p_client as { premium: number }).premium).toBe(110);
  });

  it("reports commission attention separately and never puts the submission in logs or toasts", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    h.saleResponses = [lost];
    h.commission = { status: "evidence_recorded", slots: [{ slot: "primary", policy_id: null, status: "needs_attention", code: "rate_changed" }] };
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    convert();
    await screen.findByRole("alert");
    convert();
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
    expect(h.toasts).toContainEqual(["warning", "Policy saved; the commission estimate needs attention on the contact."]);
    expect(h.toasts.find(([kind]) => kind === "success")).toBeTruthy();
    const leaked = JSON.stringify([h.toasts, ...spies.map((spy) => spy.mock.calls)]);
    for (const secret of ["p_client", "p_commission", "credited_agent_id", IDS.finalPlan]) expect(leaked).not.toContain(secret);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("p_commission");
    spies.forEach((spy) => spy.mockRestore());
  });
});

// ── Add / Edit Client ────────────────────────────────────────────────────────────────────────────────
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByText(label).parentElement!.querySelector("input, select")!, { target: { value } });
function openAddClient(initial?: Partial<Client>) {
  const onClose = vi.fn();
  // Routes like Contacts.tsx: a sale-bearing save carries an attempt; an ordinary edit does not.
  const onSave = vi.fn((data: Partial<Client>, sale?: Parameters<typeof clientsSupabaseApi.create>[2]) =>
    (initial
      ? sale?.attempt
        ? clientsSupabaseApi.updateWithPolicySaleHandoff(sale.attempt, initial.id!, data, sale.requestId, sale.commission)
        : clientsSupabaseApi.update(initial.id!, data)
      : clientsSupabaseApi.create({ ...data, assignedAgentId: A } as never, ORG, sale)).then(() => undefined));
  mount(<AddClientModal open onClose={onClose} onSave={onSave} initial={initial ?? null} />);
  return { onClose, onSave, submit: () => fireEvent.submit(document.querySelector("form")!) };
}
function basics() {
  fill("First Name *", "Pat");
  fill("Last Name *", "Lee");
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "5551234567" } });
}

describe("AddClientModal commission payload", () => {
  it("a contact-only client goes through the companion with no sale and an empty payload", async () => {
    const view = openAddClient();
    basics();
    view.submit();
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    const [args] = sent("create_client_with_sale_handoff");
    expect(args).toMatchObject({ p_record_sale: false, p_commission: { v: "policy-commission-v1", slots: [] } });
  });

  it("a new client's displayed estimate credits the signed-in seller", async () => {
    const view = openAddClient();
    basics();
    fill("Policy Type", "Final Expense");
    await pickCarrier(NORTH);
    fill("Monthly Premium", "$100.00");
    fireEvent.change(screen.getAllByTestId("date")[0], { target: { value: "2026-10-03" } });
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[0], "Insured age", "60");
    view.submit();
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    const [args] = sent("create_client_with_sale_handoff");
    expect(args.p_record_sale).toBe(true);
    expect(slotsOf(args)).toEqual([expect.objectContaining({ slot: "primary", credited_agent_id: A, monthly_premium: "100.00", first_year_cents: 85800 })]);
  });

  it("an edit that adds the first policy uses the receipt-bearing companion; an ordinary edit adds no sale", async () => {
    const initial = { id: CLIENT_ID, firstName: "Pat", lastName: "Lee", phone: "5551234567", email: "", state: "", assignedAgentId: A };
    const first = openAddClient(initial);
    fill("Policy Type", "Final Expense");
    await pickCarrier(NORTH);
    fill("Monthly Premium", "100");
    fireEvent.change(screen.getAllByTestId("date")[0], { target: { value: "2026-10-03" } });
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[0], "Insured age", "60");
    first.submit();
    await waitFor(() => expect(first.onClose).toHaveBeenCalledTimes(1));
    const [edit] = sent("update_client_with_policy_sale_handoff");
    expect(edit).toMatchObject({ p_client_id: CLIENT_ID, p_request_id: expect.any(String) });
    expect(slotsOf(edit)).toHaveLength(1);
    cleanup();
    h.rpcCalls = [];
    const ordinary = openAddClient({ ...initial, carrier: NORTH, premiumAmount: "$100.00", policyType: "Final Expense" });
    fill("Monthly Premium", "$120.00");
    ordinary.submit();
    await waitFor(() => expect(ordinary.onClose).toHaveBeenCalledTimes(1));
    expect(sent("update_client_with_policy_sale")).toHaveLength(1);
    expect(h.rpcCalls.some(([name]) => name.endsWith("_handoff"))).toBe(false);
  });

  it("View As: no commission request, no panel, and an empty payload", async () => {
    h.impersonating = true;
    h.perms = new Set([OWN, OTHERS]);
    const view = openAddClient();
    basics();
    await pickCarrier(NORTH);
    fill("Monthly Premium", "$100.00");
    fireEvent.change(screen.getAllByTestId("date")[0], { target: { value: "2026-10-03" } });
    await flush();
    expect(regions()).toHaveLength(0);
    view.submit();
    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(slotsOf(sent("create_client_with_sale_handoff")[0])).toEqual([]);
    expect(h.rpcCalls.map(([name]) => name)).not.toContain("get_commission_calculator_context");
  });
});

// ── Record Policy ────────────────────────────────────────────────────────────────────────────────────
describe("RecordPolicyModal commission payload", () => {
  it("an admin's displayed estimate credits the client's stored owner", async () => {
    Object.assign(h, { role: "Admin", clientOwner: B });
    h.perms = new Set([OWN, OTHERS]);
    const onSaved = vi.fn();
    mount(<RecordPolicyModal open clientId={CLIENT_ID} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Policy type"), { target: { value: "Final Expense" } });
    await pickCarrier(NORTH);
    fireEvent.change(screen.getByLabelText("Monthly premium"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Sold Date"), { target: { value: "2026-10-03" } });
    await waitFor(() => expect(within(regions()[0]).getByText("For Synthetic B")).toBeTruthy());
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[0], "Insured age", "60");
    fireEvent.click(screen.getByRole("button", { name: "Record Policy" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [args] = sent("record_client_policy_handoff");
    expect(args).toMatchObject({ p_client_id: CLIENT_ID, p_primary: false });
    expect(slotsOf(args)).toEqual([expect.objectContaining({ slot: "primary", credited_agent_id: B })]);
  });
});
