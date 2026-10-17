/**
 * Commission preview inside the REAL policy modals (decisions P1–P4). The modals, the panel, the hook,
 * the preview reads and the sale-recording modules all run for real; only Supabase, the session,
 * permissions and toasts are stubbed. Proves the preview appears exactly where P4 allows, gives each
 * policy its own estimate, credits the stored owner, and leaves every sale payload, request id, retry,
 * close guard and callback order unchanged.
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
  profileRow: null as unknown,
  team: [] as string[],
  context: null as unknown,
  rpcCalls: [] as Array<[string, unknown]>,
  readCalls: [] as string[],
  saleFailures: 0,
  saleGate: null as Promise<void> | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const SALES = new Set(["convert_lead_to_client_with_sales", "create_client_with_sale", "record_client_policy", "update_client_with_policy_sale"]);
  const rows: Record<string, () => unknown> = {
    leads: () => ({ assigned_agent_id: h.leadOwner }),
    clients: () => ({ assigned_agent_id: h.clientOwner }),
    profiles: () => h.profileRow,
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "in", "limit"]) builder[method] = () => builder;
    builder.maybeSingle = async () => (h.readCalls.push(table), { data: rows[table]?.() ?? null, error: null });
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      h.readCalls.push(table);
      const data = table === "carriers" ? [{ name: "Synthetic Carrier North" }, { name: "Synthetic Carrier South" }] : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return builder;
  };
  const respond = async (name: string, args?: unknown) => {
    h.rpcCalls.push([name, JSON.parse(JSON.stringify(args ?? null))]);
    if (name === "get_commission_calculator_context") return { data: h.context, error: null };
    if (name === "get_contact_scope_agents") return { data: h.team.map((id) => ({ id, first_name: "S", last_name: "T" })), error: null };
    if (!SALES.has(name)) return { data: null, error: null };
    if (h.saleGate) await h.saleGate;
    if (h.saleFailures > 0) return (h.saleFailures -= 1, { data: null, error: { message: "Connection lost" } });
    if (name === "convert_lead_to_client_with_sales") return { data: { client_id: h.ids.newClient, win_ids: ["w-1"] }, error: null };
    if (name === "record_client_policy") return { data: { client_id: h.ids.client, win_ids: ["w-1"], idempotent: false }, error: null };
    return { data: { client: { id: h.ids.client }, client_id: h.ids.client, win_ids: ["w-1"] }, error: null };
  };
  // Like PostgREST, the request is awaitable and accepts an abort signal (the calculator API passes one).
  const rpc = (name: string, args?: unknown) => {
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
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

function rawContext(level: string | null) {
  const c = syntheticContext(level);
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const regions = () => screen.queryAllByRole("region", { name: "Commission estimate" });
const lines = (region: HTMLElement) =>
  within(region).queryAllByText(/^Estimated (first-year commission|advance \(75%\)):/).map((node) => node.textContent);
const choose = (region: HTMLElement, label: string, value: string) => fireEvent.change(within(region).getByLabelText(label), { target: { value } });
const salesTo = (name: string) => h.rpcCalls.filter(([n]) => n === name).map(([, args]) => args);
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

beforeEach(() => {
  Object.assign(h, { role: "Agent", impersonating: false, leadOwner: A, clientOwner: A, team: [], saleFailures: 0, saleGate: null });
  h.perms = new Set([OWN]);
  h.profileRow = { id: B, first_name: "Synthetic", last_name: "B", email: "b@example.test", commission_level: "120" };
  h.context = rawContext("100");
  h.rpcCalls = [];
  h.readCalls = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── ConvertLeadModal ─────────────────────────────────────────────────────────────────────────────────
const LEAD = { id: LEAD_ID, firstName: "Pat", lastName: "Lee", assignedAgentId: A, age: 60 } as unknown as Lead;

function openConvert(lead: Lead = LEAD) {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  const order: string[] = [];
  onSuccess.mockImplementation(() => order.push("onSuccess"));
  onClose.mockImplementation(() => order.push("onClose"));
  mount(<ConvertLeadModal open lead={lead} onSuccess={onSuccess} onClose={onClose} campaignId={null} />);
  return { onSuccess, onClose, order };
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

async function convertTwoPolicies(touchPreview: boolean) {
  const view = openConvert();
  await fillPolicy(0, "Final Expense", "100");
  fireEvent.click(screen.getByTitle("Add another policy"));
  await fillPolicy(1, "IUL", "200", SOUTH);
  if (touchPreview) {
    await waitFor(() => expect(regions()).toHaveLength(2));
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[1], "Product", IDS.juvenile);
    choose(regions()[1], "Insured age", "10");
  }
  convert();
  await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
  return view;
}

describe("ConvertLeadModal", () => {
  it("gives every policy its own estimate and never a combined total", async () => {
    openConvert();
    await fillPolicy(0, "Final Expense", "100");
    fireEvent.click(screen.getByTitle("Add another policy"));
    await fillPolicy(1, "IUL", "200", SOUTH);
    await waitFor(() => expect(regions()).toHaveLength(2));
    const [first, second] = regions();
    choose(first, "Product", IDS.finalPlan);
    choose(second, "Product", IDS.juvenile);
    choose(second, "Insured age", "10");
    expect((within(first).getByLabelText("Insured age") as HTMLInputElement).value).toBe("60");
    expect(lines(first)).toEqual(["Estimated first-year commission: $858.00", "Estimated advance (75%): $643.50"]);
    expect(lines(second)).toEqual(["Estimated first-year commission: $1,536.00", "Estimated advance (75%): $1,152.00"]);
    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it("sends the identical conversion payload with or without the preview, then onSuccess before onClose", async () => {
    h.perms = new Set();
    await convertTwoPolicies(false);
    const withoutPermission = salesTo("convert_lead_to_client_with_sales");
    expect(h.rpcCalls.some(([n]) => n === "get_commission_calculator_context")).toBe(false);
    cleanup();
    h.rpcCalls = [];
    h.perms = new Set([OWN]);
    await convertTwoPolicies(false);
    const untouched = salesTo("convert_lead_to_client_with_sales");
    cleanup();
    h.rpcCalls = [];
    const view = await convertTwoPolicies(true);
    const touched = salesTo("convert_lead_to_client_with_sales");
    expect(withoutPermission).toHaveLength(1);
    expect(untouched).toEqual(withoutPermission);
    expect(touched).toEqual(withoutPermission);
    expect(view.onSuccess).toHaveBeenCalledWith(h.ids.newClient);
    expect(view.order).toEqual(["onSuccess", "onClose"]);
  });

  it("keeps the form and estimate after a failed save, retries the same sale, and cannot close mid-save", async () => {
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    h.saleFailures = 1;
    convert();
    await waitFor(() => expect(salesTo("convert_lead_to_client_with_sales")).toHaveLength(1));
    await flush();
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(lines(regions()[0])).toHaveLength(2);
    let release!: () => void;
    h.saleGate = new Promise<void>((resolve) => { release = resolve; });
    convert();
    await waitFor(() => expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(view.onSuccess).toHaveBeenCalledTimes(1));
    const [failed, retried] = salesTo("convert_lead_to_client_with_sales");
    expect(retried).toEqual(failed);
    expect(view.order).toEqual(["onSuccess", "onClose"]);
  });

  it("Cancel closes without converting", async () => {
    const view = openConvert();
    await fillPolicy(0, "Final Expense", "100");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(salesTo("convert_lead_to_client_with_sales")).toHaveLength(0);
  });

  it("credits the STORED lead owner, never the modal's lead object or the operator", async () => {
    Object.assign(h, { role: "Admin", leadOwner: B });
    h.perms = new Set([OWN, OTHERS]);
    openConvert({ ...LEAD, assignedAgentId: A } as Lead);
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(within(regions()[0]).getByText("For Synthetic B")).toBeTruthy());
    choose(regions()[0], "Product", IDS.finalPlan);
    expect(lines(regions()[0])).toEqual(["Estimated first-year commission: $1,056.00", "Estimated advance (75%): $792.00"]);
    cleanup();
    h.perms = new Set([OWN]);
    openConvert({ ...LEAD, assignedAgentId: A } as Lead);
    await fillPolicy(0, "Final Expense", "100");
    await flush();
    expect(regions()).toHaveLength(0);
  });

  it("states 'No assigned agent' for an unassigned stored lead", async () => {
    h.leadOwner = null;
    openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()[0]?.textContent).toBe("No assigned agent"));
  });

  it("makes no request while typing once the estimate is ready", async () => {
    openConvert();
    await fillPolicy(0, "Final Expense", "100");
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    await flush();
    const before = [h.rpcCalls.length, h.readCalls.length];
    for (const premium of ["1", "12", "125", "125.5", "125.50"]) {
      fireEvent.change(screen.getAllByPlaceholderText("125.00")[0], { target: { value: premium } });
    }
    for (const age of ["6", "61", "62"]) choose(regions()[0], "Insured age", age);
    await flush();
    expect([h.rpcCalls.length, h.readCalls.length]).toEqual(before);
    expect(lines(regions()[0])).toEqual(["Estimated first-year commission: $1,076.79", "Estimated advance (75%): $807.59"]);
  });
});

// ── AddClientModal ───────────────────────────────────────────────────────────────────────────────────
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByText(label).parentElement!.querySelector("input, select")!, { target: { value } });

function openAddClient(initial?: Partial<Client>) {
  const onClose = vi.fn();
  const onSave = vi.fn((data: Partial<Client>, sale?: Parameters<typeof clientsSupabaseApi.create>[2]) =>
    initial
      ? clientsSupabaseApi.update(initial.id!, data).then(() => undefined)
      : clientsSupabaseApi.create({ ...data, assignedAgentId: A } as never, ORG, sale).then(() => undefined));
  mount(<AddClientModal open onClose={onClose} onSave={onSave} initial={initial ?? null} />);
  return { onClose, onSave, submit: () => fireEvent.submit(document.querySelector("form")!) };
}
async function newClientSale(touchPreview: boolean, failures = 0) {
  h.saleFailures = failures;
  const view = openAddClient();
  fill("First Name *", "Pat");
  fill("Last Name *", "Lee");
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "5551234567" } });
  fill("Policy Type", "Final Expense");
  fill("Carrier", NORTH);
  fill("Monthly Premium", "$100.00");
  fireEvent.change(screen.getAllByTestId("date")[0], { target: { value: "2026-10-03" } });
  if (touchPreview) {
    await waitFor(() => expect(regions()).toHaveLength(1));
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[0], "Insured age", "60");
    expect(lines(regions()[0])).toEqual(["Estimated first-year commission: $858.00", "Estimated advance (75%): $643.50"]);
  }
  for (let attempt = 0; attempt <= failures; attempt += 1) {
    view.submit();
    await waitFor(() => expect(salesTo("create_client_with_sale")).toHaveLength(attempt + 1));
    await flush();
  }
  await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
  return view;
}

describe("AddClientModal", () => {
  it("shows the panel only when this save would record a new policy (P4)", async () => {
    openAddClient();
    expect(regions()).toHaveLength(0);
    fill("Carrier", NORTH);
    await waitFor(() => expect(regions()).toHaveLength(1));
    cleanup();
    openAddClient({ id: CLIENT_ID, firstName: "Pat", lastName: "Lee", phone: "5551234567", policyType: "Whole Life", carrier: NORTH, premiumAmount: "$100.00", assignedAgentId: A });
    fill("Monthly Premium", "$150.00");
    await flush();
    expect(regions()).toHaveLength(0);
    cleanup();
    openAddClient({ id: CLIENT_ID, firstName: "Pat", lastName: "Lee", phone: "5551234567", assignedAgentId: A });
    expect(regions()).toHaveLength(0);
    fill("Carrier", NORTH);
    await waitFor(() => expect(regions()).toHaveLength(1));
    expect(h.readCalls).toContain("clients");
  });

  it("sends the identical create_client_with_sale payload, and a failed save retries the same request", async () => {
    await newClientSale(false);
    const control = salesTo("create_client_with_sale");
    cleanup();
    h.rpcCalls = [];
    await newClientSale(true, 1);
    const [failed, retried] = salesTo("create_client_with_sale");
    expect(control).toHaveLength(1);
    expect(failed).toEqual(control[0]);
    expect(retried).toEqual(control[0]);
  });

  it("sends the identical first-policy edit payload", async () => {
    const run = async (touchPreview: boolean) => {
      const initial = { id: CLIENT_ID, firstName: "Pat", lastName: "Lee", phone: "5551234567", email: "", state: "", assignedAgentId: A };
      const view = openAddClient(initial);
      fill("Policy Type", "Final Expense");
      fill("Carrier", NORTH);
      fill("Monthly Premium", "100");
      fireEvent.change(screen.getAllByTestId("date")[0], { target: { value: "2026-10-03" } });
      if (touchPreview) {
        await waitFor(() => expect(regions()).toHaveLength(1));
        choose(regions()[0], "Product", IDS.finalPlan);
        choose(regions()[0], "Insured age", "60");
        expect(lines(regions()[0])).toHaveLength(2);
      }
      view.submit();
      await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
      const [args] = salesTo("update_client_with_policy_sale") as Array<{ p_patch: Record<string, unknown> }>;
      expect(typeof args.p_patch.updated_at).toBe("string");
      return { ...args, p_patch: { ...args.p_patch, updated_at: "<now>" } };
    };
    const control = await run(false);
    cleanup();
    h.rpcCalls = [];
    expect(await run(true)).toEqual(control);
  });
});

// ── RecordPolicyModal ────────────────────────────────────────────────────────────────────────────────
function openRecord() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  mount(<RecordPolicyModal open clientId={CLIENT_ID} onClose={onClose} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("Policy type"), { target: { value: "Final Expense" } });
  fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: NORTH } });
  fireEvent.change(screen.getByLabelText("Monthly premium"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Sold Date"), { target: { value: "2026-10-03" } });
  return { onClose, onSaved, submit: () => fireEvent.click(screen.getByRole("button", { name: "Record Policy" })) };
}

describe("RecordPolicyModal", () => {
  it("credits the client's stored owner for a Team Leader in scope, with an unchanged payload and retry", async () => {
    Object.assign(h, { role: "Team Leader", clientOwner: B, team: [A, B] });
    h.perms = new Set([OTHERS]);
    const control = openRecord();
    control.submit();
    await waitFor(() => expect(control.onSaved).toHaveBeenCalledTimes(1));
    const [baseline] = salesTo("record_client_policy");
    cleanup();
    h.rpcCalls = [];
    h.saleFailures = 1;
    const view = openRecord();
    await waitFor(() => expect(within(regions()[0]).getByText("For Synthetic B")).toBeTruthy());
    choose(regions()[0], "Product", IDS.finalPlan);
    choose(regions()[0], "Insured age", "60");
    expect(lines(regions()[0])).toEqual(["Estimated first-year commission: $1,056.00", "Estimated advance (75%): $792.00"]);
    view.submit();
    await screen.findByText("Connection lost");
    expect(view.onClose).not.toHaveBeenCalled();
    view.submit();
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
    const [failed, retried] = salesTo("record_client_policy");
    expect(failed).toEqual(baseline);
    expect(retried).toEqual(baseline);
  });

  it("shows nothing for a Team Leader outside the credited agent's scope", async () => {
    Object.assign(h, { role: "Team Leader", clientOwner: B, team: [A] });
    h.perms = new Set([OWN, OTHERS]);
    openRecord();
    await waitFor(() => expect(h.rpcCalls.some(([n]) => n === "get_contact_scope_agents")).toBe(true));
    await flush();
    expect(regions()).toHaveLength(0);
    expect(h.readCalls).not.toContain("profiles");
  });
});

describe("View As", () => {
  it("issues no commission request and renders no panel in any of the three modals", async () => {
    h.impersonating = true;
    h.perms = new Set([OWN, OTHERS]);
    openConvert();
    await fillPolicy(0, "Final Expense", "100");
    cleanup();
    openAddClient();
    fill("Carrier", NORTH);
    cleanup();
    openRecord();
    await flush();
    expect(regions()).toHaveLength(0);
    expect(h.rpcCalls.map(([n]) => n)).not.toContain("get_commission_calculator_context");
    expect(h.readCalls.filter((t) => t !== "carriers")).toEqual([]);
  });
});
