import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DashboardRefreshTracker,
  type DashboardSectionKey,
  type DashboardSectionOutcome,
  type DashboardSectionRunResult,
  getDashboardSectionLane,
  type DashboardSectionLane,
} from "@/lib/dashboardRefresh";
import { isPageActive, isPageOffline, onPageActivityChange } from "@/lib/pageActivity";

export interface DashboardSectionState<T> {
  /** Data for the CURRENT user / perspective / period only — never another scope's. */
  data: T | null;
  /** Nothing for this scope yet and it is (or will be) loading. */
  loading: boolean;
  /** A load for this scope is running over the data on screen. */
  refreshing: boolean;
  /** The last attempt for this scope failed (same-scope data, if any, is kept). */
  failed: boolean;
  /** A load for this scope is waiting for the connection to come back. */
  offline: boolean;
  /** False when the data on screen is a partial fallback from a failed load. */
  complete: boolean;
  /** When the data on screen was loaded. */
  updatedAt: number | null;
  /** One more load through the section's lane (never a second concurrent one). */
  reload: () => void;
}

interface Options<T> {
  section: DashboardSectionKey;
  userId: string | null | undefined;
  /** Everything besides the user that changes the query; null = nothing to load yet. */
  scope: string | null;
  /** Throws on a returned query error (a DashboardSectionError may carry a fallback). */
  load: (signal: AbortSignal) => Promise<T>;
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
}

type Snapshot<T> = { scope: string; data: T; updatedAt: number; complete: boolean };

function outcomeOf(result: DashboardSectionRunResult<unknown>): DashboardSectionOutcome {
  // Busy: nothing was sent (an earlier load past its bound still holds the lane).
  return result.status === "busy" ? { status: "deferred", until: null } : { status: result.status };
}

/**
 * One Dashboard section's data: loads when it mounts or its scope changes, and
 * once per Refresh signal — always through the section's lane, so nothing
 * overlaps and nothing is sent while the tab is hidden or offline (a deferred
 * load runs once when the tab is visible and online again). A failed load keeps
 * the same scope's data on screen and says so; another scope's data is never shown.
 */
export function useDashboardSection<T>({
  section,
  userId,
  scope,
  load,
  refreshSignal,
  refreshTracker,
}: Options<T>): DashboardSectionState<T> {
  const fullScope = userId && scope !== null ? `${userId}|${scope}` : null;
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [failedScope, setFailedScope] = useState<string | null>(null);
  const [waitingScope, setWaitingScope] = useState<string | null>(null);
  const [offline, setOffline] = useState(isPageOffline);

  const scopeRef = useRef(fullScope);
  scopeRef.current = fullScope;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const loadRef = useRef(load);
  loadRef.current = load;
  const trackerRef = useRef(refreshTracker);
  trackerRef.current = refreshTracker;
  const waitingRef = useRef<string | null>(null);
  const ownerRef = useRef<object>({});
  const laneRef = useRef<DashboardSectionLane | null>(null);
  const mountedRef = useRef(true);
  /** Only the newest run may change what is on screen (A → B → A switches, joins). */
  const runGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const owner = ownerRef.current;
    return () => {
      mountedRef.current = false;
      laneRef.current?.release(owner);
    };
  }, []);

  // On screen: a Refresh waits for this section (and counts it skipped if it unmounts).
  useEffect(() => refreshTracker?.register(section), [refreshTracker, section]);

  const run = useCallback(async (): Promise<DashboardSectionOutcome> => {
    const scopeKey = scopeRef.current;
    const viewer = userIdRef.current;
    if (!scopeKey || !viewer) return { status: "skipped" };
    const lane = getDashboardSectionLane(`${viewer}|${section}`);
    if (laneRef.current && laneRef.current !== lane) laneRef.current.release(ownerRef.current);
    laneRef.current = lane;
    const generation = ++runGenerationRef.current;
    setPendingScope(scopeKey);
    const result = await lane.run(scopeKey, ownerRef.current, loadRef.current);
    // Only the newest run, for the current scope, may change what is on screen.
    if (!mountedRef.current || scopeRef.current !== scopeKey || generation !== runGenerationRef.current) {
      return outcomeOf(result);
    }

    if (result.status === "ok") {
      waitingRef.current = null;
      setSnapshot({ scope: scopeKey, data: result.data, updatedAt: Date.now(), complete: true });
      setFailedScope(null);
      setWaitingScope(null);
      setPendingScope(null);
    } else if (result.status === "failed" || result.status === "busy") {
      // Busy: an earlier load past its bound still holds the lane, so nothing was
      // sent — shown like a failed refresh (same-scope data kept, and said so).
      waitingRef.current = null;
      const fallback = result.status === "failed" ? result.fallback : null;
      if (fallback) {
        // Used only when nothing for this scope is on screen yet.
        setSnapshot((prev) =>
          prev?.scope === scopeKey ? prev : { scope: scopeKey, data: fallback.data, updatedAt: Date.now(), complete: false },
        );
      }
      setFailedScope(scopeKey);
      setWaitingScope(null);
      setPendingScope(null);
    } else if (result.status === "inactive") {
      // Hidden or offline: nothing was sent. Load once the tab is visible and online.
      waitingRef.current = scopeKey;
      setWaitingScope(scopeKey);
      setPendingScope(null);
    } else {
      setPendingScope(null);
    }
    return outcomeOf(result);
  }, [section]);

  useEffect(() => {
    void run();
  }, [fullScope, run]);

  // A remount (edit-mode toggle, hide/restore) must not count as a Refresh click.
  const lastSignalRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === lastSignalRef.current) return;
    lastSignalRef.current = refreshSignal;
    // Started first: `?.` would skip the whole call (and the load) without a tracker.
    const work = run();
    trackerRef.current?.report(refreshSignal, section, work);
  }, [refreshSignal, section, run]);

  useEffect(
    () =>
      onPageActivityChange(() => {
        setOffline(isPageOffline());
        if (!isPageActive() || waitingRef.current === null || waitingRef.current !== scopeRef.current) return;
        waitingRef.current = null;
        void run();
      }),
    [run],
  );

  const reload = useCallback(() => {
    void run();
  }, [run]);

  const data = snapshot !== null && snapshot.scope === fullScope ? snapshot.data : null;
  const failed = fullScope !== null && failedScope === fullScope;
  const waitingOffline = fullScope !== null && waitingScope === fullScope && offline;
  const pending = fullScope !== null && pendingScope === fullScope;
  return {
    data,
    // With nothing on screen, a running load (a retry included) is a loading state.
    loading: fullScope === null || (data === null && (pending || (!failed && !waitingOffline))),
    refreshing: data !== null && pending,
    failed,
    offline: waitingOffline,
    complete: data === null || snapshot?.complete !== false,
    updatedAt: data !== null ? snapshot?.updatedAt ?? null : null,
    reload,
  };
}
