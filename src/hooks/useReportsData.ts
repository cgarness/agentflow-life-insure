/**
 * useReportsData — the Reports page's request lifetime.
 *
 * Contract (AGENT_RULES #22/#23/#31 patterns, mirrored from useImportHistory / useLeaderboardData):
 *
 * 1. **Scope first.** `get_report_scope_v2()` resolves what this viewer may see, the agency time zone and
 *    the agency `today`. Panels are requested only after it succeeds; a denied scope sends no panel
 *    request at all.
 * 2. **State carries its key.** Scope state is keyed by viewer|organization; panel state by
 *    viewer|organization|scope|time zone|agency today|start|end|agent|requested scope. A render whose key differs from
 *    the stored key reads LOADING — never the previous viewer's, period's or agent's numbers, not even
 *    for one frame.
 * 3. **Only the newest request commits.** Every run has a generation; a superseded key aborts its
 *    in-flight requests, and a late answer (resolve OR reject) commits nothing.
 * 4. **Panels settle independently.** One failed panel keeps the others' valid data (partial failure).
 * 5. **No polling, no realtime.** Loads happen on key change, Refresh, or an explicit Retry.
 * 6. **Refresh re-resolves the scope first.** The page's Refresh calls `reload()` on the scope, so the
 *    agency `today`, time zone, permitted agents and scope are never older than the numbers; panels
 *    then re-key from the fresh scope (their key passes through null while the scope reloads).
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
  ReportRequestedScope,
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
  /** Re-resolve the scope (Retry after an error, and the page's Refresh). */
  reload: () => void;
}

export function useReportScope(viewerId: string | null, organizationId: string | null, requestedScope: ReportRequestedScope | null = null): UseReportScopeReturn {
  const key = viewerId && organizationId ? `${viewerId}|${organizationId}|${requestedScope ?? "auto"}` : null;
  const [stored, setStored] = useState<{ key: string; nonce: number; state: LoadState<ReportScope> } | null>(null);
  const [nonce, setNonce] = useState(0);
  const genRef = useRef(0);
  const activeKey = useRef(key);
  useLayoutEffect(() => { activeKey.current = key; });

  useEffect(() => {
    if (!key || activeKey.current !== key) return;
    const gen = (genRef.current += 1);
    const controller = new AbortController();
    setStored({ key, nonce, state: LOADING });
    fetchReportScope(controller.signal, requestedScope).then(
      (data) => {
        if (genRef.current === gen && activeKey.current === key && !controller.signal.aborted) {
          const state: LoadState<ReportScope> = requestedScope && data.requested_scope !== requestedScope
            ? { status: "error", error: new ReportsQueryError("unavailable") } : { status: "ready", data };
          setStored({ key, nonce, state });
        }
      },
      (e) => {
        if (genRef.current === gen && activeKey.current === key && !controller.signal.aborted) {
          setStored({ key, nonce, state: { status: "error", error: toReportsError(e) } });
        }
      },
    );
    return () => controller.abort();
  }, [key, nonce, requestedScope]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const state: LoadState<ReportScope> = stored && key && stored.key === key && stored.nonce === nonce ? stored.state : LOADING;
  return { key, state, reload };
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
  /** With panel/data, also requires the currently ready payload, not a previous visit to the key. */
  isCurrent: (key: string | null, panel?: PanelKey, data?: ReportPanelData[PanelKey]) => boolean;
}

/**
 * `scopeKey` identifies the RESOLVED scope (viewer|org|scope|zone|agency today), so a scope that
 * changed on reload re-keys every panel.
 */
export function panelRequestKey(scopeKey: string | null, request: ReportRequest | null): string | null {
  if (!scopeKey || !request) return null;
  return `${scopeKey}|${request.startDate}|${request.endDate}|${request.agentId ?? "all"}|${request.requestedScope ?? "auto"}`;
}

export function useReportPanels(scopeKey: string | null, request: ReportRequest | null): UseReportPanelsReturn {
  const key = panelRequestKey(scopeKey, request);
  const [stored, setStored] = useState<{ key: string; nonce: number; panels: PanelStates } | null>(null);
  const [nonce, setNonce] = useState(0);

  const keyRef = useRef<string | null>(key);
  const requestRef = useRef<ReportRequest | null>(request);
  const panelGenRef = useRef<Record<PanelKey, number>>({ summary: 0, volume: 0, dispositions: 0, campaigns: 0, leadSources: 0 });
  const controllersRef = useRef<Set<AbortController>>(new Set());
  const readyDataRef = useRef<Partial<ReportPanelData>>({});

  // Current for anything that runs after a commit (retry clicks, late callbacks), unlike a passive effect.
  useLayoutEffect(() => {
    if (keyRef.current !== key) readyDataRef.current = {};
    keyRef.current = key;
    requestRef.current = request;
  });

  const commit = useCallback(<K extends PanelKey>(forKey: string, panel: K, next: LoadState<ReportPanelData[K]>) => {
    setStored((prev) => (prev && prev.key === forKey ? { ...prev, panels: { ...prev.panels, [panel]: next } } : prev));
  }, []);

  const runPanel = useCallback(
    <K extends PanelKey>(forKey: string, req: ReportRequest, panel: K) => {
      if (keyRef.current !== forKey) return;
      delete readyDataRef.current[panel];
      const gen = (panelGenRef.current[panel] += 1);
      const controller = new AbortController();
      controllersRef.current.add(controller);
      const stillCurrent = () => keyRef.current === forKey && panelGenRef.current[panel] === gen && !controller.signal.aborted;
      (FETCHERS[panel] as (r: ReportRequest, s: AbortSignal) => Promise<ReportPanelData[K]>)(req, controller.signal)
        .then(
          (data) => {
            if (stillCurrent()) {
              readyDataRef.current[panel] = data;
              commit(forKey, panel, { status: "ready", data });
            }
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
    // Nothing to request: drop the stored panels, so a key that returns (Refresh, scope Retry) can
    // never re-commit the previous generation's payloads for a frame before it reloads.
    if (!key || !request) { setStored(null); return; }
    // A stale START is refused too: only the key this render committed may begin requests.
    if (keyRef.current !== key) return;
    setStored({ key, nonce, panels: ALL_LOADING });
    for (const panel of PANEL_KEYS) runPanel(key, request, panel);
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      controllers.clear();
      readyDataRef.current = {};
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

  const refresh = useCallback(() => { readyDataRef.current = {}; setNonce((n) => n + 1); }, []);
  const isCurrent = useCallback((k: string | null, panel?: PanelKey, data?: ReportPanelData[PanelKey]) =>
    !!k && keyRef.current === k && (!panel || (!!data && readyDataRef.current[panel] === data)), []);

  const panels = stored && key && stored.key === key && stored.nonce === nonce ? stored.panels : ALL_LOADING;
  return useMemo(() => ({ key, panels, retryPanel, refresh, isCurrent }), [key, panels, retryPanel, refresh, isCurrent]);
}
