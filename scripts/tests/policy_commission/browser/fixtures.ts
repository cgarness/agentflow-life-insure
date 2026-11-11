/** Isolated synthetic browser adapter. This module is referenced only by the dedicated Vite test config. */
import { useSyncExternalStore } from "react";
import {
  ID, ORG, USER, TEAM_AGENT, OTHER_AGENT, agentRoster, scopedResponse,
  overview, breakdown, scheduledPage, historyPage, policiesPage, drawer, goal,
} from "../../../../src/components/commissions/__tests__/centerFixtures";
import { syntheticContext } from "../../../../src/lib/commission/__tests__/syntheticGrid";

type Args = Record<string, unknown>;
type Response = { data: unknown; error: { code: string; message: string } | null };
const scenario = new URLSearchParams(location.search).get("scenario") || "team";
const listeners = new Set<() => void>();
const state = { version: 0, own: scenario !== "team-only", impersonating: scenario === "view-as", revoked: false,
  empty: scenario === "empty", onlySelf: scenario === "only-self", failWrite: true };
const requests: Array<{ name: string; args: Args; aborted: boolean }> = [];
const held = new Map<string, Array<() => void>>();
const delayed = new Set<string>();
const notify = () => { state.version++; listeners.forEach((callback) => callback()); };
const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
function useObserve() { useSyncExternalStore(subscribe, () => state.version); }

export const fixture = {
  USER, TEAM_AGENT, OTHER_AGENT,
  requests: () => requests,
  clearRequests: () => { requests.length = 0; },
  setRevoked: (value = true) => { state.revoked = value; notify(); },
  setViewAs: (value: boolean) => { state.impersonating = value; notify(); },
  hold: (scope: string) => delayed.add(scope),
  release: (scope: string) => { delayed.delete(scope); held.get(scope)?.splice(0).forEach((done) => done()); },
  allowRetry: () => { state.failWrite = false; },
};

export function useAuth() {
  useObserve();
  return { user: { id: USER }, isImpersonating: state.impersonating,
    profile: { id: state.impersonating ? OTHER_AGENT : USER, role: "Team Leader", status: "Active", organization_id: ORG,
      updated_at: String(state.version), is_super_admin: false } };
}
export function useOrganization() { useObserve(); return { organizationId: ORG, role: "Team Leader" }; }
export function usePermissions() {
  useObserve();
  return { isLoading: false, canSeeCommission: (permission: string) => permission.includes("Others") ? !state.revoked : state.own };
}
export const CALCULATOR_PERMISSION = "View Own Commission Percentage";
export function useCommissionCalculatorAccess() { useObserve(); return { permitted: state.own, permissionsLoading: false, isImpersonating: state.impersonating }; }
export function useCommissionCalculatorContext(enabled: boolean) {
  useObserve();
  return { data: enabled && state.own ? syntheticContext("100") : undefined, isError: false, refetch: async () => undefined };
}

function roster(args: Args) {
  const allowed = state.empty ? [] : agentRoster().agents.filter((a) => a.is_self ? state.own : !state.onlySelf && !state.revoked);
  const selected = (args.p_agent_ids as string[] | null) || [];
  const search = String(args.p_search ?? "").trim().toLowerCase();
  const matching = allowed.filter((a) => a.display_name.toLowerCase().includes(search));
  return agentRoster({
    agents: matching.slice(Number(args.p_offset || 0), Number(args.p_offset || 0) + Number(args.p_limit || 50)),
    selected_agents: allowed.filter((a) => selected.includes(a.agent_id)), available_count: allowed.length, total_count: matching.length,
    can_view_own: state.own, can_select_others: allowed.some((a) => !a.is_self), default_scope: state.own ? "me" : allowed.length ? "all" : null,
    scope_revision: `synthetic-scope-v${state.version + 1}`,
  });
}
function response(name: string, args: Args): Response {
  const discovery = roster(args);
  const mode = args.p_agent_scope;
  const ids = (args.p_agent_ids as string[] | null) || [];
  const allowed = roster({}).agents.map((a) => a.agent_id);
  if ((mode === "selected" && ids.some((id) => !allowed.includes(id))) || (mode === "me" && !state.own))
    return { data: null, error: { code: "42501", message: "Scope is no longer available" } };
  if (name === "get_commission_agent_scope") return { data: discovery, error: null };
  if (name === "record_policy_commission_receipt") return state.failWrite
    ? { data: null, error: { code: "", message: "TypeError: Failed to fetch" } }
    : { data: { receipt_id: ID(999), status: "recorded", idempotent: true }, error: null };
  const base = ({
    get_scoped_commission_overview: overview(), get_scoped_commission_breakdown: breakdown(),
    get_scoped_commission_installments: scheduledPage(), get_scoped_commission_receipt_list: historyPage(),
    get_scoped_commission_policy_list: policiesPage(), get_scoped_policy_commission: drawer(), get_my_commission_goal: goal(),
  } as Record<string, Record<string, unknown>>)[name];
  if (!base) return { data: null, error: { code: "XX000", message: `Unexpected synthetic RPC: ${name}` } };
  const data = name.startsWith("get_scoped_") ? scopedResponse(base, args, USER, allowed) : base;
  if (name.startsWith("get_scoped_")) data.meta = { ...data.meta as object, agent_scope: { mode, agent_ids: mode === "all" ? allowed : mode === "me" ? [USER] : ids,
    revision: discovery.scope_revision } };
  return { data, error: null };
}
export const supabase = {
  rpc(name: string, args: Args) {
    const request = { name, args, aborted: false };
    requests.push(request);
    const key = String(args.p_agent_scope === "selected" ? (args.p_agent_ids as string[]).join(",") : args.p_agent_scope);
    const result = response(name, args);
    const promise = new Promise<Response>((resolve) => {
      if (delayed.has(key) && name !== "get_commission_agent_scope") held.set(key, [...held.get(key) || [], () => resolve(result)]);
      else resolve(result);
    });
    return Object.assign(promise, { abortSignal: (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { request.aborted = true; }, { once: true }); return promise;
    } });
  },
};
