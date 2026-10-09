import React, { useMemo, useState } from "react";
import { ratio } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportVolume } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import HeatmapGrid, { type HeatmapCell, type HeatmapMetric, type HeatmapRow } from "./HeatmapGrid";
import ReportSection from "./ReportSection";
import ReportSegmented from "./ReportSegmented";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const LEGEND_STEPS = ["bg-primary/20", "bg-primary/40", "bg-primary/60", "bg-primary/80", "bg-primary"];
const TABS: ReadonlyArray<readonly [HeatmapMetric, string]> = [["calls", "Calls made"], ["rate", "Call contact rate"]];

interface Props {
  volume: ReportVolume;
  onExport?: ReportExportFn;
}

const fmtHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

/**
 * Calling heatmap — outbound calls by weekday and agency hour (06:00–21:59 unless calls fall outside it),
 * shaded by calls made or by call contact rate. The grid is a semantic table (HeatmapGrid).
 */
const CallingHeatmap: React.FC<Props> = ({ volume, onExport }) => {
  const [tab, setTab] = useState<HeatmapMetric>("calls");

  const { grid, hours, maxCalls, maxRate, empty } = useMemo(() => {
    const cells: Omit<HeatmapCell, "hour">[][] = Array.from({ length: 7 }, () =>
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

  const rows = useMemo<HeatmapRow[]>(
    () => DAYS.map((day, di) => ({ day, cells: hours.map((hour) => ({ hour, ...grid[di][hour] })) })),
    [grid, hours],
  );

  const handleExport = onExport
    ? () =>
        onExport(
          "Calling Heatmap",
          ["Day", "Hour", "Calls made", "Contacted"],
          DAYS.flatMap((day, di) => hours.map((h) => [day, fmtHour(h), grid[di][h].calls, grid[di][h].contacted])),
        )
    : undefined;

  return (
    <ReportSection title="Calling heatmap" onExport={handleExport}>
      {empty ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No outbound calls in this period.</p>
      ) : (
        <>
          <ReportSegmented ariaLabel="Heatmap metric" value={tab} onChange={(next) => setTab(next)} options={TABS} className="mb-4" />
          <HeatmapGrid rows={rows} hours={hours} metric={tab} maxCalls={maxCalls} maxRate={maxRate} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-xs text-muted-foreground">Agency time ({volume.window.time_zone})</p>
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span>{tab === "calls" ? "Fewer calls" : "Lower rate"}</span>
              {LEGEND_STEPS.map((cls) => (
                <span key={cls} aria-hidden="true" className={cn("h-3.5 w-3.5 rounded-[3px]", cls)} />
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
