import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overview, USER, ORG } from "./centerFixtures";

const h = vi.hoisted(() => ({
  calculatorDenied: "no_access", own: true, viewAs: false, revision: "r1", allIds: [] as string[], calls: [] as Array<[string, Record<string, unknown>]>,
  denyGoal: false, holdSelected: false, holdRoster: false, pending: [] as Array<(value: unknown) => void>, rosterPending: [] as Array<(value: unknown) => void>,
}));
const A = "00000000-0000-4000-8000-000000000002";
const B = "00000000-0000-4000-8000-000000000003";
const agents = () => [{ agent_id: USER, display_name: "Synthetic Me", status: "Active", is_self: true },
  { agent_id: A, display_name: "Synthetic Ann", status: "Active", is_self: false },
  { agent_id: B, display_name: "Synthetic Bob", status: "Inactive", is_self: false }].filter((a) => h.allIds.includes(a.agent_id));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: USER }, profile: { id: USER, role: "Team Leader", status: "Active", organization_id: ORG }, isImpersonating: h.viewAs }) }));
vi.mock("@/hooks/useEffectiveViewer", () => ({ useEffectiveViewer: () => ({ viewer: { viewerId: USER, organizationId: ORG, isImpersonating: h.viewAs } }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: false, canSeeCommission: (name: string) => name.includes("Own") ? h.own : true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (name: string, args: Record<string, unknown> = {}) => {
  h.calls.push([name, args]);
  const ids = args.p_agent_scope === "selected" ? args.p_agent_ids as string[] : args.p_agent_scope === "me" ? [USER] : h.allIds;
  const members = agents();
  const roster = { agents: members.filter((a) => a.display_name.toLowerCase().includes(String(args.p_search ?? "").toLowerCase())),
    selected_agents: args.p_agent_scope ? members.filter((a) => ids.includes(a.agent_id)) : [], available_count: members.length,
    total_count: members.length, can_view_own: h.own, can_select_others: true, default_scope: h.own ? "me" : members.length ? "all" : null,
    scope_revision: h.revision };
  const data = name === "get_commission_agent_scope" ? roster : { ...overview(),
    meta: { ...overview().meta, agent_scope: { mode: args.p_agent_scope, agent_ids: ids, revision: h.revision } }, upcoming: { rows: [], total_count: 0 } };
  const held = name === "get_commission_agent_scope" ? h.holdRoster : h.holdSelected && args.p_agent_scope === "selected";
  const request = name === "get_commission_calculator_context" ? Promise.resolve(h.calculatorDenied === "forbidden"
    ? { data: null, error: { code: "42501" } } : { data: { status: "no_access" }, error: null }) : h.denyGoal && name.includes("commission_goal") ? Promise.resolve({ data: null, error: { code: "42501" } }) : held ? new Promise((resolve) => (name === "get_commission_agent_scope" ? h.rosterPending : h.pending).push(resolve))
    : Promise.resolve({ data, error: null });
  return Object.assign(request, { abortSignal: () => request });
} } }));
import CalculatorTab from "../CalculatorTab";
import { CommissionScopeProvider } from "../CommissionScopeProvider";
import { CommissionScopeBoundary } from "../CommissionScopeBoundary";
import { useCommissionScope } from "../commissionScopeContext";
import { useCommissionGoal, useCommissionGoalMutation, useCommissionOverview } from "@/hooks/useCommissionsCenter";

