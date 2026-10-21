/**
 * Payments (Scheduled, History) and Policies: one row per installment / receipt / policy, restricted contacts, missing
 * values shown as "—" (never $0), totals over the whole filter, pagination and filters in the URL.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG, USER, historyPage, historyRow, policiesPage, policyRow, scheduledPage, scheduledRow } from "./centerFixtures";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, data: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const request = Promise.resolve({ data: h.data[name], error: null });
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
  h.calls = [];
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
});

describe("Policies", () => {
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
});
