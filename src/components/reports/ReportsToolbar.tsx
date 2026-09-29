/**
 * ReportsToolbar — header, period presets, custom range, agent filter, scope badge, Refresh, Export.
 *
 * The agent filter lists ONLY the agents `get_report_scope()` returned, so the page never offers a
 * filter the server would refuse. Presets are agency calendar days; the time zone is always shown.
 */
import React from "react";
import { BarChart3, CalendarIcon, Download, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PRESET_LABELS,
  calendarDateToPickerDate,
  longDateLabel,
  pickedDayToCalendarDate,
  type CalendarRange,
  type RangeProblem,
  type ReportPreset,
} from "@/lib/reports-format";
import type { ReportScope } from "@/lib/reports-schemas";

const SCOPE_BADGE: Record<ReportScope["scope"], string> = {
  own: "Your activity",
  team: "Your team",
  organization: "Organization",
};

interface Props {
  scope: ReportScope | null;
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
  onToggleEdit: () => void;
  onRefresh: () => void;
  canExport: boolean;
  exportReady: boolean;
  onExport: () => void;
}

const DatePick: React.FC<{ label: string; value: string | null; onChange: (d: string | null) => void }> = ({ label, value, onChange }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" className="hover:bg-background/50 h-8 px-3 rounded-lg font-semibold text-xs">
        <CalendarIcon className="w-3.5 h-3.5 mr-2 text-primary" />
        {value ? longDateLabel(value) : label}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar
        mode="single"
        selected={value ? calendarDateToPickerDate(value) : undefined}
        onSelect={(d) => onChange(d ? pickedDayToCalendarDate(d) : null)}
        className="p-3"
      />
    </PopoverContent>
  </Popover>
);

const ReportsToolbar: React.FC<Props> = (p) => {
  const tz = p.scope ? p.scope.time_zone : null;
  const multiAgent = p.scope !== null && p.scope.scope !== "own";

  return (
    <div className="relative overflow-hidden bg-card/60 backdrop-blur-xl border border-primary/10 rounded-[2.5rem] p-6 shadow-xl shadow-primary/5">
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20 border border-white/10">
            <BarChart3 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground leading-none mb-1.5">Performance Analytics</h1>
            <p className="text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">
              {p.scope ? SCOPE_BADGE[p.scope.scope] : "Loading your report scope…"}
              {tz ? ` · ${tz}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border/50">
            {(Object.keys(PRESET_LABELS) as ReportPreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => p.onPreset(preset)}
                disabled={!p.scope}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 disabled:opacity-50",
                  preset === p.preset
                    ? "bg-background text-foreground shadow-sm border border-border/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                )}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
          {p.canExport && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl h-10 px-4 font-semibold border-border/50"
              onClick={p.onExport}
              disabled={!p.exportReady}
              title={p.exportReady ? "Export the summary on screen" : "Export is available once the summary has loaded"}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="w-10 h-10 rounded-xl border border-border/50 text-muted-foreground"
            onClick={p.onRefresh}
            disabled={!p.scope}
            title="Refresh"
            aria-label="Refresh reports"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("w-10 h-10 rounded-xl border border-border/50", p.editMode ? "text-primary border-primary bg-primary/5" : "text-muted-foreground")}
            onClick={p.onToggleEdit}
            title="Customize Layout"
            aria-label="Customize layout"
          >
            <Settings2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {p.preset === "custom" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 bg-muted/30 p-2 rounded-xl border border-border/50 w-fit">
          <DatePick label="Start Date" value={p.customStart} onChange={p.onCustomStart} />
          <span className="text-muted-foreground/30 font-medium">/</span>
          <DatePick label="End Date" value={p.customEnd} onChange={p.onCustomEnd} />
          {p.rangeProblem === "order" && <span className="text-xs text-amber-500 font-medium">End date must be on or after the start date.</span>}
          {p.rangeProblem === "too_long" && <span className="text-xs text-amber-500 font-medium">Choose a range of up to {p.scope?.max_range_days ?? 366} days.</span>}
          {(!p.customStart || !p.customEnd) && <span className="text-xs text-muted-foreground">Pick both dates to run the report.</span>}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-6 pt-5 border-t border-border/50">
        {p.range && (
          <span className="text-xs text-muted-foreground font-medium" data-testid="report-period">
            {longDateLabel(p.range.startDate)} – {longDateLabel(p.range.endDate)}
          </span>
        )}
        {multiAgent && p.scope && (
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Agent</span>
            <Select value={p.agentId ?? "all"} onValueChange={(v) => p.onAgent(v === "all" ? null : v)}>
              <SelectTrigger className="w-[200px] h-8 bg-muted/30 border-border/50 text-foreground rounded-lg text-xs font-semibold" aria-label="Agent filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{p.scope.scope === "team" ? "Whole team" : "All agents"}</SelectItem>
                {p.scope.agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {a.status && a.status !== "Active" ? ` (${a.status.toLowerCase()})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsToolbar;
