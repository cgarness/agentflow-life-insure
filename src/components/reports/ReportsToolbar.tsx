import React from "react";
import { CalendarIcon, Download, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PRESET_LABELS, calendarDateToPickerDate, longDateLabel, pickedDayToCalendarDate,
  type CalendarRange, type RangeProblem, type ReportPreset,
} from "@/lib/reports-format";
import type { ReportRequestedScope, ReportScope } from "@/lib/reports-schemas";
import ReportScopeTabs from "./ReportScopeTabs";

const SCOPE_LABELS: Record<ReportScope["scope"], string> = {
  own: "Your activity", team: "Your team", organization: "Your agency",
};

interface Props {
  scope: ReportScope | null;
  scopeStatusText: string;
  onScope: (scope: ReportRequestedScope) => void;
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
  /** The Data basis trigger, shown in the status line once the scope has resolved. */
  dataBasis?: React.ReactNode;
}

const DatePick: React.FC<{ label: string; value: string | null; disabled: boolean; onChange: (d: string | null) => void }> = ({ label, value, disabled, onChange }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled} aria-label={label} className="h-9 gap-2 rounded-lg px-3 text-xs font-medium">
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {value ? longDateLabel(value) : label}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={value ? calendarDateToPickerDate(value) : undefined}
        onSelect={(d) => onChange(d ? pickedDayToCalendarDate(d) : null)} className="p-3" />
    </PopoverContent>
  </Popover>
);

/** Scope and dates stay visible above every personal layout; controls use resolved access. */
const ReportsToolbar: React.FC<Props> = (p) => {
  const multiAgent = p.scope !== null && p.scope.scope !== "own";
  return (
    <header className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Production and the activity behind it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className={cn("h-9 gap-2 rounded-lg", p.editMode && "border-primary text-primary")}
            onClick={p.onToggleEdit} disabled={!p.scope || !p.customizationReady}
            aria-label="Customize layout" aria-pressed={p.editMode}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />Customize
          </Button>
          {p.canExport && (
            <Button variant="outline" size="sm" className="h-9 gap-2 rounded-lg" onClick={p.onExport}
              disabled={!p.exportReady} title={p.exportReady ? "Export the summary on screen" : "Export is available once the summary has loaded"}>
              <Download className="h-4 w-4" aria-hidden="true" />Export
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-muted-foreground"
            onClick={p.onRefresh} disabled={!p.scope} title="Refresh reports" aria-label="Refresh reports">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ReportScopeTabs scope={p.scope} onScope={p.onScope} />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Report period">
            {(Object.keys(PRESET_LABELS) as ReportPreset[]).map((preset) => (
              <button key={preset} type="button" onClick={() => p.onPreset(preset)} disabled={!p.scope}
                aria-pressed={preset === p.preset}
                className={cn("rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  preset === p.preset ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
        </div>
        {p.preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <DatePick label="Start Date" value={p.customStart} disabled={!p.scope} onChange={p.onCustomStart} />
            <span className="text-sm text-muted-foreground">to</span>
            <DatePick label="End Date" value={p.customEnd} disabled={!p.scope} onChange={p.onCustomEnd} />
            {p.rangeProblem === "order" && <span className="text-xs text-amber-600 dark:text-amber-400">End date must be on or after the start date.</span>}
            {p.rangeProblem === "too_long" && <span className="text-xs text-amber-600 dark:text-amber-400">Choose a range of up to {p.scope?.max_range_days ?? 366} days.</span>}
            {(!p.customStart || !p.customEnd) && <span className="text-xs text-muted-foreground">Pick both dates to run the report.</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {p.range && <span className="font-medium text-foreground" data-testid="report-period">{longDateLabel(p.range.startDate)} – {longDateLabel(p.range.endDate)}</span>}
            <span>{p.scope ? SCOPE_LABELS[p.scope.scope] + " · " + p.scope.time_zone : p.scopeStatusText}</span>
            {p.scope && p.dataBasis}
          </div>
          {multiAgent && p.scope && (
            <div className="flex items-center gap-2">
              <span className="font-medium">Agent</span>
              <Select value={p.agentId ?? "all"} onValueChange={(v) => p.onAgent(v === "all" ? null : v)}>
                <SelectTrigger className="h-8 w-[200px] rounded-lg bg-background text-xs" aria-label="Agent filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{p.scope.scope === "team" ? "Whole team" : "All agents"}</SelectItem>
                  {p.scope.agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.status && a.status !== "Active" ? " (" + a.status.toLowerCase() + ")" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default ReportsToolbar;
