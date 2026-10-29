import React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DashboardRefreshButton from "@/components/dashboard/DashboardRefreshButton";
import type { DashboardPerspective } from "@/lib/dashboard-scope";

export type DashboardTimeRange = "day" | "week" | "month" | "year";

interface DashboardControlsProps {
  role: string;
  timeRange: DashboardTimeRange;
  onTimeRangeChange: (range: DashboardTimeRange) => void;
  perspective: DashboardPerspective;
  onPerspectiveChange: (perspective: DashboardPerspective) => void;
  showRefresh: boolean;
  onRefresh: () => Promise<void>;
  editMode: boolean;
  onToggleEdit: () => void;
}

/** Period tabs, Perspective toggle, Refresh and Customize Layout — moved from `pages/Dashboard.tsx` unchanged. */
const DashboardControls: React.FC<DashboardControlsProps> = ({
  role,
  timeRange,
  onTimeRangeChange,
  perspective,
  onPerspectiveChange,
  showRefresh,
  onRefresh,
  editMode,
  onToggleEdit,
}) => {
  const perspectiveShadow = perspective === "team" ? "shadow-emerald-600/20" : "shadow-blue-600/20";

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-2">
      <div className="flex flex-wrap items-center gap-4">
        <div className="inline-flex p-1 bg-card shadow-sm rounded-2xl border border-border/40">
          <Tabs value={timeRange} onValueChange={(v) => onTimeRangeChange(v as DashboardTimeRange)} className="w-auto">
            <TabsList className="bg-transparent h-9 p-0 gap-1">
              {(["day", "week", "month", "year"] as const).map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="rounded-xl px-4 h-8 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {(role === "Admin" || role === "Team Leader") && (
          <div className="flex items-center gap-2 bg-card shadow-sm px-3 py-1.5 rounded-2xl border border-border/40">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mr-1">Perspective</span>
            <button
              type="button"
              onClick={() => onPerspectiveChange(perspective === "team" ? "my" : "team")}
              className={`px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all text-white border-2 shadow-lg ${perspectiveShadow} ${
                perspective === "team" ? "bg-emerald-600 border-emerald-500" : "bg-blue-600 border-blue-500"
              }`}
            >
              {perspective === "team" ? "Team Overview" : "Personal Stats"}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {showRefresh && <DashboardRefreshButton onRefresh={onRefresh} />}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleEdit}
          aria-pressed={editMode}
          className={`transition-all rounded-xl h-10 px-4 bg-card shadow-sm border-border ${
            editMode ? "text-primary border-primary bg-primary/5" : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <Pencil className="h-3.5 w-3.5 mr-2 text-primary" aria-hidden="true" />
          <span className="text-xs font-semibold">{editMode ? "Done Editing" : "Customize Layout"}</span>
        </Button>
      </div>
    </div>
  );
};

export default DashboardControls;
