import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAgencyGroup } from "@/hooks/useAgencyGroup";
import {
  type LeaderboardEndpoint,
  type LeaderboardLoadResult,
  type LeaderboardRequestGate,
  type LeaderboardRunMode,
  getLeaderboardRequestGate,
} from "@/lib/leaderboardRequestGate";
import {
  type StandingsStatus,
  STANDINGS_STATUS_OK,
  standingsHeadline,
  standingsStatusKind,
} from "@/lib/leaderboardStatusCopy";
import type { DashboardRefreshTracker, DashboardSectionOutcome } from "@/lib/dashboardRefresh";
import { isPageActive, isPageOffline, onPageActivityChange } from "@/lib/pageActivity";

export interface WidgetRankedAgent {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  wins: number;
  organizationName?: string | null;
}

/** Request-gate keys are per consumer, so the widget and the page never share a result. */
const CONSUMER = "widget";

/** Browser-local start of the month the widget shows ("Top agents this month"). */
function monthStartOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Snapshot identity: viewer | view | month start. Taken when a load runs and again
 * when it settles (no timer), so a load in a new month never keeps, or commits
 * over, last month's podium.
 */
function snapshotTag(scope: string, now: Date): string {
  return `${scope}|${monthStartOf(now).toISOString()}`;
}

// Org standings come from the canonical aggregate RPC — the same metric
// definitions as the Leaderboard page. Never rebuilt from raw tables:
// Agent RLS hides other agents' rows, and clients-created is not "wins".
async function loadOrgMonth(
  start: Date,
  end: Date,
  signal: AbortSignal,
): Promise<LeaderboardLoadResult<WidgetRankedAgent[]>> {
  const { data, error } = await supabase
    .rpc("get_org_leaderboard_stats", {
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    })
    .abortSignal(signal);
  if (error || !data) {
    console.error("[LeaderboardWidget] get_org_leaderboard_stats failed:", error);
    return { data: null, error };
  }
  return {
    data: data
      .map((r) => ({
        id: r.agent_id,
        firstName: r.first_name,
        lastName: r.last_name,
        avatarUrl: r.avatar_url || null,
        wins: Number(r.policies_sold) || 0,
      }))
      .sort((a, b) => {
        const diff = b.wins - a.wins;
        if (diff !== 0) return diff;
        const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
        const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return a.id.localeCompare(b.id);
      }),
    error: null,
  };
}

async function loadGroupMonth(
  groupId: string,
  signal: AbortSignal,
): Promise<LeaderboardLoadResult<WidgetRankedAgent[]>> {
  const { data, error } = await supabase
    .rpc("get_agency_group_leaderboard", {
      p_group_id: groupId,
      p_period: "month",
    })
    .abortSignal(signal);
  if (error || !data) return { data: null, error };
  return {
    data: (data as any[])
      .map((r) => ({
        id: r.agent_id,
        firstName: r.agent_first_name,
        lastName: r.agent_last_name,
        avatarUrl: r.agent_avatar_url,
        wins: Number(r.policies_sold) || 0,
        organizationName: r.organization_name,
      }))
      .sort((a, b) => {
        const diff = b.wins - a.wins;
        if (diff !== 0) return diff;
        const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
        const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return a.id.localeCompare(b.id);
      }),
    error: null,
  };
}

/**
 * The Dashboard standings preview's data. No polling and no automatic retry —
 * the Dashboard refreshes only when someone presses Refresh or Retry, and every
 * run goes through the viewer's request gate (shared with the Leaderboard page).
 * A run refused because the tab is hidden or offline runs once when the tab is
 * visible and online again. Each Refresh reports what it did to the Dashboard's
 * tracker; a spaced or held run is "deferred" and never holds up other widgets.
 */
