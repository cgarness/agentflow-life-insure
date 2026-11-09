import React from "react";
import { cn } from "@/lib/utils";
import { SCALE_BG } from "@/lib/reports-scale";

interface Props { ranges: string[]; noActivityLabel: string; note?: string }

/** The single report legend (D6 §4.7, D5): unit-labelled ranges, a "no activity" swatch, and the agency-time note. */
const ScaleLegend: React.FC<Props> = ({ ranges, noActivityLabel, note }) => (
  <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-sm border border-border bg-muted" />{noActivityLabel}</li>
    {ranges.map((r, i) => (
      <li key={r} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("h-3 w-3 rounded-sm", SCALE_BG[i])} />{r}</li>
    ))}
    {note && <li>{note}</li>}
  </ul>
);

export default ScaleLegend;
