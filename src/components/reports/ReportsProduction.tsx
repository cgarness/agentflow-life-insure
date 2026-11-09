import React from "react";
import { PRODUCTION_KPIS } from "@/lib/reports-kpi-registry";
import { envelopeFor, type Panels } from "@/lib/reports-panels";
import KpiTile from "./KpiTile";

/** Section 1: Production (KPIs 1–4). Only the AP card carries the production accent. */
const ReportsProduction: React.FC<{ panels: Panels }> = ({ panels }) => (
  <section data-report-group="production" aria-labelledby="reports-production-title" className="space-y-3">
    <h2 id="reports-production-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Production</h2>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-[1.45fr_1fr_1fr_1fr]">
      {PRODUCTION_KPIS.map(id => (
        <KpiTile key={id} id={id} envelope={envelopeFor(panels, id)} size={id === 1 || id === 2 ? "hero" : "large"}
          className={id === 1 ? "col-span-2 xl:col-span-1 border-report-production/40 bg-gradient-to-br from-report-production/15 via-card to-card" : undefined} />
      ))}
    </div>
  </section>
);

export default ReportsProduction;