export function useLeaderboardWidgetStandings(
  userId: string,
  organizationId: string | null,
  refreshSignal?: number,
  refreshTracker?: DashboardRefreshTracker | null,
) {
  const { agencyGroup } = useAgencyGroup();
  const [widgetView, setWidgetView] = useState<"org" | "group">("org");
  const [ranked, setRanked] = useState<WidgetRankedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<StandingsStatus>(STANDINGS_STATUS_OK);
  /** A manual refresh arrived too soon: when standings can refresh again. */
  const [refreshHeldUntil, setRefreshHeldUntil] = useState<number | null>(null);

  // Both ids, like the Leaderboard page: until the organization is known nothing
  // is sent, so one viewer never runs requests on two gates.
  const identityKey = userId && organizationId ? `${userId}:${organizationId}` : null;
  // By id, so group info arriving after mount never re-sends the org request.
  const groupId = widgetView === "group" ? agencyGroup?.groupId ?? null : null;
  const endpoint: LeaderboardEndpoint = groupId ? "group_standings" : "org_standings";
  const scopeKey = `${identityKey ?? ""}|${groupId ?? "org"}`;

  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const identityRef = useRef(identityKey);
  const generationRef = useRef(0);
  const ownerRef = useRef<object>({});
  const gateRef = useRef<LeaderboardRequestGate | null>(null);
  const rankedRef = useRef<WidgetRankedAgent[]>([]);
  const snapshotScopeRef = useRef<string | null>(null);
  const lastUpdatedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  /** A run refused while hidden or offline, waiting for a visible, online tab. */
  const waitingRef = useRef(false);
  const trackerRef = useRef(refreshTracker);
  trackerRef.current = refreshTracker;

  // A different viewer never sees the previous viewer's rows (reset before paint).
  useLayoutEffect(() => {
    if (identityRef.current === identityKey) return;
    identityRef.current = identityKey;
    gateRef.current?.release(ownerRef.current);
    gateRef.current = null;
    generationRef.current += 1;
    rankedRef.current = [];
    snapshotScopeRef.current = null;
    lastUpdatedAtRef.current = null;
    waitingRef.current = false;
    setRanked([]);
    setLoading(true);
    setLoadError(null);
    setStatus(STANDINGS_STATUS_OK);
    setRefreshHeldUntil(null);
  }, [identityKey]);

  const load = useCallback(
    async (mode: LeaderboardRunMode): Promise<DashboardSectionOutcome> => {
      if (!identityKey) return { status: "skipped" };
      const gen = ++generationRef.current;
      const scope = scopeKey;
      const gate = getLeaderboardRequestGate(identityKey);
      gateRef.current = gate;
      const now = new Date();
      const startOfMonth = monthStartOf(now);
      const monthKey = startOfMonth.toISOString();
      const tag = snapshotTag(scope, now);
      // A view switch or a new month never shows the other view's or last month's
      // rows while it loads; a manual refresh of the same view and month keeps its
      // snapshot on screen (no skeleton flash).
      if (snapshotScopeRef.current !== tag) {
        const hadRows = rankedRef.current.length > 0;
        rankedRef.current = [];
        snapshotScopeRef.current = null;
        lastUpdatedAtRef.current = null;
        setRanked([]);
        if (mode !== "manual" || hadRows) setLoading(true);
      }

      const result = await gate.run<WidgetRankedAgent[]>(
        groupId
          ? {
              endpoint,
              channel: "standings",
              key: `${CONSUMER}|group_standings|${groupId}|month|${monthKey}`,
              mode,
              owner: ownerRef.current,
              load: (signal) => loadGroupMonth(groupId, signal),
            }
          : {
              endpoint,
              channel: "standings",
              key: `${CONSUMER}|org_standings|month|${monthKey}`,
              mode,
              owner: ownerRef.current,
              load: (signal) => loadOrgMonth(startOfMonth, now, signal),
            },
      );
      if (!mountedRef.current || gen !== generationRef.current || scopeRef.current !== scope) {
        return { status: "superseded" };
      }
      // The month can roll while the request is queued or on the wire: last
      // month's rows, kept or just loaded, never show under this month.
      const settledTag = snapshotTag(scope, new Date());
      if (snapshotScopeRef.current !== settledTag) {
        rankedRef.current = [];
        snapshotScopeRef.current = null;
        lastUpdatedAtRef.current = null;
        setRanked([]);
      }
      if (result.status === "blocked" && result.reason === "inactive") {
        // Hidden or offline: nothing was sent; it runs once the tab is visible and
        // online. A view with nothing on screen never carries the other view's
        // headline or times (a server hold still covers the endpoint), and an
        // offline tab says it is offline instead of showing a skeleton.
        waitingRef.current = true;
        if (snapshotScopeRef.current !== settledTag) {
          const hold = gate.cooldown(endpoint);
          const heldKind = hold && (hold.kind === "maintenance" || hold.kind === "busy") ? hold.kind : null;
          setLoadError(heldKind ? standingsHeadline(heldKind, false, "widget") : null);
          setStatus({
            ...STANDINGS_STATUS_OK,
            kind: heldKind ?? "ok",
            manualAvailableAt: gate.manualAvailableAt(endpoint),
            offline: isPageOffline(),
          });
        } else {
          setStatus((prev) => ({ ...prev, offline: isPageOffline() }));
        }
        if (isPageOffline()) setLoading(false);
        return { status: "inactive" };
      }
      waitingRef.current = false;
      setLoading(false);

      if (result.status === "superseded") return { status: "superseded" };
      if (result.status === "ok" && tag !== settledTag) {
        // Loaded for last month: not this month's standings, so nothing is shown
        // and the next Refresh loads this month as a first load.
        setLoadError(standingsHeadline("error", false, "widget"));
        setStatus({ ...STANDINGS_STATUS_OK, kind: "error", manualAvailableAt: gate.manualAvailableAt(endpoint) });
        return { status: "failed" };
      }
      if (result.status === "ok") {
        const updatedAt = Date.now();
        rankedRef.current = result.data;
        snapshotScopeRef.current = tag;
        lastUpdatedAtRef.current = updatedAt;
        setRanked(result.data);
        setLoadError(null);
        setRefreshHeldUntil(null);
        setStatus({ ...STANDINGS_STATUS_OK, lastUpdatedAt: updatedAt, manualAvailableAt: gate.manualAvailableAt(endpoint) });
        return { status: "ok" };
      }
      if (result.status === "blocked" && result.reason === "throttled") {
        setRefreshHeldUntil(result.availableAt);
        setStatus((prev) => ({ ...prev, manualAvailableAt: result.availableAt, offline: false }));
        return { status: "deferred", until: result.availableAt };
      }
      // Failed or held. Group stays selected (no silent switch to My Agency); rows
      // for the other view or last month were cleared above and never show here.
      const kind = standingsStatusKind(result.kind);
      const hasSnapshot = rankedRef.current.length > 0;
      setLoadError(standingsHeadline(kind, hasSnapshot, "widget"));
      setStatus({
        kind,
        lastUpdatedAt: hasSnapshot ? lastUpdatedAtRef.current : null,
        // The Dashboard never refreshes on its own, so no automatic check is promised.
        nextCheckAt: null,
        manualAvailableAt: gate.manualAvailableAt(endpoint),
        offline: false,
      });
      // A hold refused the run before anything was sent: a deferred section.
      return result.status === "blocked"
        ? { status: "deferred", until: result.retryAt }
        : { status: "failed" };
    },
    [identityKey, scopeKey, groupId, endpoint],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void load("initial");
  }, [load]);

  // A remount (edit-mode toggle, hide/restore) must not count as a Refresh click.
  const lastSignalRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === lastSignalRef.current) return;
    lastSignalRef.current = refreshSignal;
    // Started first: `?.` would skip the whole call (and the run) without a tracker.
    // With nothing loaded for this view it is a first load ("initial"): a spacing
    // refusal would otherwise leave no read behind the empty state.
    const work = loadRef.current(
      snapshotScopeRef.current === snapshotTag(scopeRef.current, new Date()) ? "manual" : "initial",
    );
    trackerRef.current?.report(refreshSignal, "leaderboard", work);
  }, [refreshSignal]);

  // On screen: a Dashboard Refresh waits for this widget (skipped if it unmounts).
  useEffect(() => refreshTracker?.register("leaderboard"), [refreshTracker]);

  // A refused run waits: offline is tracked live (a tab shown while still offline
  // says so, never an endless skeleton), and once the tab is visible and online
  // it runs once (a first load as "initial").
  useEffect(
    () =>
      onPageActivityChange(() => {
        const offline = waitingRef.current && isPageOffline();
        setStatus((prev) => (prev.offline === offline ? prev : { ...prev, offline }));
        if (offline) setLoading(false);
        if (!waitingRef.current || !isPageActive()) return;
        waitingRef.current = false;
        void loadRef.current(
          snapshotScopeRef.current === snapshotTag(scopeRef.current, new Date()) ? "manual" : "initial",
        );
      }),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    const owner = ownerRef.current;
    return () => {
      mountedRef.current = false;
      gateRef.current?.release(owner);
    };
  }, []);

  const retry = useCallback(() => {
    void loadRef.current("manual");
  }, []);

  return {
    agencyGroup,
    widgetView,
    setWidgetView,
    ranked,
    loading,
    loadError,
    status,
    refreshHeldUntil,
    retry,
  };
}
