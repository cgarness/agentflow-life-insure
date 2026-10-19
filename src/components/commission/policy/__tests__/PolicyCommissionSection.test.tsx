import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  read: null as unknown,
  calls: [] as Array<[string, Record<string, unknown>]>,
  writes: [] as Array<{ data: unknown; error: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const response = name === "get_client_policy_commissions" ? { data: h.read, error: null } : h.writes.shift() ?? { data: null, error: { message: "unset" } };
      const request = Promise.resolve(response);
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000a1" }, isImpersonating: false,
    profile: { id: "00000000-0000-4000-8000-0000000000a1", role: "Agent", organization_id: "00000000-0000-4000-8000-0000000000e1" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "00000000-0000-4000-8000-0000000000e1", role: "Agent" }) }));

import { PolicyCommissionSection } from "../PolicyCommissionSection";
import { ClientPolicies } from "@/components/contacts/ClientPolicies";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const POLICY = "00000000-0000-4000-8000-0000000000d1";
let n = 100;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const installment = (kind: string, cents: number, receipts: unknown[] = []) => ({
  id: id(), kind, expected_cents: cents, timing_precision: "unknown", expected_on: null, timing_source: "unset", receipts,
});
function open(state: string, access: "write" | "read", extra: Record<string, unknown> = {}, policyId = POLICY) {
  return {
    policy_id: policyId, source: "primary", state, access, credited_agent_id: id(), win_id: id(),
    basis: { policy_type: "Term", carrier: "Synthetic Carrier", monthly_premium: "50.00", premium_source: "sale_snapshot", effective_date: "2026-11-01" },
    estimate: null, capture: null, ...extra,
  };
}
const estimate = (status = "active") => ({
  id: id(), status, status_reason: status === "on_hold" ? "Carrier review" : null, capture_mode: "sale_entry", captured_by: id(), recorded_by: id(),
  recorded_at: "2026-10-19T17:00:00Z", grid_name: "Synthetic Grid", grid_revision: 4, grid_effective_date: "2026-01-01",
  product_name: "Synthetic Term", product_carrier: "Synthetic Carrier", variant_label: "Ages 18-60", insured_age: 35, term_years: 20,
  contract_level: 100, rate_percent: "95.50", monthly_premium: "50.00", premium_source: "sale_snapshot", first_year_cents: 57300,
  advance_cents: 42975, schedule_start_on: null, schedule_start_source: null, state_revision: 1,
  installments: [
    installment("advance", 42975, [{ id: id(), amount_cents: 20000, received_on: "2026-10-19", reference: "Statement 42", recorded_by: id(),
      recorded_at: "2026-10-19T18:00:00Z", replaces_receipt_id: null, voided_at: null, void_reason: null }]),
    installment("month_10", 4775), installment("month_11", 4775), installment("month_12", 4775),
  ],
});
const capture = (status: string, code: string | null = null) => ({
  id: id(), status, attention_code: code, first_year_cents: 57300, advance_cents: 42975, captured_by: id(),
  captured_at: "2026-10-19T17:00:00Z", product_id: id(), insured_age: 35, term_years: 20,
});

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const section = () => screen.queryByRole("region", { name: "Commission" });
const settle = () => waitFor(() => expect(h.calls.some(([name]) => name === "get_client_policy_commissions")).toBe(true));

beforeEach(() => { h.calls = []; h.writes = []; });
afterEach(cleanup);

