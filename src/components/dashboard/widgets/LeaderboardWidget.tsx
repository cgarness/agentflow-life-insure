import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { LeaderboardRequestGate, canRefreshLeaderboard, leaderboardErrorMessage } from "@/lib/leaderboard-request-gate";
import { AlertTriangle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAgencyGroup } from "@/hooks/useAgencyGroup";
import LeaderboardPreviewRow from "@/components/dashboard/widgets/LeaderboardPreviewRow";

interface LeaderboardWidgetProps {
  userId: string;
}

interface RankedAgent {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  wins: number;
  organizationName?: string | null;
}

const LeaderboardWidget: React.FC<LeaderboardWidgetProps> = ({ userId }) => {
  const navigate = useNavigate();
  const { agencyGroup } = useAgencyGroup();
  const [widgetView, setWidgetView] = useState<"org" | "group">("org");
  const [ranked, setRanked] = useState<RankedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [errorMessage, setErrorMessage] = useState("Couldn't load standings");
  const { profile } = useAuth();
  const identityKey = `${userId}:${profile?.organization_id ?? ""}`;
  const requestGateRef = useRef(new LeaderboardRequestGate());
  const contextKey = `${identityKey}:${widgetView}:${agencyGroup?.groupId ?? ""}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;

  useEffect(() => {
    requestGateRef.current.reset();
    setRanked([]);
    setLoadError(false);
    return () => requestGateRef.current.reset();
  }, [identityKey]);

  useEffect(() => {
    const resume = () => {
      if (canRefreshLeaderboard()) setReloadNonce((n) => n + 1);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let failure = false;
    if (!canRefreshLeaderboard()) return;

    // Org standings come from the canonical aggregate RPC — the same metric
    // definitions as the Leaderboard page. Never rebuilt from raw tables:
    // Agent RLS hides other agents' rows, and clients-created is not "wins".
    const fetchOrgLeaderboard = async (): Promise<RankedAgent[] | null> => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const { data, error } = await requestGateRef.current.run(
        `${identityKey}:org:${startOfMonth.toISOString()}`,
        (signal) => supabase.rpc("get_org_leaderboard_stats", {
          p_start: startOfMonth.toISOString(),
          p_end: now.toISOString(),
        }).abortSignal(signal),
        () => contextRef.current === contextKey && canRefreshLeaderboard(),
      );
      if (error || !data) {
        console.error("[LeaderboardWidget] get_org_leaderboard_stats failed:", error);
        if (!cancelled && contextRef.current === contextKey) {
          setErrorMessage(error?.code === "PT503" || error?.code === "PT429"
            ? leaderboardErrorMessage(error, false) : "Couldn't load standings");
        }
        return null;
      }
      return data
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
        });
    };

    const fetchGroupLeaderboard = async (groupId: string): Promise<RankedAgent[] | null> => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data, error } = await requestGateRef.current.run(
        `${identityKey}:group:${groupId}:${monthStart}`,
        (signal) => supabase.rpc("get_agency_group_leaderboard", {
          p_group_id: groupId,
          p_period: "month",
        }).abortSignal(signal),
        () => contextRef.current === contextKey && canRefreshLeaderboard(),
      );
      if (error || !data) return null;
      return (data as any[])
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
        });
    };

    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        if (widgetView === "group" && agencyGroup) {
          const groupRanked = await fetchGroupLeaderboard(agencyGroup.groupId);
          if (cancelled) return;
          if (groupRanked) {
            setRanked(groupRanked);
            return;
          }
          setWidgetView("org");
          return;
        }
        const orgRanked = await fetchOrgLeaderboard();
        if (cancelled) return;
        if (orgRanked) {
          setRanked(orgRanked);
        } else {
          // A failed load is an error, never a fake empty/zero board; any
          // previously loaded snapshot is kept behind the error notice.
          failure = true;
          setLoadError(true);
        }
      } catch {
        failure = true;
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (failure) retryTimer = window.setTimeout(() => {
            if (canRefreshLeaderboard()) setReloadNonce((n) => n + 1);
          }, 30_000);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [identityKey, contextKey, widgetView, agencyGroup, reloadNonce]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadError && ranked.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium mb-3">{errorMessage}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloadNonce((n) => n + 1)}
          className="text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (ranked.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <Users className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">No sales data yet</p>
      </div>
    );
  }

  // Presentation-only safeguard: zero-sale agents only tie, and the canonical
  // tie-break is alphabetical — never dress that up as a #1/#2/#3. They always
  // sort after every agent with a sale, so the ranks shown stay canonical.
  const top3 = ranked.filter((a) => a.wins > 0).slice(0, 3);
  const noSalesYet = top3.length === 0;

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <AlertTriangle className="w-3 h-3" />
          <span>Refresh failed — standings may be out of date.</span>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}
      {agencyGroup && (
        <div className="flex bg-accent/40 rounded-lg p-0.5 w-fit mx-auto text-[10px]">
          <button
            onClick={() => setWidgetView("org")}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${widgetView === "org" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            My Agency
          </button>
          <button
            onClick={() => setWidgetView("group")}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${widgetView === "group" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            Group
          </button>
        </div>
      )}
      {noSalesYet ? (
        <p className="py-6 rounded-xl bg-muted/30 text-center text-sm font-medium text-muted-foreground">
          No sales recorded yet this month.
        </p>
      ) : (
        <ol aria-label="Top agents this month" className="space-y-2">
          {top3.map((agent, idx) => (
            <LeaderboardPreviewRow
              key={agent.id}
              index={idx}
              rank={idx + 1}
              firstName={agent.firstName}
              lastName={agent.lastName}
              avatarUrl={agent.avatarUrl}
              organizationName={widgetView === "group" ? agent.organizationName : null}
              isCurrentUser={agent.id === userId}
            />
          ))}
        </ol>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/leaderboard")}
        className="w-full text-primary hover:text-primary/80 hover:bg-primary/5 rounded-xl text-xs font-bold uppercase tracking-widest"
      >
        View Full Standings
      </Button>
    </div>
  );
};

export default LeaderboardWidget;
