import React from "react";
import type { ReportStateBreakdownV3 } from "@/lib/reports-v3-schemas";
import { modeUnit, modeValue, type RegionalMode } from "@/lib/reports-regional";
import { UNMAPPED_REASON_LABELS } from "@/lib/reports-v3-text";
import KpiStatusNote from "../KpiStatusNote";

/** The one conditional Regional helper line (A-L2): only when the mode's unmapped count is above 0. */
const UnmappedNotice: React.FC<{ data: ReportStateBreakdownV3; mode: RegionalMode }> = ({ data, mode }) => {
  const m = mode === "ap" ? "policies_sold" : mode;
  const n = modeValue(data.unmapped, m) ?? 0;
  if (n <= 0) return null;
  const lines = data.unmapped.reasons.filter(r => r[m] > 0).map(r => `${UNMAPPED_REASON_LABELS[r.reason]}: ${r[m].toLocaleString("en-US")}`);
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-report-helper="regional-unmapped">
      {n.toLocaleString("en-US")} {modeUnit(m, n)} not mapped to a state
      <KpiStatusNote label="Why" tone="progress" lines={lines} />
    </p>
  );
};

export default UnmappedNotice;
