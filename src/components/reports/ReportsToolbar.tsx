import React from "react";
import { Download, RefreshCw, Settings2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CalendarRange, RangeProblem, ReportPreset } from "@/lib/reports-format";
import type { ReportRequestedScope, ReportScope } from "@/lib/reports-schemas";
import ReportScopeTabs from "./ReportScopeTabs";
import ReportPeriodControl from "./ReportPeriodControl";
import ReportContextLine from "./ReportContextLine";
import type { DataBasisContent } from "./DataBasisSections";

interface Props {
  scope: ReportScope | null;
  /** The scope is still resolving (the tabs hold their place). */
  scopeLoading?: boolean;
  scopeStatusText: string;
  onScope: (scope: ReportRequestedScope) => void;
  /** The scope tabpanel renders, so the tabs may reference it. */
  panelRendered?: boolean;
  preset: ReportPreset;
  onPreset: (p: ReportPreset) => void;
  customStart: string | null;
  customEnd: string | null;
  onCustomStart: (d: string | null) => void;
  onCustomEnd: (d: string | null) => void;
  range: CalendarRange | null;
  rangeProblem: RangeProblem;
  agentId: string | null;
  onAgent: (id: string | null) => void;
  editMode: boolean;
  /** Preferences must belong to the current viewer and have finished loading. */
  customizationReady?: boolean;
  onToggleEdit: () => void;
  onRefresh: () => void;
  canExport: boolean;
  exportReady: boolean;
  onExport: () => void;
  /** The current, non-withheld summary's `as_of`; null otherwise. */
  asOf?: string | null;
  /** Content of the Data basis sheet opened from the context line once the scope has resolved. */
  dataBasis?: DataBasisContent;
}

/** 40px icon buttons below sm (names stay in sr-only text), labelled 36px buttons from sm. */
const ACTION = "h-10 w-10 gap-2 rounded-lg px-0 sm:h-9 sm:w-auto sm:px-3";
const LABEL = "sr-only sm:not-sr-only";

/** Scope and dates stay visible above every personal layout; controls use resolved access. */
const ReportsToolbar: React.FC<Props> = (p) => {
  const multiAgent = p.scope !== null && p.scope.scope !== "own";
  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">Reports</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className={cn(ACTION, p.editMode && "border-primary/50 bg-primary/10 text-foreground")}
            onClick={p.onToggleEdit} disabled={!p.scope || !p.customizationReady}
            aria-label="Customize layout" aria-pressed={p.editMode}>
            <Settings2 aria-hidden="true" /><span className={LABEL}>Customize</span>
          </Button>
          {p.canExport && (
            <Button variant="outline" size="sm" className={ACTION} onClick={p.onExport}
              disabled={!p.exportReady} title={p.exportReady ? "Export the summary on screen" : "Export is available once the summary has loaded"}>
              <Download aria-hidden="true" /><span className={LABEL}>Export</span>
            </Button>
          )}
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg sm:h-9 sm:w-9"
            onClick={p.onRefresh} disabled={!p.scope} title="Refresh reports" aria-label="Refresh reports">
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <ReportScopeTabs scope={p.scope} onScope={p.onScope} loading={p.scopeLoading} panelRendered={p.panelRendered} />
        <ReportPeriodControl preset={p.preset} onPreset={p.onPreset} disabled={!p.scope}
          customStart={p.customStart} customEnd={p.customEnd} onCustomStart={p.onCustomStart} onCustomEnd={p.onCustomEnd}
          rangeProblem={p.rangeProblem} maxRangeDays={p.scope?.max_range_days ?? 366}>
          {multiAgent && p.scope && (
            <Select value={p.agentId ?? "all"} onValueChange={(v) => p.onAgent(v === "all" ? null : v)}>
              <SelectTrigger className="h-10 justify-start gap-2 rounded-lg bg-background text-sm sm:w-[200px]" aria-label="Agent filter">
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 text-left"><SelectValue /></span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{p.scope.scope === "team" ? "Whole team" : "All agents"}</SelectItem>
                {p.scope.agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.status && a.status !== "Active" ? " (" + a.status.toLowerCase() + ")" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </ReportPeriodControl>
      </div>

      <ReportContextLine scope={p.scope} scopeStatusText={p.scopeStatusText} range={p.range} asOf={p.asOf ?? null} dataBasis={p.dataBasis} />
    </header>
  );
};

export default ReportsToolbar;
