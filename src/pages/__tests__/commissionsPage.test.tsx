/**
 * /commissions: four addressable tabs (Overview default), the legacy calculator address, browser back/forward, the
 * permission and "View As" gates (no request at all), reporting without a calculator grid, the calculator's inputs kept
 * across tab switches but cleared on an identity change, and the calculator never touching reporting data.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import { ORG, USER, drawer, overview, policiesPage, scheduledPage, historyPage } from "@/components/commissions/__tests__/centerFixtures";

const h = vi.hoisted(() => ({
  userId: "", impersonating: false, permitted: true, grid: "ready" as "ready" | "not_configured",
  calls: [] as Array<[string, Record<string, unknown>]>, contextEnabled: [] as boolean[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const data = name === "get_my_commission_overview" ? overview() : name === "get_my_commission_installments" ? scheduledPage()
        : name === "get_my_commission_receipts" ? historyPage() : name === "get_my_commission_policies" ? policiesPage()
          : name === "get_my_policy_commission" ? drawer() : null;
      const request = Promise.resolve(data ? { data, error: null } : { data: null, error: { message: "unexpected", code: "XX000" } });
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: h.userId }, isImpersonating: h.impersonating,
    profile: { id: h.impersonating ? "00000000-0000-4000-8000-0000000000ff" : h.userId, role: "Agent", organization_id: ORG } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canSeeCommission: () => h.permitted, isLoading: false }) }));
vi.mock("@/hooks/useCommissionCalculator", () => ({
  CALCULATOR_PERMISSION: "View Own Commission Percentage",
  useCommissionCalculatorAccess: () => ({ permitted: h.permitted, permissionsLoading: false, isImpersonating: h.impersonating }),
  useCommissionCalculatorContext: (enabled: boolean) => {
    h.contextEnabled.push(enabled);
    return { data: enabled ? (h.grid === "ready" ? syntheticContext("100") : { status: "not_configured" }) : undefined, isError: false, refetch: vi.fn() };
  },
}));

import CommissionsPage from "../CommissionsPage";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  h.userId = USER; h.impersonating = false; h.permitted = true; h.grid = "ready"; h.calls = []; h.contextEnabled = [];
});
afterEach(cleanup);

let nav: ReturnType<typeof useNavigate>;
function Probe() {
  nav = useNavigate();
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A fresh element each time, so a rerender re-runs the hooks with the current (mocked) identity.
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/commissions/:tab?" element={<CommissionsPage />} />
          <Route path="/commission-calculator" element={<Navigate to="/commissions/calculator" replace />} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { ...utils, rerenderSame: () => utils.rerender(tree()) };
}
const activeTab = () => screen.getByRole("navigation", { name: "Commissions" }).querySelector("[aria-current=page]")?.textContent;
const calls = (fn: string) => h.calls.filter(([name]) => name === fn);

describe("Commissions page", () => {
  it("opens Overview by default with one heading and four tabs", async () => {
    renderAt("/commissions");
    expect(screen.getAllByRole("heading", { level: 1 }).map((x) => x.textContent)).toEqual(["Commissions"]);
    expect(within(screen.getByRole("navigation", { name: "Commissions" })).getAllByRole("link").map((l) => l.textContent))
      .toEqual(["Overview", "Payments", "Policies", "Calculator"]);
    expect(activeTab()).toBe("Overview");
    await screen.findByRole("link", { name: "Expected" });
    expect(calls("get_my_commission_overview")).toEqual([["get_my_commission_overview", { p_period: "this_month", p_from: null, p_to: null }]]);
  });

  it.each([
    ["/commissions/payments", "Payments", "get_my_commission_installments"],
    ["/commissions/payments?view=history", "Payments", "get_my_commission_receipts"],
    ["/commissions/policies", "Policies", "get_my_commission_policies"],
  ])("deep link %s", async (url, tab, read) => {
    renderAt(url);
    expect(activeTab()).toBe(tab);
    await waitFor(() => expect(calls(read)).toHaveLength(1));
  });

  it("redirects the legacy calculator address and unknown tabs", async () => {
    renderAt("/commission-calculator");
    expect(screen.getByTestId("location").textContent).toBe("/commissions/calculator");
    expect(activeTab()).toBe("Calculator");
    cleanup();
    renderAt("/commissions/bogus");
    expect(screen.getByTestId("location").textContent).toBe("/commissions");
  });

  it("supports browser back and forward between tabs and filters", async () => {
    renderAt("/commissions");
    fireEvent.click(screen.getByRole("link", { name: "Policies" }));
    expect(activeTab()).toBe("Policies");
    fireEvent.click(screen.getByRole("link", { name: "Payments" }));
    act(() => nav(-1));
    expect(activeTab()).toBe("Policies");
    act(() => nav(-1));
    expect(activeTab()).toBe("Overview");
    act(() => nav(1));
    expect(activeTab()).toBe("Policies");
  });

  it("each card opens exactly its list", async () => {
    renderAt("/commissions?period=last_month");
    await screen.findByRole("link", { name: "Expected" });
    fireEvent.click(screen.getByRole("link", { name: "Remaining" }));
    expect(screen.getByTestId("location").textContent).toBe("/commissions/payments?period=last_month&status=remaining");
    await waitFor(() => expect(calls("get_my_commission_installments").at(-1)?.[1]).toMatchObject(
      { p_period: "last_month", p_scope: "range", p_status: "remaining", p_offset: 0 }));
    act(() => nav(-1));
    await screen.findByRole("link", { name: "Expected" });
    fireEvent.click(screen.getByRole("link", { name: "Received" }));
    expect(screen.getByTestId("location").textContent).toBe("/commissions/payments?view=history&period=last_month");
    await waitFor(() => expect(calls("get_my_commission_receipts").at(-1)?.[1]).toMatchObject({ p_period: "last_month", p_include_voided: false }));
    act(() => nav(-1));
    await screen.findByRole("link", { name: "Expected" });
    fireEvent.click(screen.getByRole("link", { name: "Next 90 days" }));
    await waitFor(() => expect(calls("get_my_commission_installments").at(-1)?.[1]).toMatchObject({ p_scope: "next_90", p_status: "all" }));
  });

  it("reports without a calculator grid; only the Calculator tab needs one", async () => {
    h.grid = "not_configured";
    renderAt("/commissions");
    await screen.findByRole("link", { name: "Expected" });
    expect(h.contextEnabled).toEqual([]);
    fireEvent.click(screen.getByRole("link", { name: "Calculator" }));
    expect(screen.getByText("Your agency hasn't set up the Commission Calculator yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    expect(screen.getByRole("link", { name: "Expected" })).toBeInTheDocument();
  });

  it("keeps calculator inputs across tab switches, never writes or reads reporting, and clears them for another user", async () => {
    const view = renderAt("/commissions/calculator");
    fireEvent.change(screen.getByLabelText("Client age"), { target: { value: "41" } });
    fireEvent.change(screen.getByLabelText("Monthly premium"), { target: { value: "85" } });
    const before = h.calls.length;
    fireEvent.click(screen.getByRole("link", { name: "Policies" }));
    await waitFor(() => expect(calls("get_my_commission_policies")).toHaveLength(1));
    fireEvent.click(screen.getByRole("link", { name: "Calculator" }));
    expect((screen.getByLabelText("Client age") as HTMLInputElement).value).toBe("41");
    expect((screen.getByLabelText("Monthly premium") as HTMLInputElement).value).toBe("85");
    // Only the Policies read happened: the calculator itself requested and wrote nothing.
    expect(h.calls.slice(before).map(([name]) => name)).toEqual(["get_my_commission_policies"]);
    h.userId = "00000000-0000-4000-8000-000000000999";
    view.rerenderSame();
    expect((screen.getByLabelText("Client age") as HTMLInputElement).value).toBe("");
  });

  it("the calculator's estimate is unchanged by the new copy and survives a tab switch exactly", async () => {
    renderAt("/commissions/calculator");
    const choose = (label: string, option: string) => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
      fireEvent.click(screen.getByRole("option", { name: option }));
    };
    choose("Policy type", "Term");
    choose("Carrier", "Synthetic Carrier North");
    choose("Product", "North Level Term");
    fireEvent.change(screen.getByLabelText("Client age"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Monthly premium"), { target: { value: "100" } });
    choose("Term length", "20 years");
    const estimate = () => within(screen.getByLabelText("Estimate")).getAllByRole("definition").map((cell) => cell.textContent);
    // The same figures as the calculator's own unit test (engine and inputs unchanged).
    expect(estimate()).toEqual(["92.5%", "$1,110.00", "$832.50", "$92.50", "$92.50", "$92.50"]);
    expect(screen.getByText("Your level:").textContent).toBe("Your level: 100");
    expect(screen.getByText("Estimate only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Payments" }));
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    fireEvent.click(screen.getByRole("link", { name: "Calculator" }));
    expect(estimate()).toEqual(["92.5%", "$1,110.00", "$832.50", "$92.50", "$92.50", "$92.50"]);
  });

  it("requests nothing under View As or without the Own commission permission", async () => {
    h.impersonating = true;
    renderAt("/commissions");
    expect(screen.getByText("Commissions aren't available")).toBeInTheDocument();
    cleanup();
    h.impersonating = false;
    h.permitted = false;
    renderAt("/commissions/payments");
    expect(screen.getByText("Your role doesn't include viewing your own commission.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls).toEqual([]);
    expect(h.contextEnabled.every((enabled) => !enabled)).toBe(true);
  });
});