describe("PolicyCommissionSection", () => {
  it("shows nothing for hidden, unavailable or read-only unrecorded policies", async () => {
    for (const policy of [{ policy_id: POLICY, source: "primary", state: "hidden" }, { policy_id: POLICY, source: "primary", state: "unavailable" },
      open("not_recorded", "read")]) {
      h.read = { client_id: CLIENT, policies: [policy] };
      mount(<PolicyCommissionSection clientId={CLIENT} policyId={POLICY} />);
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(section()).toBeNull();
      cleanup();
      h.calls = [];
    }
  });

  it("offers to record an estimate for an unrecorded policy the user may write", async () => {
    h.read = { client_id: CLIENT, policies: [open("not_recorded", "write")] };
    mount(<PolicyCommissionSection clientId={CLIENT} policyId={POLICY} />);
    expect(await screen.findByText("No commission estimate recorded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record estimate" })).toBeTruthy();
  });

  it("summarises a recorded estimate compactly and expands to the expected payments", async () => {
    h.read = { client_id: CLIENT, policies: [open("recorded", "write", { estimate: estimate() })] };
    mount(<PolicyCommissionSection clientId={CLIENT} policyId={POLICY} />);
    const toggle = await screen.findByRole("button", { expanded: false });
    expect(toggle.textContent).toContain("Est. first-year $573.00");
    expect(toggle.textContent).toContain("Received $200.00");
    expect(toggle.textContent).toContain("Remaining $373.00");
    fireEvent.click(toggle);
    const payments = screen.getByRole("list", { name: "Expected payments" });
    expect(Array.from(payments.children).map((item) => item.textContent)).toEqual([
      expect.stringContaining("Advance (75%)"), expect.stringContaining("Month 10"), expect.stringContaining("Month 11"), expect.stringContaining("Month 12"),
    ]);
    expect(within(payments).getAllByText(/Payment timing unconfirmed/)).toHaveLength(4);
    expect(screen.getByText("At sale entry")).toBeTruthy();
    expect(screen.getByText(/Schedule start not confirmed/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Record payment" })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Place on hold" })).toBeTruthy();
    expect(section()!.textContent).not.toMatch(/earned|overdue|\bdue\b|paid commission/i);
  });

  it("is read-only for a Team Leader and shows a hold", async () => {
    h.read = { client_id: CLIENT, policies: [open("recorded", "read", { estimate: estimate("on_hold") })] };
    mount(<PolicyCommissionSection clientId={CLIENT} policyId={POLICY} />);
    fireEvent.click(await screen.findByRole("button", { expanded: false }));
    expect(screen.getAllByText("On hold").length).toBeGreaterThan(0);
    expect(screen.getByText("On hold: Carrier review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record payment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Place on hold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Release hold" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("an estimate awaiting confirmation: the seller confirms; a Team Leader only sees it", async () => {
    h.read = { client_id: CLIENT, policies: [open("awaiting_confirmation", "write", { capture: capture("awaiting_confirmation") })] };
    h.writes = [{ data: { estimate_id: id(), status: "recorded" }, error: null }];
    mount(<PolicyCommissionSection clientId={CLIENT} policyId={POLICY} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm estimate" }));
    await waitFor(() => expect(h.calls.some(([name]) => name === "confirm_policy_commission_capture")).toBe(true));
    cleanup();
    h.read = { client_id: CLIENT, policies: [open("needs_attention", "read", { capture: capture("needs_attention", "rate_changed") })] };
    mount(<PolicyCommissionSection clientId={CLIENT} policyId={POLICY} />);
    expect(await screen.findByText(/comp grid rate changed/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ClientPolicies", () => {
  it("binds each displayed policy to its own commission by stored policy identity", async () => {
    const additional = id();
    h.read = { client_id: CLIENT, policies: [open("recorded", "write", { estimate: estimate() }), open("not_recorded", "write", { source: "additional" }, additional)] };
    mount(<ClientPolicies formatDate={(value) => value} client={{
      id: CLIENT, primaryPolicyId: POLICY, policyType: "Term", carrier: "Synthetic Carrier", premiumAmount: "$50.00",
      customFields: { additional_policies: [{ policyId: additional, policyType: "Final Expense", carrier: "Synthetic Carrier", premiumAmount: "30" }] },
    }} />);
    const triggers = screen.getAllByRole("button").filter((button) => button.getAttribute("aria-controls"));
    fireEvent.click(triggers[0]);
    fireEvent.click(triggers[1]);
    await waitFor(() => expect(screen.getAllByRole("region", { name: "Commission" })).toHaveLength(2));
    const [primary, extra] = screen.getAllByRole("region", { name: "Commission" });
    expect(primary.textContent).toContain("Est. first-year $573.00");
    expect(extra.textContent).toContain("No commission estimate recorded.");
    expect(h.calls.filter(([name]) => name === "get_client_policy_commissions")).toHaveLength(1);
  });

  it("a single-policy client still gets its compact commission section", async () => {
    h.read = { client_id: CLIENT, policies: [open("recorded", "write", { estimate: estimate() })] };
    mount(<ClientPolicies formatDate={(value) => value} client={{ id: CLIENT, primaryPolicyId: POLICY, carrier: "Synthetic Carrier", premiumAmount: "$50.00" }} />);
    await waitFor(() => expect(section()?.textContent).toContain("Est. first-year $573.00"));
  });
});
