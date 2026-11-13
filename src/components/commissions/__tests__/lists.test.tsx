/**
 * Payments (Scheduled, History) and Policies: one row per installment / receipt / policy, restricted contacts, missing
 * values shown as "—" (never $0), totals over the whole filter, pagination and filters in the URL.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG, USER, TEAM_AGENT, testScope, historyPage, historyRow, policiesPage, policyRow, scheduledPage, scheduledRow } from "./centerFixtures";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, data: {} as Record<string, unknown>, hold: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const request = h.hold ? new Promise(() => undefined) : Promise.resolve({ data: h.data[name], error: null });
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isImpersonating: false, profile: { id: USER, role: "Agent", organization_id: ORG } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canSeeCommission: () => true, isLoading: false }) }));

import { PaymentsTab } from "../payments/PaymentsTab";
import { PoliciesTab } from "../policies/PoliciesTab";
import { CommissionScopeContext } from "../commissionScopeContext";

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}
const onOpen = vi.fn();
function renderAt(url: string, node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{node}<Where /></MemoryRouter></QueryClientProvider>);
}
const lastArgs = (fn: string) => h.calls.filter(([n]) => n === fn).at(-1)?.[1];
beforeEach(() => {
  h.calls = []; h.hold = false;
  onOpen.mockReset();
  h.data = {
    get_my_commission_installments: scheduledPage([
      scheduledRow(1, { status: "check_payment", expected_on: "2026-10-05", expected_until: "2026-10-07" }),
      scheduledRow(2, { contact: null, status: "received", remaining_cents: 0, received_cents: 42975 }),
      scheduledRow(3, { kind: "month_10", timing_precision: "unknown", expected_on: null, expected_until: null, window_end: null, status: "date_needed" }),
    ]),
    get_my_commission_receipt_list: historyPage([historyRow(1), historyRow(2, { voided: true, void_reason: "Recorded twice" }),
      historyRow(3, { replaces_receipt_id: "00000000-0000-4000-8000-000000000501", contact: null })]),
    get_my_commission_policy_list: policiesPage([
      policyRow(1),
      policyRow(2, { setup: "missing", estimate_cents: null, received_cents: null, remaining_cents: null, excess_cents: null, next_payment: null,
        product: "Term" }),
      policyRow(3, { setup: "on_hold", contact: null, effective_date: null,
        next_payment: { kind: "advance", timing_precision: "date", expected_on: "2026-11-02", expected_until: "2026-11-04", remaining_cents: 100, status: "on_hold" } }),
    ]),
  };
});
afterEach(cleanup);

describe("Payments › Scheduled", () => {
  it.each([
    ["/commissions/payments", "Scheduled payments", "get_my_commission_installments"],
    ["/commissions/payments?view=history", "Payment history", "get_my_commission_receipt_list"],
    ["/commissions/policies", "Policies", "get_my_commission_policy_list"],
  ])("U07: %s labels retained rows as updating and disables every row action", async (url, label, rpc) => {
    h.data[rpc] = { ...h.data[rpc] as object, total_count: 60 };
    renderAt(url, label === "Policies" ? <PoliciesTab onOpen={onOpen} /> : <PaymentsTab onOpen={onOpen} />);
    const table = await screen.findByRole("table", { name: label });
    h.hold = true; fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastArgs(rpc)).toMatchObject({ p_offset: 25 }));
    expect(screen.getByText(/Updating/)).toBeInTheDocument();
    const actions = within(table).getAllByRole("button");
    expect(actions.length).toBeGreaterThan(0);
    for (const button of actions) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("one row per installment with window, amounts, status, and Record payment only where something remains", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    const table = await screen.findByRole("table", { name: "Scheduled payments" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Oct 5 – 7, 2026");
    expect(rows[0].textContent).toContain("Check payment");
    expect(rows[1].textContent).toContain("Restricted contact");
    expect(within(rows[1]).queryByRole("button", { name: "Record payment" })).toBeNull();
    expect(rows[2].textContent).toContain("Date needed");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Record payment" }));
    expect(onOpen).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000301", { payment: "00000000-0000-4000-8000-000000000101" });
    fireEvent.click(within(rows[1]).getByRole("button", { name: /Restricted contact/ }));
    expect(onOpen).toHaveBeenLastCalledWith("00000000-0000-4000-8000-000000000302");
  });

  it("totals cover the whole filter; pages and filters live in the URL", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await screen.findByText("60 payments");
    expect(screen.getByText("1–25 of 60")).toBeInTheDocument();
    expect(screen.getByText("60 payments").parentElement?.textContent).toContain("Remaining $605.14");
    expect(screen.getByRole("link", { name: "On hold: 4 not shown" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastArgs("get_my_commission_installments")).toMatchObject({ p_offset: 25 }));
    expect(screen.getByTestId("where").textContent).toBe("?page=2");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "check_payment" } });
    await waitFor(() => expect(lastArgs("get_my_commission_installments")).toMatchObject({ p_status: "check_payment", p_offset: 0 }));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "later" } });
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "Harbor Mutual" } });
    fireEvent.change(screen.getByLabelText("Dates"), { target: { value: "any" } });
    await waitFor(() => expect(lastArgs("get_my_commission_installments")).toMatchObject(
      { p_status: "check_payment", p_kind: "later", p_carrier: "Harbor Mutual", p_scope: "any" }));
    expect(screen.queryByLabelText("Period")).toBeNull();
  });
});

describe("Payments › History", () => {
  it("one row per receipt; voids keep their reason; corrections are marked; voided are opt-in", async () => {
    renderAt("/commissions/payments?view=history", <PaymentsTab onOpen={onOpen} />);
    const table = await screen.findByRole("table", { name: "Payment history" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("Voided");
    expect(rows[1].textContent).toContain("Recorded twice");
    expect(rows[2].textContent).toContain("Correction");
    expect(rows[2].textContent).toContain("Restricted contact");
    expect(lastArgs("get_my_commission_receipt_list")).toMatchObject({ p_include_voided: false });
    fireEvent.click(screen.getByLabelText("Show voided"));
    await waitFor(() => expect(lastArgs("get_my_commission_receipt_list")).toMatchObject({ p_include_voided: true }));
  });

  it("switching views keeps the period and drops view-only filters", async () => {
    renderAt("/commissions/payments?period=last_month&status=received", <PaymentsTab onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    expect(screen.getByTestId("where").textContent).toBe("?period=last_month&view=history");
  });

  it("carrier filter (what Received by carrier opens): one carrier or Unknown, composed with period and voided", async () => {
    h.data.get_my_commission_receipt_list = historyPage([historyRow(1)], { carriers: ["Harbor Mutual", "Synthetic Life"], has_unknown_carrier: true });
    renderAt("/commissions/payments?view=history&period=last_month&carrier=synthetic%20life", <PaymentsTab onOpen={onOpen} />);
    await screen.findByRole("table", { name: "Payment history" });
    expect(lastArgs("get_my_commission_receipt_list")).toMatchObject({ p_period: "last_month", p_carrier: "synthetic life", p_carrier_unknown: false });
    expect((screen.getByLabelText("Carrier") as HTMLSelectElement).value).toBe("Synthetic Life");
    expect([...(screen.getByLabelText("Carrier") as HTMLSelectElement).options].map((o) => o.text))
      .toEqual(["All carriers", "Harbor Mutual", "Synthetic Life", "Unknown carrier"]);
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "__unknown__" } });
    await waitFor(() => expect(lastArgs("get_my_commission_receipt_list")).toMatchObject({ p_carrier: null, p_carrier_unknown: true }));
    expect(screen.getByTestId("where").textContent).toBe("?view=history&period=last_month&carrier_unknown=1");
    fireEvent.click(screen.getByLabelText("Show voided"));
    await waitFor(() => expect(lastArgs("get_my_commission_receipt_list")).toMatchObject({ p_carrier_unknown: true, p_include_voided: true }));
    fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
    expect(screen.getByTestId("where").textContent).toBe("?period=last_month");
  });
});

describe("Policies", () => {
  it("U09: All is read-only even on the viewer's own rows; credited sellers remain visible", async () => {
    h.data.get_my_commission_policy_list = policiesPage([
      policyRow(1, { credited_agent_id: USER, agent_name: "Morgan Seller" }),
      policyRow(2, { setup: "missing", estimate_cents: null, received_cents: null, remaining_cents: null, excess_cents: null, next_payment: null,
        credited_agent_id: TEAM_AGENT, agent_name: "Jordan Agent" }),
    ]);
    renderAt("/commissions/policies?agents=all", <CommissionScopeContext.Provider value={testScope({ mode: "all", agentIds: [] })}>
      <PoliciesTab onOpen={onOpen} />
    </CommissionScopeContext.Provider>);
    const table = await screen.findByRole("table", { name: "Policies" });
    expect(within(table).queryByRole("button", { name: "Record estimate" })).toBeNull();
    expect(within(table).getAllByText("Morgan Seller").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Jordan Agent").length).toBeGreaterThan(0);
    fireEvent.click(within(table).getByRole("button", { name: /Client 1/ }));
    expect(onOpen).toHaveBeenCalledWith(policyRow(1).policy_id);
    expect(h.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
  });

  it("one row per policy; missing values are dashes with Record estimate; held policies still show the next payment", async () => {
    renderAt("/commissions/policies", <PoliciesTab onOpen={onOpen} />);
    const table = await screen.findByRole("table", { name: "Policies" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("$573.00");
    expect(rows[1].textContent).not.toContain("$0.00");
    expect(within(rows[1]).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Record estimate" }));
    expect(onOpen).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000302");
    expect(rows[2].textContent).toContain("Restricted contact");
    expect(rows[2].textContent).toContain("On hold");
    expect(rows[2].textContent).toContain("Advance · Nov 2 – 4, 2026");
    expect(screen.getByText("10 of 12")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "missing" } });
    await waitFor(() => expect(lastArgs("get_my_commission_policy_list")).toMatchObject({ p_setup: "missing", p_offset: 0 }));
  });

  it("Sold, Type and Unknown carrier compose with Show; totals cover the whole filter (held disclosed, missing not $0)", async () => {
    h.data.get_my_commission_policy_list = policiesPage([policyRow(1)], { has_unknown_carrier: true,
      totals: { policies: 4, with_estimate_count: 2, estimate_cents: 114600, on_hold_count: 1, on_hold_cents: 57300, without_estimate_count: 1 } });
    renderAt("/commissions/policies?period=this_month&type=final_expense&carrier_unknown=1&setup=missing", <PoliciesTab onOpen={onOpen} />);
    await screen.findByRole("table", { name: "Policies" });
    expect(lastArgs("get_my_commission_policy_list")).toEqual({ p_setup: "missing", p_carrier: null, p_carrier_unknown: true,
      p_category: "final_expense", p_period: "this_month", p_from: null, p_to: null, p_limit: 25, p_offset: 0 });
    expect(screen.getByText("4 policies · 2 with estimate · On hold: 1 not included")).toBeInTheDocument();
    expect(screen.getByText("$1,146.00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sold"), { target: { value: "all" } });
    await waitFor(() => expect(lastArgs("get_my_commission_policy_list")).toMatchObject({ p_period: "all", p_category: "final_expense" }));
    expect(screen.getByTestId("where").textContent).toBe("?type=final_expense&carrier_unknown=1&setup=missing");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "__all__" } });
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "Synthetic Life" } });
    await waitFor(() => expect(lastArgs("get_my_commission_policy_list")).toMatchObject(
      { p_category: null, p_carrier: "Synthetic Life", p_carrier_unknown: false, p_setup: "missing" }));
  });

  it("an unfinished custom Sold range requests nothing", async () => {
    renderAt("/commissions/policies?period=custom&from=2026-10-01", <PoliciesTab onOpen={onOpen} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.calls).toEqual([]);
  });
});

describe("Team payments", () => {
  it("U09: Scheduled hides every Record payment shortcut and shows the credited seller", async () => {
    h.data.get_my_commission_installments = scheduledPage([scheduledRow(1, { credited_agent_id: TEAM_AGENT, agent_name: "Jordan Agent" })]);
    renderAt("/commissions/payments?agents=all", <CommissionScopeContext.Provider value={testScope({ mode: "all", agentIds: [] })}>
      <PaymentsTab onOpen={onOpen} />
    </CommissionScopeContext.Provider>);
    const table = await screen.findByRole("table", { name: "Scheduled payments" });
    expect(within(table).queryByRole("button", { name: "Record payment" })).toBeNull();
    expect(within(table).getAllByText("Jordan Agent").length).toBeGreaterThan(0);
    fireEvent.click(within(table).getByRole("button", { name: /Client 1/ }));
    expect(onOpen).toHaveBeenCalledWith(scheduledRow(1).policy_id);
  });

  it("U03: Scheduled/History navigation retains agent parameters separately from date scope", async () => {
    renderAt(`/commissions/payments?agents=selected&agent_ids=${TEAM_AGENT}&period=last_month&dates=next_90`,
      <CommissionScopeContext.Provider value={testScope({ mode: "selected", agentIds: [TEAM_AGENT] })}>
        <PaymentsTab onOpen={onOpen} />
      </CommissionScopeContext.Provider>);
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    const history = new URLSearchParams(screen.getByTestId("where").textContent!);
    expect(history.get("agents")).toBe("selected");
    expect(history.get("agent_ids")).toBe(TEAM_AGENT);
    expect(history.get("period")).toBe("last_month");
    expect(history.has("dates")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
    const scheduled = new URLSearchParams(screen.getByTestId("where").textContent!);
    expect(scheduled.get("agents")).toBe("selected");
    expect(scheduled.get("agent_ids")).toBe(TEAM_AGENT);
    expect(scheduled.has("view")).toBe(false);
  });
});
