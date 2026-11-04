// Reports v3 page state (D6 §4.8). Results are stored with the exact identity they were requested for (viewer,
// organization, requested scope, refresh, resolved scope and zone, window, agent) and are shown only while that
// identity is current, so a late response or a previous viewer's data can never reach the screen, not even for one
// render. Every panel response is checked against its request and the resolved scope; a mismatch is drift, not data.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isReportsQueryError, type ReportRequest, type ReportsErrorKind } from "@/lib/reports-queries";
import type { ReportRequestedScope } from "@/lib/reports-schemas";
import { fetchReportScopeV3 } from "@/lib/reports-v3-queries";
import type { ReportScopeV3 } from "@/lib/reports-v3-schemas";
import { ALL_LOADING, FETCHERS, PANEL_KEYS, type PanelKey, type PanelState, type Panels } from "@/lib/reports-panels";
import { presetRange, validateRange, type CalendarRange, type ReportPreset } from "@/lib/reports-format";

type ScopeState = { status: "loading" } | { status: "ready"; data: ReportScopeV3 } | { status: "error"; kind: ReportsErrorKind };
const LOADING: ScopeState = { status: "loading" };
const kindOf = (e: unknown): ReportsErrorKind => (isReportsQueryError(e) ? e.kind : "unavailable");

interface PanelMeta {
  scope: string; requested_scope: string; filter_agent_id: string | null;
  window: { time_zone: string; start_date: string; end_date: string };
}
/** The response belongs to this request and this resolved scope (existing contract fields only). */
function matches(data: PanelMeta, req: ReportRequest, scope: ReportScopeV3): boolean {
  return data.requested_scope === req.requestedScope && data.filter_agent_id === req.agentId && data.scope === scope.scope
    && data.window.time_zone === scope.time_zone && data.window.start_date === req.startDate && data.window.end_date === req.endDate;
}

export function useReportsPage(viewerKey: string | null) {
  const viewerId = viewerKey?.split("|")[0] ?? null;
  const [requested, setRequested] = useState<{ key: string | null; value: ReportRequestedScope | null }>({ key: null, value: null });
  const requestedScope = requested.key === viewerKey ? requested.value : null;
  const [refreshGen, setRefreshGen] = useState(0);
  const scopeKey = viewerKey ? `${viewerKey}|${requestedScope ?? "default"}|${refreshGen}` : null;
  const [scopeStore, setScopeStore] = useState<{ key: string | null; state: ScopeState }>({ key: null, state: LOADING });
  const scope = scopeKey && scopeStore.key === scopeKey ? scopeStore.state : LOADING;

  useEffect(() => {
    if (!scopeKey) return;
    const controller = new AbortController();
    fetchReportScopeV3(controller.signal, requestedScope)
      .then(data => {
        if (controller.signal.aborted) return;
        // A scope for another person, or an answer to a different explicit scope request (a broader one), is never
        // this viewer's scope.
        const own = data.self_id === viewerId && (!requestedScope || data.requested_scope === requestedScope);
        setScopeStore({ key: scopeKey, state: own ? { status: "ready", data } : { status: "error", kind: "unavailable" } });
      })
      .catch(e => { if (!controller.signal.aborted) setScopeStore({ key: scopeKey, state: { status: "error", kind: kindOf(e) } }); });
    return () => controller.abort();
  }, [scopeKey, requestedScope, viewerId]);

  const scopeData = scope.status === "ready" ? scope.data : null;
  const [preset, setPreset] = useState<ReportPreset>("30d");
  const [custom, setCustom] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [agentSel, setAgentSel] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
  const range: CalendarRange | null = useMemo(() => {
    if (!scopeData) return null;
    if (preset !== "custom") return presetRange(preset, scopeData.today);
    return custom.start && custom.end ? { startDate: custom.start, endDate: custom.end } : null;
  }, [scopeData, preset, custom]);
  const rangeProblem = range && scopeData ? validateRange(range, scopeData.max_range_days) : null;
  const selectable = useMemo(() => new Set(scopeData && scopeData.scope !== "own" ? scopeData.agents.map(a => a.id) : []), [scopeData]);
  const agentId = agentSel.key === scopeKey && agentSel.id && selectable.has(agentSel.id) ? agentSel.id : null;
  const request: ReportRequest | null = useMemo(() => (scopeData && range && !rangeProblem
    ? { startDate: range.startDate, endDate: range.endDate, agentId, requestedScope: scopeData.requested_scope }
    : null), [scopeData, range, rangeProblem, agentId]);
  const identity = request && scopeData && scopeKey
    ? [scopeKey, scopeData.scope, scopeData.time_zone, request.startDate, request.endDate, request.agentId ?? "all"].join("|") : null;

  const [panelStore, setPanelStore] = useState<{ identity: string | null; panels: Panels }>({ identity: null, panels: ALL_LOADING });
  const panels = identity && panelStore.identity === identity ? panelStore.panels : ALL_LOADING;
  const controllers = useRef<Partial<Record<PanelKey, AbortController>>>({});
  const current = useRef<{ identity: string | null; request: ReportRequest | null; scope: ReportScopeV3 | null }>({ identity: null, request: null, scope: null });
  current.current = { identity, request, scope: scopeData };

  const loadPanel = useCallback((key: PanelKey) => {
    const { identity: id, request: req, scope: sc } = current.current;
    if (!id || !req || !sc) return;
    controllers.current[key]?.abort();
    const controller = new AbortController();
    controllers.current[key] = controller;
    const put = (state: PanelState<unknown>) => setPanelStore(prev => ({
      identity: id, panels: { ...(prev.identity === id ? prev.panels : ALL_LOADING), [key]: state } as Panels,
    }));
    put({ status: "loading" });
    (FETCHERS[key] as (r: ReportRequest, s: AbortSignal) => Promise<PanelMeta>)(req, controller.signal)
      .then(data => {
        if (controller.signal.aborted || current.current.identity !== id) return;
        put(matches(data, req, sc) ? { status: "ready", data } : { status: "error", kind: "unavailable", drift: true });
      })
      .catch(e => { if (!controller.signal.aborted && current.current.identity === id) put({ status: "error", kind: kindOf(e) }); });
  }, []);

  useEffect(() => {
    const abortAll = () => { Object.values(controllers.current).forEach(c => c?.abort()); controllers.current = {}; };
    abortAll();
    if (!identity) return;
    for (const key of PANEL_KEYS) loadPanel(key);
    return abortAll;
  }, [identity, loadPanel]);

  const scopeDrift = PANEL_KEYS.some(k => { const p = panels[k]; return p.status === "error" && p.drift === true; });
  const onScope = useCallback((value: ReportRequestedScope) => {
    if (!scopeData?.available_scopes.includes(value) || scopeData.requested_scope === value) return;
    setRequested({ key: viewerKey, value });
  }, [scopeData, viewerKey]);

  return {
    scope, scopeData, onScope, preset, setPreset, range, rangeProblem, request, panels, scopeDrift, agentId,
    customStart: custom.start, customEnd: custom.end,
    setCustomStart: (start: string | null) => setCustom(c => ({ ...c, start })),
    setCustomEnd: (end: string | null) => setCustom(c => ({ ...c, end })),
    setAgentId: (id: string | null) => setAgentSel({ key: scopeKey, id }),
    retryPanel: loadPanel,
    refresh: () => setRefreshGen(g => g + 1),
    resetScope: () => setRequested({ key: viewerKey, value: null }),
    /** Export only a panel that is current for this exact request and not drifted. */
    exportable: (key: PanelKey) => !!identity && panelStore.identity === identity && panels[key].status === "ready" && !scopeDrift,
  };
}
