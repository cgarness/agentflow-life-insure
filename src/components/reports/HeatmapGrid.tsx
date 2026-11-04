import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCount, formatRate } from "@/lib/reports-format";
import { cn } from "@/lib/utils";
import { roundHalfUp } from "@/lib/reports-kpi-format";
import { SCALE_BG, SCALE_TEXT } from "@/lib/reports-scale";
import { useGridNavigation } from "./useGridNavigation";
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
  const grid = useGridNavigation(rows.length, hours.length);
  const active = grid.pinned ?? grid.focus;
  const activeRow = rows[active.r], activeCell = activeRow?.cells[active.c];
  const intensity = (cell: HeatmapCell): number | null => {
    if (cell.calls === 0) return null;
    if (metric === "calls") return maxCalls > 0 ? cell.calls / maxCalls : null;
    return maxRate > 0 && cell.rate !== null ? cell.rate / maxRate : 0;
  };

  return (
    <TooltipProvider>
      <ReportTableFrame label="Calling heatmap table" focus="grid"
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
              {row.cells.map((cell, ci) => {
                const level = intensity(cell);
                // A cell rate is rounded once from the cell's exact counts (D6 §4.7); a cell with no calls shows nothing.
                const shown = metric === "calls" ? formatCount(cell.calls) : cell.calls > 0 ? `${roundHalfUp(cell.contacted * 100, cell.calls, 1)}%` : "";
                const bucket = level === null ? null : Math.min(4, Math.floor(level * 5 - 1e-9 < 0 ? 0 : level * 5 - 1e-9));
                return (
                  <Tooltip key={cell.hour}>
                    <TooltipTrigger asChild>
                      <td {...grid.cellProps(rows.indexOf(row), ci)} className={cn("relative h-7 rounded-[3px] p-0 text-center align-middle md:h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:ring-2 aria-selected:ring-foreground",
                        bucket === null ? "bg-muted text-foreground" : [SCALE_BG[bucket], SCALE_TEXT[bucket]])}>
                        <span className="sr-only">{cellText(row.day, cell)}</span>
                        {cell.calls > 0 && <span aria-hidden="true" className="text-[11px] font-medium tabular-nums">{shown}</span>}
                      </td>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="border-border bg-card text-xs text-foreground motion-reduce:animate-none motion-reduce:data-[state=closed]:animate-none">
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
      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-xs text-muted-foreground" data-heatmap-status>
        {activeRow && activeCell ? `${activeRow.day} ${hourName(activeCell.hour)} · ${formatCount(activeCell.calls)} calls made · ${formatCount(activeCell.contacted)} contacted`
          + (activeCell.calls > 0 ? ` · ${roundHalfUp(activeCell.contacted * 100, activeCell.calls, 1)}% call contact rate` : "") : ""}
      </p>
    </TooltipProvider>
  );
};

export default HeatmapGrid;
