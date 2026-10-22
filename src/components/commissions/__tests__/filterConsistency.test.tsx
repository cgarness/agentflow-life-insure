/**
 * Filter/result consistency (plan §12): a list shows earlier rows only while paging within the same effective filters,
 * marked as updating with their actions disabled; a changed filter shows the loading state until its own rows arrive,
 * whatever order responses come back in, and a failed request never shows another filter's rows. Scheduled's
 * "Next 90 days" and "Any date" never depend on a hidden, unfinished custom range.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG, USER, historyPage, historyRow, policiesPage, policyRow, scheduledPage, scheduledRow } from "./centerFixtures";

type Reply = { data: unknown; error: unknown };
const h = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: Record<string, unknown>; reply: (r: Reply) => void }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      let reply!: (r: Reply) => void;
      const request = new Promise<Reply>((resolve) => { reply = resolve; });
      h.calls.push({ name, args, reply });
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

let nav: ReturnType<typeof useNavigate>;
function Probe() {
  nav = useNavigate();
  return <output data-testid="where">{useLocation().search}</output>;
}
const renderAt = (url: string, node: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>{node}<Probe /></MemoryRouter>
  </QueryClientProvider>,
);
const calls = (name: string) => h.calls.filter((c) => c.name === name);
const last = (name: string) => calls(name).at(-1)!;
const ok = (data: unknown) => ({ data, error: null });
const answer = async (call: { reply: (r: Reply) => void }, r: Reply) => { await act(async () => { call.reply(r); }); };
const scheduled = (n: number) => scheduledPage([scheduledRow(n)]);
const onOpen = vi.fn();

beforeEach(() => { h.calls = []; onOpen.mockReset(); });
afterEach(cleanup);

describe("Scheduled: results always match the filters on screen", () => {
  it("a changed filter shows loading, never the previous filter's rows, until its own rows arrive", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    await answer(last("get_my_commission_installments"), ok(scheduled(1)));
    expect(await screen.findByText("Client 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "check_payment" } });
    await waitFor(() => expect(last("get_my_commission_installments").args).toMatchObject({ p_status: "check_payment" }));
    expect(screen.queryByText("Client 1")).toBeNull();
    expect(screen.queryByText("60 payments")).toBeNull();
    expect(screen.getByText("Loading payments…")).toBeInTheDocument();
    await answer(last("get_my_commission_installments"), ok(scheduled(2)));
    expect(await screen.findByText("Client 2")).toBeInTheDocument();
  });

  it("rapid changes with out-of-order responses: only the latest filter's rows are ever shown", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    await answer(calls("get_my_commission_installments")[0], ok(scheduled(1)));
    await screen.findByText("Client 1");
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "Harbor Mutual" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "remaining" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "advance" } });
    await waitFor(() => expect(last("get_my_commission_installments").args).toMatchObject(
      { p_status: "remaining", p_kind: "advance", p_carrier: "Harbor Mutual" }));
    expect(screen.queryByText("Client 1")).toBeNull();
    const [, b, c, d] = calls("get_my_commission_installments");
    await answer(d, ok(scheduled(4)));
    expect(await screen.findByText("Client 4")).toBeInTheDocument();
    await answer(b, ok(scheduled(2)));
    await answer(c, ok(scheduled(3)));
    expect(screen.queryByText("Client 2")).toBeNull();
    expect(screen.queryByText("Client 3")).toBeNull();
    expect(screen.getByText("Client 4")).toBeInTheDocument();
  });

  it("a failed request for a new filter shows the error, not the previous filter's rows", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    await answer(last("get_my_commission_installments"), ok(scheduled(1)));
    await screen.findByText("Client 1");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "later" } });
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(2));
    await answer(last("get_my_commission_installments"), { data: null, error: { code: "XX000", message: "boom" } });
    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByText("Client 1")).toBeNull();
  });

  it("paging keeps the shown page marked as updating, with its actions disabled, until the new page arrives", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    await answer(last("get_my_commission_installments"), ok(scheduled(1)));
    await screen.findByText("Client 1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(last("get_my_commission_installments").args).toMatchObject({ p_offset: 25 }));
    const table = screen.getByRole("table", { name: "Scheduled payments" });
    expect(table.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Updating…")).toBeInTheDocument();
    for (const button of within(table).getAllByRole("button")) expect(button).toBeDisabled();
    fireEvent.click(within(table).getByRole("button", { name: "Record payment" }));
    expect(onOpen).not.toHaveBeenCalled();
    await answer(last("get_my_commission_installments"), ok(scheduled(26)));
    expect(await screen.findByText("Client 26")).toBeInTheDocument();
    expect(screen.queryByText("Updating…")).toBeNull();
    expect(screen.getByRole("table", { name: "Scheduled payments" }).getAttribute("aria-busy")).toBe("false");
    fireEvent.click(within(screen.getByRole("table", { name: "Scheduled payments" })).getByRole("button", { name: "Record payment" }));
    expect(onOpen).toHaveBeenCalledWith(scheduledRow(26).policy_id, { payment: scheduledRow(26).installment_id });
  });

  it("a failed page shows the error, not the previous page as its result", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    await answer(last("get_my_commission_installments"), ok(scheduled(1)));
    await screen.findByText("Client 1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(2));
    await answer(last("get_my_commission_installments"), { data: null, error: { code: "XX000", message: "boom" } });
    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByText("Client 1")).toBeNull();
  });

  it("back and forward show each filter's own rows", async () => {
    renderAt("/commissions/payments", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    await answer(last("get_my_commission_installments"), ok(scheduled(1)));
    await screen.findByText("Client 1");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "received" } });
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(2));
    await answer(last("get_my_commission_installments"), ok(scheduled(2)));
    await screen.findByText("Client 2");
    act(() => nav(-1));
    expect(screen.getByTestId("where").textContent).toBe("");
    expect(await screen.findByText("Client 1")).toBeInTheDocument();
    expect(screen.queryByText("Client 2")).toBeNull();
    act(() => nav(1));
    expect(await screen.findByText("Client 2")).toBeInTheDocument();
    expect(screen.queryByText("Client 1")).toBeNull();
  });
});

describe("Scheduled: Next 90 days and Any date never depend on a hidden custom range", () => {
  it.each(["dates=next_90&period=custom", "dates=any&period=custom", "dates=any&period=custom&from=2026-10-05"])(
    "direct URL ?%s requests the list without custom dates", async (search) => {
      renderAt(`/commissions/payments?${search}`, <PaymentsTab onOpen={onOpen} />);
      await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
      expect(last("get_my_commission_installments").args).toMatchObject({
        p_scope: search.startsWith("dates=next_90") ? "next_90" : "any", p_period: "this_month", p_from: null, p_to: null,
      });
      await answer(last("get_my_commission_installments"), ok(scheduled(7)));
      expect(await screen.findByText("Client 7")).toBeInTheDocument();
    });

  it("switching away from an unfinished custom range loads; switching back waits for a complete range", async () => {
    renderAt("/commissions/payments?period=custom&from=2026-10-05", <PaymentsTab onOpen={onOpen} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("get_my_commission_installments")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Dates"), { target: { value: "next_90" } });
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(1));
    expect(last("get_my_commission_installments").args).toMatchObject({ p_scope: "next_90", p_period: "this_month", p_from: null, p_to: null });
    await answer(last("get_my_commission_installments"), ok(scheduled(8)));
    expect(await screen.findByText("Client 8")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dates"), { target: { value: "any" } });
    await waitFor(() => expect(calls("get_my_commission_installments")).toHaveLength(2));
    expect(last("get_my_commission_installments").args).toMatchObject({ p_scope: "any", p_from: null, p_to: null });
    fireEvent.change(screen.getByLabelText("Dates"), { target: { value: "period" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("get_my_commission_installments")).toHaveLength(2);
    expect(screen.queryByText("Client 8")).toBeNull();
  });
});

describe("History and Policies follow the same contract", () => {
  it("History: a new period shows loading, not the previous period's receipts; paging marks the shown page", async () => {
    renderAt("/commissions/payments?view=history", <PaymentsTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_receipt_list")).toHaveLength(1));
    await answer(last("get_my_commission_receipt_list"), ok(historyPage([historyRow(1)], { total_count: 40 })));
    await screen.findByText("Client 1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls("get_my_commission_receipt_list")).toHaveLength(2));
    expect(screen.getByRole("table", { name: "Payment history" }).getAttribute("aria-busy")).toBe("true");
    for (const button of within(screen.getByRole("table", { name: "Payment history" })).getAllByRole("button")) expect(button).toBeDisabled();
    await answer(last("get_my_commission_receipt_list"), ok(historyPage([historyRow(2)], { total_count: 40 })));
    await screen.findByText("Client 2");
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "last_month" } });
    await waitFor(() => expect(last("get_my_commission_receipt_list").args).toMatchObject({ p_period: "last_month", p_offset: 0 }));
    expect(screen.queryByText("Client 2")).toBeNull();
    expect(screen.getByText("Loading payments…")).toBeInTheDocument();
  });

  it("Policies: a new filter shows loading, not the previous filter's policies; a failure shows the error", async () => {
    renderAt("/commissions/policies", <PoliciesTab onOpen={onOpen} />);
    await waitFor(() => expect(calls("get_my_commission_policy_list")).toHaveLength(1));
    await answer(last("get_my_commission_policy_list"), ok(policiesPage([policyRow(1)])));
    await screen.findByText("Client 1");
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "missing" } });
    await waitFor(() => expect(calls("get_my_commission_policy_list")).toHaveLength(2));
    expect(screen.queryByText("Client 1")).toBeNull();
    await answer(last("get_my_commission_policy_list"), { data: null, error: { code: "XX000", message: "boom" } });
    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByText("Client 1")).toBeNull();
  });
});
