/**
 * useReportsData — the Reports page's request lifetime.
 *
 * Contract (AGENT_RULES #22/#23/#31 patterns, mirrored from useImportHistory / useLeaderboardData):
 *
 * 1. **Scope first.** `get_report_scope()` resolves what this viewer may see, the agency time zone and
 *    the agency `today`. Panels are requested only after it succeeds; a denied scope sends no panel
 *    request at all.
 * 2. **State carries its key.** Scope state is keyed by viewer|organization; panel state by
 *    viewer|organization|start|end|agent. A render whose key differs from the stored key reads
 *    LOADING — never the previous viewer's, period's or agent's numbers, not even for one frame.
 * 3. **Only the newest request commits.** Every run has a generation; a superseded key aborts its
 *    in-flight requests, and a late answer (resolve OR reject) commits nothing.
 * 4. **Panels settle independently.** One failed panel keeps the others' valid data (partial failure).
 * 5. **No polling, no realtime.** Loads happen on key change, Refresh, or an explicit Retry.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fetchReportCampaigns,
  fetchReportDispositions,
  fetchReportLeadSources,
  fetchReportScope,
  fetchReportSummary,
  fetchReportVolume,
  isReportsQueryError,
  ReportsQueryError,
  type ReportRequest,
} from "@/lib/reports-queries";
import type {
  ReportCampaigns,
  ReportDispositions,
  ReportLeadSources,
  ReportScope,
  ReportSummary,
  ReportVolume,
} from "@/lib/reports-schemas";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: ReportsQueryError };

const LOADING = { status: "loading" } as const;

function toReportsError(e: unknown): ReportsQueryError {
  return isReportsQueryError(e) ? e : new ReportsQueryError("unavailable", e);
}

// ─── Scope ───────────────────────────────────────────────────────────────────────────────────────

export interface UseReportScopeReturn {
  /** viewer|organization, or null when there is no signed-in viewer. */
  key: string | null;
  state: LoadState<ReportScope>;
  retry: () => void;
}

export function useReportScope(viewerId: string | null, organizationId: string | null): UseReportScopeReturn {
  const key = viewerId && organizationId ? `${viewerId}|${organizationId}` : null;
  const [stored, setStored] = useState<{ key: string; state: LoadState<ReportScope> } | null>(null);
  const [nonce, setNonce] = useState(0);
  const genRef = useRef(0);

  useEffect(() => {
    if (!key) return;
    const gen = (genRef.current += 1);
    const controller = new AbortController();
    setStored({ key, state: LOADING });
    fetchReportScope(controller.signal).then(
      (data) => {
        if (genRef.current === gen) setStored({ key, state: { status: "ready", data } });
      },
      (e) => {
        if (genRef.current === gen && !controller.signal.aborted) {
          setStored({ key, state: { status: "error", error: toReportsError(e) } });
        }
      },
    );
    return () => controller.abort();
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const state: LoadState<ReportScope> = stored && key && stored.key === key ? stored.state : LOADING;
  return { key, state, retry };
}

// ─── Panels ──────────────────────────────────────────────────────────────────────────────────────

export interface ReportPanelData {
  summary: ReportSummary;
  volume: ReportVolume;
  dispositions: ReportDispositions;
  campaigns: ReportCampaigns;
  leadSources: ReportLeadSources;
}
export type PanelKey = keyof ReportPanelData;
export type PanelStates = { [K in PanelKey]: LoadState<ReportPanelData[K]> };

export const PANEL_KEYS: PanelKey[] = ["summary", "volume", "dispositions", "campaigns", "leadSources"];

const FETCHERS: { [K in PanelKey]: (req: ReportRequest, signal: AbortSignal) => Promise<ReportPanelData[K]> } = {
  summary: fetchReportSummary,
  volume: fetchReportVolume,
  dispositions: fetchReportDispositions,
  campaigns: fetchReportCampaigns,
  leadSources: fetchReportLeadSources,
};

const ALL_LOADING: PanelStates = {
  summary: LOADING,
  volume: LOADING,
  dispositions: LOADING,
  campaigns: LOADING,
  leadSources: LOADING,
};

export interface UseReportPanelsReturn {
  /** The key the returned panels belong to (null while there is nothing to request). */
  key: string | null;
  panels: PanelStates;
  retryPanel: (panel: PanelKey) => void;
  refresh: () => void;
  /** True when `key` is still the report on screen — checked at export time. */
  isCurrent: (key: string | null) => boolean;
}

export function panelRequestKey(scopeKey: string | null, request: ReportRequest | null): string | null {
  if (!scopeKey || !request) return null;
  return `${scopeKey}|${request.startDate}|${request.endDate}|${request.agentId ?? "all"}`;
}

export function useReportPanels(scopeKey: string | null, request: ReportRequest | null): UseReportPanelsReturn {
  const key = panelRequestKey(scopeKey, request);
  const [stored, setStored] = useState<{ key: string; panels: PanelStates } | null>(null);
  const [nonce, setNonce] = useState(0);

  const keyRef = useRef<string | null>(key);
  const requestRef = useRef<ReportRequest | null>(request);
  const panelGenRef = useRef<Record<PanelKey, number>>({ summary: 0, volume: 0, dispositions: 0, campaigns: 0, leadSources: 0 });
  const controllersRef = useRef<Set<AbortController>>(new Set());

  // Current for anything that runs after a commit (retry clicks, late callbacks), unlike a passive effect.
  useLayoutEffect(() => {
    keyRef.current = key;
    requestRef.current = request;
  });

  const commit = useCallback(<K extends PanelKey>(forKey: string, panel: K, next: LoadState<ReportPanelData[K]>) => {
    setStored((prev) => (prev && prev.key === forKey ? { key: forKey, panels: { ...prev.panels, [panel]: next } } : prev));
  }, []);

  const runPanel = useCallback(
    <K extends PanelKey>(forKey: string, req: ReportRequest, panel: K) => {
      const gen = (panelGenRef.current[panel] += 1);
      const controller = new AbortController();
      controllersRef.current.add(controller);
      const stillCurrent = () => keyRef.current === forKey && panelGenRef.current[panel] === gen && !controller.signal.aborted;
      (FETCHERS[panel] as (r: ReportRequest, s: AbortSignal) => Promise<ReportPanelData[K]>)(req, controller.signal)
        .then(
          (data) => {
            if (stillCurrent()) commit(forKey, panel, { status: "ready", data });
          },
          (e) => {
            if (stillCurrent()) commit(forKey, panel, { status: "error", error: toReportsError(e) });
          },
        )
        .finally(() => controllersRef.current.delete(controller));
    },
    [commit],
  );

  useEffect(() => {
    if (!key || !request) return;
    // A stale START is refused too: only the key this render committed may begin requests.
    if (keyRef.current !== key) return;
    setStored({ key, panels: ALL_LOADING });
    for (const panel of PANEL_KEYS) runPanel(key, request, panel);
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
    // `request` is fully described by `key`; depending on the object would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, runPanel]);

  const retryPanel = useCallback(
    (panel: PanelKey) => {
      const forKey = keyRef.current;
      const req = requestRef.current;
      if (!forKey || !req) return;
      commit(forKey, panel, LOADING);
      runPanel(forKey, req, panel);
    },
    [commit, runPanel],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const isCurrent = useCallback((k: string | null) => !!k && keyRef.current === k, []);

  const panels = stored && key && stored.key === key ? stored.panels : ALL_LOADING;
  return useMemo(() => ({ key, panels, retryPanel, refresh, isCurrent }), [key, panels, retryPanel, refresh, isCurrent]);
}
