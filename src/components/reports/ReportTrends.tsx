import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import type { Grouping } from "@/lib/reports-format";
import ReportSegmented from "./ReportSegmented";

const GROUPINGS: ReadonlyArray<readonly [Grouping, string]> = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];
/** Fixed order; these two sections are not part of the saved layout. */
const TREND_SECTIONS = ["policies_sold", "call_volume"] as const;

interface Props {
  sections: Record<string, ReactNode>;
  grouping: Grouping;
  onGroupingChange: (grouping: Grouping) => void;
}

/**
 * Trends (fixed; unregistered). One Daily / Weekly / Monthly control regroups both trend cards, so it sits
 * beside the heading rather than inside one card. Weeks start on Monday in the agency time zone. A trend
 * section that was not built is skipped rather than leaving an empty cell.
 */
export default function ReportTrends({ sections, grouping, onGroupingChange }: Props) {
  return (
    <section aria-labelledby="report-trends-title" data-report-group="trends" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="report-trends-title" className="text-base font-semibold tracking-tight">Trends</h2>
        <ReportSegmented ariaLabel="Group trends by" value={grouping} onChange={onGroupingChange} options={GROUPINGS} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
        {TREND_SECTIONS.filter((id) => sections[id] != null).map((id) => (
          <div key={id} className="min-w-0" data-report-section={id}>{sections[id]}</div>
        ))}
      </div>
    </section>
  );
}

const PANEL_HEIGHT = { main: "h-[176px] md:h-[220px]", companion: "h-24 md:h-28" } as const;

/**
 * One single-axis trend panel with its metric caption, sized by CSS rather than a JS breakpoint: main
 * 176px (220px from md), companion 96px (112px from md). The caption names the metric, so no axis legend.
 */
export function TrendPanel({ caption, size, children }: { caption: string; size: keyof typeof PANEL_HEIGHT; children: ReactElement }) {
  return (
    <div className={size === "companion" ? "mt-3" : undefined}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{caption}</p>
      <div className={PANEL_HEIGHT[size]}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}

/** A companion panel keeps its crosshair and active dot; the readout shows in the synced main panel. */
export function NoTooltip(): null {
  return null;
}
