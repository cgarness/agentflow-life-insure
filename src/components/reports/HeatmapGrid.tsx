import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCount, formatRate } from "@/lib/reports-format";
import { cn } from "@/lib/utils";
import ReportTableFrame from "./ReportTableFrame";

export type HeatmapMetric = "calls" | "rate";

export interface HeatmapCell {
  hour: number;
  calls: number;
  contacted: number;
  /** Contacted ÷ calls made as a fraction; null when the hour had no calls. */
  rate: number | null;
}

export interface HeatmapRow {
  day: string;
  cells: HeatmapCell[];
}

interface Props {
  rows: HeatmapRow[];
  hours: number[];
  metric: HeatmapMetric;
  maxCalls: number;
  maxRate: number;
}

const hourName = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const hourShort = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const PIN = "sticky left-0 z-10 bg-card pr-2 text-left text-xs font-medium text-muted-foreground";

/** What a screen reader hears for one cell, whichever metric colours the grid. */
function cellText(day: string, cell: HeatmapCell): string {
  const rate = cell.rate === null ? "no call contact rate" : `${formatRate(cell.rate * 100)} call contact rate`;
  return `${day} ${hourName(cell.hour)}: ${formatCount(cell.calls)} ${cell.calls === 1 ? "call" : "calls"} made, ${formatCount(cell.contacted)} contacted, ${rate}`;
}

/**
 * HeatmapGrid — the calling heatmap as a real table (U-7): hours are column headers, days are pinned row
 * headers, and every cell carries its values as text for assistive technology, so the shade (the selected
 * metric relative to the busiest cell) is never the only way to read it. Every non-empty cell also shows its
 * number at every width (a tooltip never opens on touch), so a phone reads the values, not only the shade.
 * Cells holding sr-only text are `relative`, so that text stays inside the scroller instead of widening the page.
 */
const HeatmapGrid: React.FC<Props> = ({ rows, hours, metric, maxCalls, maxRate }) => {
  const intensity = (cell: HeatmapCell): number | null => {
    if (cell.calls === 0) return null;
    if (metric === "calls") return maxCalls > 0 ? cell.calls / maxCalls : null;
    return maxRate > 0 && cell.rate !== null ? cell.rate / maxRate : 0;
  };

  return (
    <TooltipProvider>
      <ReportTableFrame label="Calling heatmap table"
        caption={metric === "calls" ? "Calls made by day and agency hour" : "Call contact rate by day and agency hour"}
        tableClassName={cn("table-fixed border-spacing-[3px]", hours.length > 16 ? "min-w-[760px]" : "min-w-[520px]")}>
        <thead>
          <tr>
            <th scope="col" className={cn(PIN, "w-11")}><span className="sr-only">Day</span></th>
            {hours.map((h) => (
              <th key={h} scope="col" className="relative pb-1 text-center text-xs font-medium text-muted-foreground">
                <span aria-hidden="true">{hourShort(h)}</span><span className="sr-only">{hourName(h)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <th scope="row" className={PIN}>{row.day}</th>
              {row.cells.map((cell) => {
                const level = intensity(cell);
                const shown = metric === "calls" ? formatCount(cell.calls) : cell.rate === null ? "" : `${Math.round(cell.rate * 100)}%`;
                return (
                  <Tooltip key={cell.hour}>
                    <TooltipTrigger asChild>
                      <td className={cn("relative h-7 rounded-[3px] p-0 text-center align-middle md:h-8", level === null && "bg-muted",
                        level !== null && level > 0.55 ? "text-primary-foreground" : "text-foreground")}
                        // Shade = the selected metric relative to the busiest cell (data-driven).
                        style={level === null ? undefined : { backgroundColor: `hsl(var(--primary) / ${(0.12 + 0.88 * level).toFixed(3)})` }}>
                        <span className="sr-only">{cellText(row.day, cell)}</span>
                        {cell.calls > 0 && <span aria-hidden="true" className="text-[11px] font-medium tabular-nums">{shown}</span>}
                      </td>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="border-border bg-card text-xs text-foreground">
                      <p className="font-semibold">{row.day} {hourName(cell.hour)}</p>
                      <div className="mt-1 space-y-0.5 text-muted-foreground">
                        <p>Calls made: <span className="text-foreground tabular-nums">{formatCount(cell.calls)}</span></p>
                        <p>Contacted: <span className="text-foreground tabular-nums">{formatCount(cell.contacted)}</span></p>
                        <p>Call contact rate: <span className="text-foreground tabular-nums">{formatRate(cell.rate === null ? null : cell.rate * 100)}</span></p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </tr>
          ))}
        </tbody>
      </ReportTableFrame>
    </TooltipProvider>
  );
};

export default HeatmapGrid;
