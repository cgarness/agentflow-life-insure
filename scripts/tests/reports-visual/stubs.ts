// This file is reachable only from the isolated Vite entry, never the production build.
// @ts-expect-error supplied by the fixture's Vite plugin, copied from the SQL result without edits
import payloads from "virtual:reports-sql-payloads";
import { DEFAULT_LAYOUT, type ReportLayoutConfig } from "../../../src/lib/report-layout-constants";
import { PREVIEW_SCENARIOS, scenarioBundle, type PreviewScenario } from "../../../src/lib/__tests__/reportsV3Fixtures";

type LayoutOwner = { userId: string; orgId: string };
const owner = { userId: payloads.fixture.actor, orgId: payloads.fixture.organization };
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

// Only the nine v3 readers have a mapping; a v2 (or any other) request fails the fixture (D6 §4.10).
const panels: Record<string, string> = {
  get_report_scope_v3: "scopeV3", get_report_summary_v3: "summaryV3", get_report_journey_v3: "journeyV3",
  get_report_sales_appointments_v3: "salesAppointmentsV3", get_report_state_breakdown_v3: "statesV3",
  get_report_call_volume_v3: "volumeV3", get_report_disposition_breakdown_v3: "dispositionsV3",
  get_report_campaign_calls_v3: "campaignsV3", get_report_lead_source_calls_v3: "leadSourcesV3",
};
// Labelled synthetic preview scenarios (?scenario=…), derived from the real SQL payloads in reportsV3Fixtures.ts.
const scenario = (new URLSearchParams(globalThis.location?.search ?? "").get("scenario") ?? "complete") as PreviewScenario;
if (!PREVIEW_SCENARIOS.includes(scenario)) throw new Error(`Unknown preview scenario: ${scenario}`);
const scenarioPayloads = (bundle: Record<string, unknown>) => scenarioBundle(bundle, scenario);
const bundles: Record<string, Record<string, any>> = {
  agency: scenarioPayloads(payloads), team: scenarioPayloads(payloads.scopes.team), personal: scenarioPayloads(payloads.scopes.personal),
};
const requests: { panel: string; args: Record<string, unknown>; accepted: boolean }[] = [];
let failedPanel: string | null = null;
let heldPanel: string | null = null;
let releases: (() => void)[] = [];
export const fixture = {
  payloads,
  scenario,
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
      const requestedScope = (args.p_requested_scope ?? "agency") as string;
      const bundle = bundles[requestedScope];
      const response = bundle?.[panel];
      const accepted = !!response && (panel === "scopeV3"
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
      if (scenario === "loading" && panel !== "scopeV3") await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (scenario === "unavailable" && panel === "scopeV3") {
        return { data: null, error: { code: "42501", message: "permission denied for function get_report_scope_v3" } };
      }
      if (!accepted || failedPanel === panel || (scenario === "error" && (panel === "journeyV3" || panel === "salesAppointmentsV3"))) {
        return { data: null, error: { code: "P0001", message: "ISOLATED_FIXTURE_UNAVAILABLE" } };
      }
      return { data: structuredClone(response), error: null };
    },
  }),
};
