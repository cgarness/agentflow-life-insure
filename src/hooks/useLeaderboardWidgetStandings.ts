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
 */
export function useLeaderboardWidgetStandings(
  userId: string,
  organizationId: string | null,
  refreshSignal?: number,
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
    setRanked([]);
    setLoading(true);
    setLoadError(null);
    setStatus(STANDINGS_STATUS_OK);
    setRefreshHeldUntil(null);
  }, [identityKey]);

  const load = useCallback(
    async (mode: LeaderboardRunMode) => {
      if (!identityKey) return;
      const gen = ++generationRef.current;
      const scope = scopeKey;
      const gate = getLeaderboardRequestGate(identityKey);
      gateRef.current = gate;
      // A view switch never shows the other view's rows while it loads; a manual
      // refresh of the same view keeps its snapshot on screen (no skeleton flash).
      if (snapshotScopeRef.current !== scope && mode !== "manual") {
        rankedRef.current = [];
        snapshotScopeRef.current = null;
        lastUpdatedAtRef.current = null;
        setRanked([]);
        setLoading(true);
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthKey = startOfMonth.toISOString();
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
      if (!mountedRef.current || gen !== generationRef.current || scopeRef.current !== scope) return;
      setLoading(false);

      if (result.status === "superseded") return;
      if (result.status === "ok") {
        const updatedAt = Date.now();
        rankedRef.current = result.data;
        snapshotScopeRef.current = scope;
        lastUpdatedAtRef.current = updatedAt;
        setRanked(result.data);
        setLoadError(null);
        setRefreshHeldUntil(null);
        setStatus({ ...STANDINGS_STATUS_OK, lastUpdatedAt: updatedAt, manualAvailableAt: gate.manualAvailableAt(endpoint) });
        return;
      }
      if (result.status === "blocked" && result.reason === "throttled") {
        setRefreshHeldUntil(result.availableAt);
        setStatus((prev) => ({ ...prev, manualAvailableAt: result.availableAt }));
        return;
      }
      // Failed or held. Group stays selected (no silent switch to My Agency), and
      // rows loaded for the other view are never shown under this one.
      if (snapshotScopeRef.current !== scope) {
        rankedRef.current = [];
        snapshotScopeRef.current = null;
        lastUpdatedAtRef.current = null;
        setRanked([]);
      }
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
    void loadRef.current("manual");
  }, [refreshSignal]);

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
