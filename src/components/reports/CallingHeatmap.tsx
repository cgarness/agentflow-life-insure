import React, { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCount, formatRate, ratio, timeZoneLabel } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportVolume } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const LEGEND_STEPS = ["bg-primary/20", "bg-primary/40", "bg-primary/60", "bg-primary/80", "bg-primary"];

type Tab = "calls" | "rate";
const TABS: { key: Tab; label: string }[] = [
  { key: "calls", label: "Calls made" },
  { key: "rate", label: "Contact rate" },
];

interface Props {
  volume: ReportVolume;
  onExport?: ReportExportFn;
}

interface Cell {
  calls: number;
  contacted: number;
  rate: number | null;
}

const fmtHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const fmtHourShort = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;

const CallingHeatmap: React.FC<Props> = ({ volume, onExport }) => {
  const [tab, setTab] = useState<Tab>("calls");

  const { grid, hours, maxCalls, maxRate, empty } = useMemo(() => {
    const cells: Cell[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ calls: 0, contacted: 0, rate: null })),
    );
    let outside = false;
    let total = 0;
    for (const c of volume.heatmap) {
      cells[c.dow][c.hour] = { calls: c.calls_made, contacted: c.contacted, rate: ratio(c.contacted, c.calls_made) };
      total += c.calls_made;
      if (c.calls_made > 0 && (c.hour < 6 || c.hour > 21)) outside = true;
    }
    const shown = outside ? ALL_HOURS : DEFAULT_HOURS;
    let mc = 0;
    let mr = 0;
    for (const row of cells) {
      for (const h of shown) {
        mc = Math.max(mc, row[h].calls);
        mr = Math.max(mr, row[h].rate ?? 0);
      }
    }
    return { grid: cells, hours: shown, maxCalls: mc, maxRate: mr, empty: total === 0 };
  }, [volume]);

  const handleExport = onExport
    ? () =>
        onExport(
          "Calling Heatmap",
          ["Day", "Hour", "Calls made", "Contacted"],
          DAYS.flatMap((day, di) => hours.map((h) => [day, fmtHour(h), grid[di][h].calls, grid[di][h].contacted])),
        )
    : undefined;

  const intensity = (cell: Cell): number | null => {
    if (cell.calls === 0) return null;
    if (tab === "calls") return maxCalls > 0 ? cell.calls / maxCalls : null;
    return maxRate > 0 && cell.rate !== null ? cell.rate / maxRate : 0;
  };

  const tzCaption = `Hours are in the agency time zone: ${timeZoneLabel(volume.window.time_zone, volume.window.time_zone_source)}.`;

  return (
    <ReportSection title="Calling Heatmap" badge="Activity" onExport={handleExport}>
      {empty ? (
        <p className="text-sm text-muted-foreground text-center py-12">No calls in this period.</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-5 p-1 bg-muted/60 rounded-xl w-fit" role="group" aria-label="Heatmap metric">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.key === tab}
                onClick={() => setTab(t.key)}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all",
                  t.key === tab ? "bg-card text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <TooltipProvider>
            <div className="overflow-x-auto pb-2">
              <div className={hours.length > 16 ? "min-w-[760px]" : "min-w-[520px]"}>
                <div className="flex mb-2 ml-10 gap-1">
                  {hours.map((h) => (
                    <div key={h} className="flex-1 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">
                      {fmtHourShort(h)}
                    </div>
                  ))}
                </div>
                {DAYS.map((day, di) => (
                  <div key={day} className="flex items-center mb-1">
                    <span className="w-10 text-[11px] font-bold text-muted-foreground uppercase shrink-0">{day}</span>
                    <div className="flex flex-1 gap-1">
                      {hours.map((h) => {
                        const cell = grid[di][h];
                        const level = intensity(cell);
                        const label = tab === "calls" ? formatCount(cell.calls) : cell.rate === null ? "" : `${Math.round(cell.rate * 100)}%`;
                        return (
                          <Tooltip key={h}>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "flex-1 aspect-square rounded-[3px] flex items-center justify-center cursor-default transition-transform hover:scale-110 hover:z-10",
                                  level === null && "bg-muted",
                                )}
                                style={level === null ? undefined : { backgroundColor: `hsl(var(--primary) / ${(0.12 + 0.88 * level).toFixed(3)})` }}
                              >
                                {cell.calls > 0 && (
                                  <span className={cn("text-[9px] font-black", level !== null && level > 0.55 ? "text-primary-foreground" : "text-foreground/70")}>
                                    {label}
                                  </span>
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs font-bold bg-card text-foreground border-border">
                              <p>
                                {day} {fmtHour(h)}
                              </p>
                              <div className="mt-1 space-y-0.5 text-muted-foreground">
                                <p>Calls made: <span className="text-foreground">{formatCount(cell.calls)}</span></p>
                                <p>Contacted: <span className="text-foreground">{formatCount(cell.contacted)}</span></p>
                                <p>
                                  Contact rate: <span className="text-foreground">{formatRate(cell.rate === null ? null : cell.rate * 100)}</span>
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TooltipProvider>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">{tzCaption}</p>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>{tab === "calls" ? "Fewer calls" : "Lower rate"}</span>
              {LEGEND_STEPS.map((cls) => (
                <span key={cls} className={cn("w-3.5 h-3.5 rounded-[3px]", cls)} />
              ))}
              <span>{tab === "calls" ? "More calls" : "Higher rate"}</span>
            </div>
          </div>
        </>
      )}
    </ReportSection>
  );
};

export default CallingHeatmap;
