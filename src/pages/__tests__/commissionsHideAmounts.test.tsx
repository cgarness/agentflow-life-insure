/**
 * Hide amounts across the Commissions Center: every tab (Overview, Payments Scheduled and History, Policies,
 * Calculator), no amount left in text, labels, titles or value text, kept across tab changes and a reload (read before
 * the first render, so no flash), scoped to the user and agency, never revealed by opening the drawer, and errors show
 * no figures.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticContext } from "@/lib/commission/__tests__/syntheticGrid";
import { amountsPreferenceKey } from "@/lib/commission/amountsPreference";
import {
  ORG, USER, breakdown, drawer, goal, historyPage, overview, policiesPage, scheduledPage,
} from "@/components/commissions/__tests__/centerFixtures";

const h = vi.hoisted(() => ({ userId: "", failOverview: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => {
      const data = ({
        get_my_commission_overview: overview(), get_my_commission_breakdown: breakdown(), get_my_commission_goal: goal(50000),
        get_my_commission_installments: scheduledPage(), get_my_commission_receipt_list: historyPage(),
        get_my_commission_policy_list: policiesPage(), get_my_policy_commission: drawer(),
      } as Record<string, unknown>)[name];
      const failed = name === "get_my_commission_overview" && h.failOverview;
      const request = Promise.resolve(data && !failed ? { data, error: null } : { data: null, error: { message: "boom", code: "XX000" } });
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: h.userId }, isImpersonating: false, profile: { id: h.userId, role: "Agent", organization_id: ORG } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canSeeCommission: () => true, isLoading: false }) }));
vi.mock("@/hooks/useCommissionCalculator", () => ({
  CALCULATOR_PERMISSION: "View Own Commission Percentage",
  useCommissionCalculatorAccess: () => ({ permitted: true, permissionsLoading: false, isImpersonating: false }),
  useCommissionCalculatorContext: (enabled: boolean) => ({ data: enabled ? syntheticContext("100") : undefined, isError: false, refetch: vi.fn() }),
}));

import CommissionsPage from "../CommissionsPage";

const OTHER = "00000000-0000-4000-8000-000000000999";
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => { h.userId = USER; h.failOverview = false; window.localStorage.clear(); });
afterEach(cleanup);

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}><Routes><Route path="/commissions/:tab?" element={<CommissionsPage />} /></Routes></MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { ...utils, rerenderSame: () => utils.rerender(tree()) };
}
const MONEY = /\$\s?\d/;
function expectNoAmounts() {
  expect(document.body.textContent).not.toMatch(MONEY);
  for (const el of document.body.querySelectorAll("[aria-label], [title], [aria-valuetext], [placeholder]")) {
    for (const attr of ["aria-label", "title", "aria-valuetext"]) expect(el.getAttribute(attr) ?? "").not.toMatch(MONEY);
  }
}
const tab = (name: string) => fireEvent.click(screen.getByRole("link", { name }));

describe("Hide amounts", () => {
  it("one eye control hides every amount on every tab and stays hidden across tab changes", async () => {
    renderAt("/commissions");
    await screen.findByText("Policies sold");
    expect(document.body.textContent).toMatch(MONEY);
    fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));
    expect(screen.getByRole("button", { name: "Show amounts" })).toBeInTheDocument();
    // The change is announced politely.
    expect(screen.getAllByRole("status").some((el) => el.classList.contains("sr-only") && el.textContent === "Amounts hidden")).toBe(true);
    expect(window.localStorage.getItem(amountsPreferenceKey(USER, ORG))).toBe("1");
    expect(screen.getAllByText("Amounts hidden").length).toBeGreaterThan(0);
    expectNoAmounts();
    tab("Payments");
    await screen.findByRole("table", { name: "Scheduled payments" });
    expectNoAmounts();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await screen.findByRole("table", { name: "Payment history" });
    expectNoAmounts();
    tab("Policies");
    await screen.findByRole("table", { name: "Policies" });
    expectNoAmounts();
    tab("Calculator");
    await screen.findByText(/Your level/);
    expect(screen.getByText("Amounts are hidden")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /product/i })).toBeNull();
    expectNoAmounts();
    tab("Overview");
    await screen.findByText("Policies sold");
    expectNoAmounts();
  });

  it("a reload keeps the choice from the first render (no flash), for this user and agency only", async () => {
    window.localStorage.setItem(amountsPreferenceKey(USER, ORG), "1");
    const view = renderAt("/commissions");
    // Synchronously, before any read resolves:
    expect(screen.getByRole("button", { name: "Show amounts" })).toBeInTheDocument();
    await screen.findByText("Policies sold");
    expectNoAmounts();
    h.userId = OTHER;
    view.rerenderSame();
    expect(await screen.findByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
    await waitFor(() => expect(document.body.textContent).toMatch(MONEY));
    h.userId = USER;
    view.rerenderSame();
    expect(await screen.findByRole("button", { name: "Show amounts" })).toBeInTheDocument();
    await screen.findByText("Policies sold");
    expectNoAmounts();
  });

  it("opening the drawer never reveals amounts; Show amounts there is explicit", async () => {
    window.localStorage.setItem(amountsPreferenceKey(USER, ORG), "1");
    renderAt("/commissions");
    fireEvent.click((await screen.findAllByRole("button", { name: "Record payment" }))[0]);
    await screen.findByText("Estimated commission");
    expect(screen.getByText("Amounts are hidden")).toBeInTheDocument();
    expectNoAmounts();
    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    await waitFor(() => expect(document.body.textContent).toMatch(MONEY));
    expect(window.localStorage.getItem(amountsPreferenceKey(USER, ORG))).toBeNull();
  });

  it("a failed read shows its error and no figure", async () => {
    h.failOverview = true;
    window.localStorage.setItem(amountsPreferenceKey(USER, ORG), "1");
    renderAt("/commissions");
    await screen.findByText("Couldn't load");
    expectNoAmounts();
  });
});