let client: QueryClient;
function Financial() {
  const scope = useCommissionScope();
  const [loadGoal, setLoadGoal] = useState(false);
  useCommissionGoal(loadGoal ? "2026-10-01" : null);
  const writeGoal = useCommissionGoalMutation("2026-10-01");
  const query = useCommissionOverview({ preset: "this_month", from: null, to: null });
  return <><output data-testid="financial">{query.data ? `${scope.scope?.mode}:${scope.revision}` : "loading"}</output>
    <button onClick={() => void query.refetch()}>Refresh figures</button>
    <button onClick={() => setLoadGoal(true)}>Read goal</button>
    <button onClick={() => writeGoal.mutate(100)}>Write goal</button></>;
}
function Navigation() {
  const [params, setParams] = useSearchParams(); const navigate = useNavigate();
  return <><output data-testid="url">{params.toString()}</output>
    <button onClick={() => setParams(`agents=selected&agent_ids=${A}`)}>Go Ann</button>
    <button onClick={() => setParams(`agents=selected&agent_ids=${B}`)}>Go Bob</button>
    <button onClick={() => setParams("agents=all")}>Go All</button><button onClick={() => navigate(-1)}>Go back</button></>;
}
function PersonalCalculator() {
  const [opened, setOpened] = useState(false);
  const scope = useCommissionScope();
  return <><button onClick={() => setOpened(true)}>Open calculator</button>
    {opened && scope.canViewOwn ? <CalculatorTab /> : null}</>;
}
function mount(search = "") {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/commissions${search}`]}>
    <CommissionScopeProvider><Navigation /><PersonalCalculator /><CommissionScopeBoundary><Financial /></CommissionScopeBoundary></CommissionScopeProvider>
  </MemoryRouter></QueryClientProvider>);
}
const financialCalls = () => h.calls.filter(([name]) => name !== "get_commission_agent_scope");
async function open() { fireEvent.click(await screen.findByRole("button", { name: /^Agents:/ })); await screen.findByRole("textbox", { name: "Search agents" }); await screen.findAllByRole("checkbox"); }
beforeEach(() => {
  h.calculatorDenied = "no_access"; h.own = true; h.viewAs = false; h.revision = "r1"; h.allIds = [USER, A, B]; h.calls = []; h.holdSelected = false;
  h.denyGoal = false; h.holdRoster = false; h.pending = []; h.rosterPending = []; client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

describe("commission scope admission and selector", () => {
  it("keeps checkbox/search drafts out of financial reads, Cancel and Escape preserve URL", async () => {
    mount(); await screen.findByText("me:r1"); const before = financialCalls().length;
    await open(); fireEvent.click(await screen.findByRole("checkbox", { name: /^Synthetic Ann,/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search agents" }), { target: { value: "Bob" } });
    expect(financialCalls()).toHaveLength(before); expect(screen.getByTestId("url")).toHaveTextContent("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); await open();
    expect(screen.getByRole("checkbox", { name: /^Synthetic Ann,/ })).not.toBeChecked();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search agents" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument());
    expect(financialCalls()).toHaveLength(before);
  });
  it("bounds a search draft without clearing the committed financial selection", async () => {
    mount(); await screen.findByText("me:r1"); await open(); const before = financialCalls().length;
    fireEvent.change(screen.getByRole("textbox", { name: "Search agents" }), { target: { value: "x".repeat(250) } });
    await waitFor(() => expect(h.calls.at(-1)![1].p_search).toBe("x".repeat(200)));
    expect(financialCalls()).toHaveLength(before); expect(screen.getByTestId("financial")).toHaveTextContent("me:r1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(screen.getByTestId("financial")).toHaveTextContent("me:r1");
  });
  it("seeds the visible self checkbox from the actor and commits multiple exact IDs once", async () => {
    mount(); await screen.findByText("me:r1"); await open();
    expect(screen.getByRole("checkbox", { name: /^Synthetic Me/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Synthetic Ann,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" })); await screen.findByText("selected:r1");
    const last = financialCalls().at(-1)![1]; expect(last.p_agent_ids).toEqual([USER, A].sort());
    expect(financialCalls()).toHaveLength(2);
  });
  it("All has no misleading checked individuals; exact self Apply returns to Me", async () => {
    mount("?agents=all"); await screen.findByText("all:r1"); await open();
    expect(screen.getAllByRole("checkbox").every((c) => c.getAttribute("data-state") === "unchecked")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /^Synthetic Me/ })); fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("me:r1"); expect(screen.getByTestId("url")).toHaveTextContent("agents=me");
  });
  it("team-only defaults All; no agents and invalid URLs issue no financial reads", async () => {
    h.own = false; h.allIds = [A, B]; const first = mount(); await screen.findByText("all:r1"); await open();
    expect(screen.queryByRole("button", { name: /^Me$/ })).not.toBeInTheDocument(); first.unmount();
    client.clear(); h.calls = []; h.allIds = []; const empty = mount(); await screen.findByText("No agents available");
    expect(financialCalls()).toEqual([]); empty.unmount(); client.clear(); h.calls = [];
    mount("?agents=all&agent_ids=bad"); await screen.findByText("Agent selection unavailable"); expect(h.calls).toEqual([]);
  });
  it("View As sends zero roster and financial requests", async () => {
    h.viewAs = true; mount(); await act(async () => { await Promise.resolve(); }); expect(h.calls).toEqual([]);
  });
  it.each(["denied", "old revision"])("late %s old scope responses cannot clear the successful current All selection", async (kind) => {
    mount(); await screen.findByText("me:r1"); h.holdSelected = true;
    fireEvent.click(screen.getByText("Go Ann")); await waitFor(() => expect(h.pending).toHaveLength(1));
    fireEvent.click(screen.getByText("Go Bob")); await waitFor(() => expect(h.pending).toHaveLength(2));
    fireEvent.click(screen.getByText("Go All")); await screen.findByText("all:r1");
    await act(async () => { h.pending.splice(0).forEach((resolve) => resolve(kind === "denied" ? { data: null, error: { code: "42501" } } : {
      data: { ...overview(), meta: { ...overview().meta, agent_scope: { mode: "selected", agent_ids: [A], revision: "r0" } }, upcoming: { rows: [], total_count: 0 } }, error: null })); });
    expect(screen.getByTestId("financial")).toHaveTextContent("all:r1"); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("denial closes the subtree and deletes previously cached names and figures", async () => {
    mount(); await screen.findByText("me:r1"); h.holdSelected = true;
    fireEvent.click(screen.getByText("Go Ann")); await waitFor(() => expect(h.pending).toHaveLength(1));
    await act(async () => { h.pending.shift()!({ data: null, error: { code: "42501" } }); });
    await screen.findByText("Agent selection unavailable"); expect(screen.queryByTestId("financial")).not.toBeInTheDocument();
    expect(client.getQueryCache().findAll().some((q) => q.state.data !== undefined)).toBe(false);
  });
  it("a changed discovery revision purges old rows and picker pages before redisplay", async () => {
    mount(); await screen.findByText("me:r1"); await open(); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    h.revision = "r2"; h.allIds = [USER];
    await act(async () => { await client.invalidateQueries({ queryKey: ["policy-commissions", "center", USER, ORG, "agent-roster"] }); });
    await screen.findByText("me:r2");
    expect(client.getQueryCache().findAll().some((q) => JSON.stringify(q.state.data ?? null).includes('"revision":"r1"'))).toBe(false);
    expect(client.getQueryCache().findAll().filter((q) => q.queryKey[4] === "agent-roster")
      .every((q) => q.state.data === undefined || (q.state.data as { scope_revision: string }).scope_revision === "r2")).toBe(true);
  });
  it("revalidates a cached browser-back selection before mounting financial children", async () => {
    mount(); await screen.findByText("me:r1"); fireEvent.click(screen.getByText("Go All")); await screen.findByText("all:r1");
    h.holdRoster = true; fireEvent.click(screen.getByText("Go back")); await screen.findByText("Loading agents…");
    expect(screen.queryByTestId("financial")).not.toBeInTheDocument();
  });
  it.each(["Read goal", "Write goal"])("%s authority loss clears cached financial data", async (button) => {
    mount(); await screen.findByText("me:r1"); h.denyGoal = true; fireEvent.click(screen.getByText(button));
    await screen.findByText("Agent selection unavailable"); expect(screen.queryByTestId("financial")).not.toBeInTheDocument();
  });
  it.each([false, true])("Calculator no_access clears financial data (already cached: %s)", async (cached) => {
    const key = ["commission-calculator", "context", USER, ORG];
    if (cached) client.setQueryData(key, { status: "no_access" });
    mount();
    if (!cached) { await screen.findByText("me:r1"); act(() => { client.setQueryData(key, { status: "no_access" }); }); }
    await screen.findByText("Agent selection unavailable"); expect(screen.queryByTestId("financial")).not.toBeInTheDocument();
  });
  it.each(["no_access", "forbidden"])("unmounts an actual Calculator observer after %s without refetch loops", async (kind) => {
    h.calculatorDenied = kind; mount(); await screen.findByText("me:r1");
    fireEvent.click(screen.getByText("Open calculator")); await screen.findByText("Agent selection unavailable");
    expect(screen.queryByTestId("financial")).not.toBeInTheDocument();
    await act(async () => { await client.invalidateQueries(); });
    expect(h.calls.filter(([name]) => name === "get_commission_calculator_context")).toHaveLength(1);
    expect(client.getQueryCache().findAll().filter((q) => q.queryKey[0] === "commission-calculator").some((q) => q.isActive())).toBe(false);
  });
  it("keeps a way back to Me when All contains only self", async () => {
    h.allIds = [USER]; mount("?agents=all"); await screen.findByText("all:r1"); await open();
    fireEvent.click(screen.getByRole("button", { name: /^Me$/ })); fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("me:r1");
  });
});
