import React from "react";
import { envelopeFor, type Panels } from "@/lib/reports-panels";
import KpiTile from "./KpiTile";

/** The registered activity strip (layout v5 default: 5, 6, 7, 8, 15). */
const ActivityStrip: React.FC<{ panels: Panels; ids: readonly number[] }> = ({ panels, ids }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" data-report-strip>
    {ids.map(id => <KpiTile key={id} id={id} envelope={envelopeFor(panels, id)} />)}
  </div>
);

export default ActivityStrip;
