import React from "react";
import { Monitor, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgencyGroupInfo } from "@/hooks/useAgencyGroup";
import type { Period, Metric, LeaderboardView } from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardFiltersProps {
  view: LeaderboardView;
  setView: (v: LeaderboardView) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  metric: Metric;
  setMetric: (m: Metric) => void;
  agencyGroup: AgencyGroupInfo | null;
  filterRefreshing: boolean;
  onEnterTvMode: () => void;
}

const LeaderboardFilters: React.FC<LeaderboardFiltersProps> = ({
  view,
  setView,
  period,
  setPeriod,
  metric,
  setMetric,
  agencyGroup,
  filterRefreshing,
  onEnterTvMode,
}) => (
  <div className="flex items-center justify-between flex-wrap gap-3">
    <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
      {filterRefreshing && (
        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" aria-label="Refreshing" />
      )}
    </div>
    <div className="flex items-center gap-3 flex-wrap">
      {agencyGroup && (
        <div className="flex bg-accent rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setView("org")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === "org" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            My Agency
          </button>
          <button
            type="button"
            onClick={() => setView("group")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === "group" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {agencyGroup.groupName}
          </button>
        </div>
      )}
      <div className="flex bg-accent rounded-lg p-0.5">
        {(["Today", "This Week", "This Month"] as Period[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setPeriod(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <select
        value={metric}
        onChange={(e) => setMetric(e.target.value as Metric)}
        className="h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50"
      >
        <option>Policies Sold</option>
        <option>Calls Made</option>
        <option>Appointments Set</option>
        <option>Talk Time</option>
        <option>Conversion Rate</option>
      </select>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={onEnterTvMode} className="h-9 w-9">
              <Monitor className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Full Screen Display Mode</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
);

export default LeaderboardFilters;
