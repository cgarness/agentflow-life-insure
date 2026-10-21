/**
 * Monthly goal under Received: one whole calendar month only, no goal until set (opening creates nothing), set / edit /
 * clear one month through the owner-only functions, validated whole cents, overachievement past 100 % with the bar
 * capped, hidden amounts (no figures, no bar, no editing) and a draft that survives hiding and showing.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG, USER, goal, overview } from "./centerFixtures";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, target: null as number | null, failSet: false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      let response: { data: unknown; error: unknown };
      if (name === "set_my_commission_goal" && h.failSet) response = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
      else if (name === "set_my_commission_goal") {
        h.target = Number(args.p_target_cents);
        response = { data: { month: args.p_month, target_cents: h.target, updated_at: "2026-10-20T17:00:00Z" }, error: null };
      } else if (name === "clear_my_commission_goal") {
        h.target = null;
        response = { data: { month: args.p_month, cleared: true }, error: null };
      } else response = { data: goal(h.target, String(args.p_month)), error: null };
      const request = Promise.resolve(response);
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isImpersonating: false, profile: { id: USER, role: "Agent", organization_id: ORG } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canSeeCommission: () => true, isLoading: false }) }));

import { AmountsToggle, AmountsVisibilityProvider } from "@/components/commission/ui/AmountsVisibility";
import { overviewSchema } from "@/lib/commission/centerSchemas";
import { SummaryCards } from "../overview/SummaryCards";

const MONTH = { preset: "this_month", from: null, to: null } as const;
const calls = (fn: string) => h.calls.filter(([n]) => n === fn).map(([, a]) => a);
function show(meta: Partial<{ from: string; to: string }> = {}, received = 25157) {
  const base = overview();
  const data = overviewSchema.parse({ ...base, meta: { ...base.meta, ...meta }, summary: { ...base.summary, received_cents: received } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><MemoryRouter>
      <AmountsVisibilityProvider userId={USER} organizationId={ORG}><AmountsToggle /><SummaryCards data={data} period={MONTH} /></AmountsVisibilityProvider>
    </MemoryRouter></QueryClientProvider>,
  );
}
beforeEach(() => { h.calls = []; h.target = null; h.failSet = false; window.localStorage.clear(); });
afterEach(cleanup);

describe("Monthly goal", () => {
  it("only for one whole calendar month; reading creates nothing", async () => {
    show({ from: "2026-10-01", to: "2026-11-30" });
    await waitFor(() => expect(screen.getByText("$251.57")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Set goal" })).toBeNull();
    expect(calls("get_my_commission_goal")).toHaveLength(0);
    cleanup();
    show();
    await screen.findByRole("button", { name: "Set goal" });
    expect(calls("get_my_commission_goal")).toEqual([{ p_month: "2026-10-01" }]);
    expect(calls("set_my_commission_goal")).toHaveLength(0);
  });

  it("set, edit and clear exactly this month, in whole cents", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Set goal" }));
    fireEvent.change(screen.getByLabelText("Oct 2026 goal (received)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a goal above $0.00 (up to $1,000,000.00).");
    expect(calls("set_my_commission_goal")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Oct 2026 goal (received)"), { target: { value: "$1,250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("of $1,250.00 goal");
    expect(calls("set_my_commission_goal")).toEqual([{ p_month: "2026-10-01", p_target_cents: 125000 }]);
    expect(screen.getByText("20%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    expect((screen.getByLabelText("Oct 2026 goal (received)") as HTMLInputElement).value).toBe("1250.00");
    fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
    await screen.findByRole("button", { name: "Set goal" });
    expect(calls("clear_my_commission_goal")).toEqual([{ p_month: "2026-10-01" }]);
  });

  it("overachievement: the figure passes 100 %, the bar stops at 100 %", async () => {
    h.target = 50000;
    show({}, 75000);
    await screen.findByText("150%");
    const bar = screen.getByRole("progressbar", { name: "Oct 2026 goal progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.getAttribute("aria-valuetext")).toBe("150%");
  });

  it("a failed save keeps the typed amount and says so", async () => {
    h.failSet = true;
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Set goal" }));
    fireEvent.change(screen.getByLabelText("Oct 2026 goal (received)"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save the goal. Try again.");
    expect((screen.getByLabelText("Oct 2026 goal (received)") as HTMLInputElement).value).toBe("900");
  });

  it("hidden amounts: no target, bar or editing; a draft survives hiding and showing", async () => {
    h.target = 50000;
    show();
    await screen.findByText("of $500.00 goal");
    fireEvent.click(screen.getByRole("button", { name: "Edit goal" }));
    fireEvent.change(screen.getByLabelText("Oct 2026 goal (received)"), { target: { value: "777" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));
    expect(screen.getByText("Oct 2026 goal ••••")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Oct 2026 goal (received)" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$\s?\d/);
    fireEvent.click(screen.getByRole("button", { name: "Show amounts" }));
    expect((screen.getByLabelText("Oct 2026 goal (received)") as HTMLInputElement).value).toBe("777");
    expect(calls("set_my_commission_goal")).toHaveLength(0);
  });
});
