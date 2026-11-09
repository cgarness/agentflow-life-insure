import React from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_STRIP_KPIS, HIGHLIGHT_KPIS, kpi } from "@/lib/reports-kpi-registry";
import { envelopeFor, type Panels } from "@/lib/reports-panels";
import { PERIOD_AVERAGES_NOTE } from "@/lib/reports-v3-text";
import KpiTile from "./KpiTile";
import ActivityStrip from "./ActivityStrip";
import MoreMetrics from "./MoreMetrics";

const ACCENT = { appointment: "border-report-appointment/40", close: "border-report-close/40", production: "", } as const;

/** Section 2: Activity and sales effort — highlights (9, 10, 12, 38), the Period averages line, strip and More. */
const ReportsEffortSection: React.FC<{ panels: Panels; stripIds?: readonly number[] }> = ({ panels, stripIds = DEFAULT_STRIP_KPIS }) => (
  <section data-report-group="effort" aria-labelledby="reports-effort-title" className="space-y-3">
    <h2 id="reports-effort-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activity and sales effort</h2>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {HIGHLIGHT_KPIS.map(id => {
        const accent = kpi(id).accent;
        return <KpiTile key={id} id={id} envelope={envelopeFor(panels, id)} size="large" className={cn(accent && ACCENT[accent])} />;
      })}
    </div>
    <p className="text-xs text-muted-foreground" data-report-helper="period-averages">{PERIOD_AVERAGES_NOTE}</p>
    <ActivityStrip panels={panels} ids={stripIds} />
    <MoreMetrics panels={panels} stripIds={stripIds} />
  </section>
);

export default ReportsEffortSection;
