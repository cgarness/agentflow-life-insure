// This file is reachable only from the isolated Vite entry, never the production build.
// @ts-expect-error supplied by the fixture's Vite plugin, copied from the SQL result without edits
import payloads from "virtual:reports-sql-payloads";
import { DEFAULT_LAYOUT, type ReportLayoutConfig } from "../../../src/lib/report-layout-constants";

type LayoutOwner = { userId: string; orgId: string };
const owner = { userId: payloads.scope.self_id, orgId: "f5000000-0000-0000-0000-000000000001" };
export const useAuth = () => ({
  profile: { id: owner.userId, organization_id: owner.orgId, role: "Admin" },
  isImpersonating: false,
});
export const getDefaultLayout = (): ReportLayoutConfig => structuredClone(DEFAULT_LAYOUT);
const layoutKey = `isolated-reports-layout:${owner.orgId}:${owner.userId}`;
let failLayoutSave = false;
const layoutOperations: string[] = [];
function checkOwner(requested: LayoutOwner) {
  if (requested.userId !== owner.userId || requested.orgId !== owner.orgId) throw new Error("Unexpected isolated layout owner");
}
export const fetchUserLayout = async (requested: LayoutOwner): Promise<ReportLayoutConfig> => {
  checkOwner(requested);
  layoutOperations.push("load");
  const saved = localStorage.getItem(layoutKey);
  return saved ? JSON.parse(saved) : getDefaultLayout();
};
export const saveUserLayout = async (requested: LayoutOwner, layout: ReportLayoutConfig): Promise<ReportLayoutConfig> => {
  checkOwner(requested);
  layoutOperations.push("save");
  if (failLayoutSave) throw new Error("The isolated layout save failed. Your saved layout has not changed.");
  localStorage.setItem(layoutKey, JSON.stringify(layout));
  return structuredClone(layout);
};
export const resetUserLayout = async (requested: LayoutOwner): Promise<ReportLayoutConfig> => {
  checkOwner(requested);
  layoutOperations.push("reset");
  if (failLayoutSave) throw new Error("The isolated layout reset failed. Your saved layout has not changed.");
  localStorage.removeItem(layoutKey);
  return getDefaultLayout();
};

const panels: Record<string, string> = {
  get_report_scope_v2: "scope", get_report_call_summary_v2: "summary", get_report_call_volume_v2: "volume",
  get_report_disposition_breakdown_v2: "dispositions", get_report_campaign_performance_v2: "campaigns",
  get_report_lead_source_performance_v2: "leadSources",
};
const requests: { panel: string; args: Record<string, unknown>; accepted: boolean }[] = [];
let failedPanel: string | null = null;
let heldPanel: string | null = null;
let releases: (() => void)[] = [];
export const fixture = {
  payloads,
  requests: () => structuredClone(requests),
  fail: (panel: string | null) => { failedPanel = panel; },
  hold: (panel: string | null) => { heldPanel = panel; },
  release: () => { heldPanel = null; releases.splice(0).forEach(resolve => resolve()); },
  failLayoutSave: (fail: boolean) => { failLayoutSave = fail; },
  layoutOperations: () => [...layoutOperations],
  savedLayout: () => {
    const saved = localStorage.getItem(layoutKey);
    return saved ? JSON.parse(saved) : null;
  },
};
export const supabase = {
  from: () => { throw new Error("The isolated Reports fixture does not permit table access."); },
  rpc: (fn: string, args: Record<string, unknown>) => ({
    abortSignal: async (signal: AbortSignal) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const panel = panels[fn];
      if (!panel) throw new Error(`Unexpected fixture RPC: ${fn}`);
      const requestedScope = args.p_requested_scope ?? "agency";
      const bundle = requestedScope === "agency" ? payloads : payloads.scopes[requestedScope as string];
      const response = bundle?.[panel];
      const accepted = !!response && (panel === "scope"
        ? args.p_requested_scope === null || args.p_requested_scope === response.requested_scope
        : args.p_start_date === response.window.start_date && args.p_end_date === response.window.end_date
          && args.p_agent_id === response.filter_agent_id && args.p_requested_scope === response.requested_scope);
      requests.push({ panel, args: structuredClone(args), accepted });
      if (heldPanel === panel) {
        await new Promise<void>(resolve => {
          releases.push(resolve);
          signal.addEventListener("abort", () => {
            releases = releases.filter(release => release !== resolve);
            resolve();
          }, { once: true });
        });
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!accepted || failedPanel === panel) {
        return { data: null, error: { code: "P0001", message: "ISOLATED_FIXTURE_UNAVAILABLE" } };
      }
      return { data: structuredClone(response), error: null };
    },
  }),
};
