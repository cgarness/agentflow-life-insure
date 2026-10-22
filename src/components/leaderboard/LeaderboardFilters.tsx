import React from "react";
import { Monitor, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgencyGroupInfo } from "@/hooks/useAgencyGroup";
import type { Period, LeaderboardView } from "@/components/leaderboard/leaderboardTypes";
import { ANNUAL_PREMIUM_LABEL } from "@/components/leaderboard/leaderboardTypes";

interface LeaderboardFiltersProps {
  view: LeaderboardView;
  setView: (v: LeaderboardView) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  agencyGroup: AgencyGroupInfo | null;
  filterRefreshing: boolean;
  onEnterTvMode: () => void;
}

const toggleClass = (selected: boolean) =>
  `px-3 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
    selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
  }`;

const LeaderboardFilters: React.FC<LeaderboardFiltersProps> = ({
  view,
  setView,
  period,
  setPeriod,
  agencyGroup,
  filterRefreshing,
  onEnterTvMode,
}) => (
  <div className="relative z-20 flex items-center justify-between flex-wrap gap-3">
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
        {filterRefreshing && (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" aria-label="Refreshing" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">Ranked by {ANNUAL_PREMIUM_LABEL}</p>
    </div>
    <div className="flex items-center gap-3 flex-wrap">
      {agencyGroup && (
        <div className="flex bg-accent rounded-lg p-0.5">
          <button type="button" aria-pressed={view === "org"} onClick={() => setView("org")} className={toggleClass(view === "org")}>
            My Agency
          </button>
          <button type="button" aria-pressed={view === "group"} onClick={() => setView("group")} className={toggleClass(view === "group")}>
            {agencyGroup.groupName}
          </button>
        </div>
      )}
      <div className="flex bg-accent rounded-lg p-0.5">
        {(["Today", "This Week", "This Month"] as Period[]).map((t) => (
          <button key={t} type="button" aria-pressed={period === t} onClick={() => setPeriod(t)} className={toggleClass(period === t)}>
            {t}
          </button>
        ))}
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onEnterTvMode}
              className="h-9 w-9"
              aria-label="Full Screen Display Mode"
            >
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
