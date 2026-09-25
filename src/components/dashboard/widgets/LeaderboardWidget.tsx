import React from "react";
import { AlertTriangle, PauseCircle, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LeaderboardPreviewRow from "@/components/dashboard/widgets/LeaderboardPreviewRow";
import { LeaderboardRetryButton } from "@/components/leaderboard/LeaderboardErrorBanner";
import { useTimeReached } from "@/hooks/useTimeReached";
import { useLeaderboardWidgetStandings } from "@/hooks/useLeaderboardWidgetStandings";
import { formatStatusTime, standingsDetail } from "@/lib/leaderboardStatusCopy";

interface LeaderboardWidgetProps {
  userId: string;
  organizationId?: string | null;
  /** Incremented by the Dashboard's Refresh control; one bounded manual run per increment. */
  refreshSignal?: number;
}

const LeaderboardWidget: React.FC<LeaderboardWidgetProps> = ({ userId, organizationId = null, refreshSignal }) => {
  const navigate = useNavigate();
  const { agencyGroup, widgetView, setWidgetView, ranked, loading, loadError, status, refreshHeldUntil, retry } =
    useLeaderboardWidgetStandings(userId, organizationId, refreshSignal);
  const refreshHeldOver = useTimeReached(refreshHeldUntil);
  const live = status.kind === "ok";
  const paused = status.kind === "maintenance" || status.kind === "busy";
  const Icon = paused ? PauseCircle : AlertTriangle;

  if (loading && ranked.length === 0) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const viewToggle = agencyGroup && (
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
  );

  // Failure with nothing for this view on screen: an error, never a fake empty/zero board.
  if (!live && ranked.length === 0) {
    const detail = standingsDetail(status, false, Date.now());
    return (
      <div role="status" aria-live="polite" className="text-center py-10 flex flex-col items-center gap-3">
        {viewToggle}
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-1">
          <Icon className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">{loadError}</p>
        {paused && detail && <p className="text-xs text-muted-foreground max-w-xs">{detail}</p>}
        <LeaderboardRetryButton onRetry={retry} availableAt={status.manualAvailableAt} className="text-xs" />
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
        {refreshHeldUntil !== null && !refreshHeldOver && (
          <p role="status" className="mt-2 text-[10px] text-muted-foreground">
            Standings can refresh again at {formatStatusTime(refreshHeldUntil)}.
          </p>
        )}
      </div>
    );
  }

  // Presentation-only safeguard: zero-sale agents only tie, and the canonical
  // tie-break is alphabetical — never dress that up as a #1/#2/#3. They always
  // sort after every agent with a sale, so the ranks shown stay canonical.
  const top3 = ranked.filter((a) => a.wins > 0).slice(0, 3);
  const noSalesYet = top3.length === 0;
  const asOf = status.lastUpdatedAt !== null ? formatStatusTime(status.lastUpdatedAt) : null;

  return (
    <div className="space-y-4">
      {!live && (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <Icon className="w-3 h-3" />
          <span>
            {status.kind === "error" ? "Refresh failed" : loadError?.replace(/\.$/, "")}
            {asOf ? ` — showing results from ${asOf}.` : " — standings may be out of date."}
          </span>
          <LeaderboardRetryButton
            onRetry={retry}
            availableAt={status.manualAvailableAt}
            className="h-6 px-2 text-[10px]"
          />
        </div>
      )}
      {live && refreshHeldUntil !== null && !refreshHeldOver && (
        <p role="status" className="text-center text-[10px] text-muted-foreground">
          Standings can refresh again at {formatStatusTime(refreshHeldUntil)}.
        </p>
      )}
      {viewToggle}
      {noSalesYet ? (
        <p className="py-6 rounded-xl bg-muted/30 text-center text-sm font-medium text-muted-foreground">
          {!live && asOf ? `No sales recorded as of ${asOf}.` : "No sales recorded yet this month."}
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
