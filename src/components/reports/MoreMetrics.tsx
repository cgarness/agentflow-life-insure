import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { KPI_REGISTRY, MORE_GROUP_LABELS, MORE_GROUP_ORDER } from "@/lib/reports-kpi-registry";
import { envelopeFor, type Panels } from "@/lib/reports-panels";
import KpiTile from "./KpiTile";

/** The KPIs not in the strip, grouped Appointments / Journey / Time / Effort; open by default. */
const MoreMetrics: React.FC<{ panels: Panels; stripIds: readonly number[] }> = ({ panels, stripIds }) => {
  const [open, setOpen] = useState(true);
  const rest = KPI_REGISTRY.filter(k => (k.placement === "strip" || k.placement === "more") && !stripIds.includes(k.id));
  return (
    <div className="rounded-xl border border-border bg-card/50">
      <button type="button" aria-expanded={open} aria-controls="reports-more-metrics" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
        More metrics
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div id="reports-more-metrics" className="space-y-4 px-4 pb-4">
          {MORE_GROUP_ORDER.map(group => {
            const items = rest.filter(k => k.moreGroup === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">{MORE_GROUP_LABELS[group]}</h3>
                <div className={cn("grid gap-3", group === "time" ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-5" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5")}>
                  {items.map(k => <KpiTile key={k.id} id={k.id} envelope={envelopeFor(panels, k.id)} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MoreMetrics;
