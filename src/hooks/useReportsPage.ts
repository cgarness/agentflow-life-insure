// Reports v3 page state (D6 §4.8): the v3 scope gates the page; the eight panels load in parallel for the current
// request, each failing closed on its own. A response for an old request is never shown (no stale numbers).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isReportsQueryError, type ReportRequest, type ReportsErrorKind } from "@/lib/reports-queries";
import type { ReportRequestedScope } from "@/lib/reports-schemas";
import { fetchReportScopeV3 } from "@/lib/reports-v3-queries";
import type { ReportScopeV3 } from "@/lib/reports-v3-schemas";
import { ALL_LOADING, FETCHERS, PANEL_KEYS, type PanelKey, type Panels } from "@/lib/reports-panels";
import { presetRange, validateRange, type CalendarRange, type ReportPreset } from "@/lib/reports-format";

type ScopeState = { status: "loading" } | { status: "ready"; data: ReportScopeV3 } | { status: "error"; kind: ReportsErrorKind };
const kindOf = (e: unknown): ReportsErrorKind => (isReportsQueryError(e) ? e.kind : "unavailable");

export function useReportsPage(viewerKey: string | null) {
  const [requestedScope, setRequestedScope] = useState<ReportRequestedScope | null>(null);
  const [scope, setScope] = useState<ScopeState>({ status: "loading" });
  const [scopeGen, setScopeGen] = useState(0);
  const [preset, setPreset] = useState<ReportPreset>("30d");
  const [custom, setCustom] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [agentId, setAgentId] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panels>(ALL_LOADING);
  const generation = useRef(0);
  const controllers = useRef<Partial<Record<PanelKey, AbortController>>>({});

  useEffect(() => { setRequestedScope(null); setAgentId(null); }, [viewerKey]);
  useEffect(() => {
    if (!viewerKey) return;
    const controller = new AbortController();
    setScope({ status: "loading" });
    fetchReportScopeV3(controller.signal, requestedScope)
      .then(data => { if (!controller.signal.aborted) setScope({ status: "ready", data }); })
      .catch(e => { if (!controller.signal.aborted) setScope({ status: "error", kind: kindOf(e) }); });
    return () => controller.abort();
  }, [viewerKey, requestedScope, scopeGen]);

  const scopeData = scope.status === "ready" ? scope.data : null;
  const range: CalendarRange | null = useMemo(() => {
    if (!scopeData) return null;
    if (preset !== "custom") return presetRange(preset, scopeData.today);
    return custom.start && custom.end ? { startDate: custom.start, endDate: custom.end } : null;
  }, [scopeData, preset, custom]);
  const rangeProblem = range && scopeData ? validateRange(range, scopeData.max_range_days) : null;
  const selectableAgents = useMemo(() => new Set(scopeData && scopeData.scope !== "own" ? scopeData.agents.map(a => a.id) : []), [scopeData]);
  const effectiveAgent = agentId && selectableAgents.has(agentId) ? agentId : null;
  const request: ReportRequest | null = useMemo(() => (scopeData && range && !rangeProblem
    ? { startDate: range.startDate, endDate: range.endDate, agentId: effectiveAgent, requestedScope: scopeData.requested_scope }
    : null), [scopeData, range, rangeProblem, effectiveAgent]);

  const loadPanel = useCallback((key: PanelKey, req: ReportRequest, gen: number) => {
    controllers.current[key]?.abort();
    const controller = new AbortController();
    controllers.current[key] = controller;
    setPanels(p => ({ ...p, [key]: { status: "loading" } }));
    (FETCHERS[key] as (r: ReportRequest, s: AbortSignal) => Promise<unknown>)(req, controller.signal)
      .then(data => { if (gen === generation.current && !controller.signal.aborted) setPanels(p => ({ ...p, [key]: { status: "ready", data } })); })
      .catch(e => {
        if (gen !== generation.current || controller.signal.aborted) return;
        setPanels(p => ({ ...p, [key]: { status: "error", kind: kindOf(e) } }));
      });
  }, []);

  useEffect(() => {
    const gen = ++generation.current;
    Object.values(controllers.current).forEach(c => c?.abort());
    controllers.current = {};
    setPanels(ALL_LOADING);
    if (!request) return;
    for (const key of PANEL_KEYS) loadPanel(key, request, gen);
    return () => { Object.values(controllers.current).forEach(c => c?.abort()); };
  }, [request, loadPanel]);

  const retryPanel = useCallback((key: PanelKey) => { if (request) loadPanel(key, request, generation.current); }, [request, loadPanel]);
  const onScope = useCallback((value: ReportRequestedScope) => {
    if (!scopeData?.available_scopes.includes(value) || scopeData.requested_scope === value) return;
    setRequestedScope(value);
    setAgentId(null);
  }, [scopeData]);

  return {
    scope, scopeData, reloadScope: () => setScopeGen(g => g + 1), onScope, preset, setPreset,
    customStart: custom.start, customEnd: custom.end,
    setCustomStart: (start: string | null) => setCustom(c => ({ ...c, start })),
    setCustomEnd: (end: string | null) => setCustom(c => ({ ...c, end })),
    range, rangeProblem, agentId: effectiveAgent, setAgentId, request, panels, retryPanel,
  };
}
