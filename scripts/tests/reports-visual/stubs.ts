// This file is reachable only from the isolated Vite entry, never the production build.
// @ts-expect-error supplied by the fixture's Vite plugin, copied from the SQL result without edits
import payloads from "virtual:reports-sql-payloads";
import { DEFAULT_LAYOUT } from "../../../src/lib/report-layout-constants";

export const useAuth = () => ({
  profile: { id: payloads.scope.self_id, organization_id: "f5000000-0000-0000-0000-000000000001", role: "Admin" },
  isImpersonating: false,
});
export const getDefaultLayout = () => structuredClone(DEFAULT_LAYOUT);
export const fetchUserLayout = async () => getDefaultLayout();
export const resetUserLayout = async () => {};
export const saveOrgDefaultLayout = async () => {};
export const saveUserLayout = async () => {};

const panels: Record<string, string> = {
  get_report_scope_v2: "scope", get_report_call_summary_v2: "summary", get_report_call_volume_v2: "volume",
  get_report_disposition_breakdown_v2: "dispositions", get_report_campaign_performance_v2: "campaigns",
  get_report_lead_source_performance_v2: "leadSources",
};
const requests: { panel: string; args: Record<string, unknown>; accepted: boolean }[] = [];
let failedPanel: string | null = null;
export const fixture = {
  payloads,
  requests: () => structuredClone(requests),
  fail: (panel: string | null) => { failedPanel = panel; },
};
export const supabase = {
  from: () => { throw new Error("The isolated Reports fixture does not permit table access."); },
  rpc: (fn: string, args: Record<string, unknown>) => ({
    abortSignal: async (signal: AbortSignal) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const panel = panels[fn];
      if (!panel) throw new Error(`Unexpected fixture RPC: ${fn}`);
      const response = payloads[panel];
      const accepted = panel === "scope"
        ? args.p_requested_scope === null || args.p_requested_scope === response.requested_scope
        : args.p_start_date === response.window.start_date && args.p_end_date === response.window.end_date
          && args.p_agent_id === response.filter_agent_id && args.p_requested_scope === response.requested_scope;
      requests.push({ panel, args: structuredClone(args), accepted });
      if (!accepted || failedPanel === panel) {
        return { data: null, error: { code: "P0001", message: "ISOLATED_FIXTURE_UNAVAILABLE" } };
      }
      return { data: structuredClone(response), error: null };
    },
  }),
};
