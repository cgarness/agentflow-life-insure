import React from "react";
import { formatCount } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportLeadSourceCallsV3 } from "@/lib/reports-v3-schemas";
import ReportSection from "./ReportSection";
import { CallBreakdownTable, callRate, type CallRow } from "./ReportBreakdowns";

interface Props { leadSources: ReportLeadSourceCallsV3; onExport?: ReportExportFn }

/** Lead sources (call-only, D6-22): each source's new leads and calls, then "Not linked to a current lead"
 * (call columns only, New leads blank), so Calls adds up to KPI 5. */
const LeadSourceTable: React.FC<Props> = ({ leadSources, onExport }) => {
  const rows: CallRow[] = leadSources.sources.map(s => ({ ...s, key: s.lead_source, label: s.lead_source, extra: [formatCount(s.new_leads)] }));
  const foot: CallRow[] = [{ ...leadSources.not_linked, key: "not-linked", label: "Not linked to a current lead", extra: [null] }];
  const handleExport = onExport && (() => onExport("Lead source performance", ["Source", "New leads", "Calls", "Contacted calls", "Call contact rate %"],
    [...leadSources.sources.map(s => [s.lead_source, s.new_leads, s.calls_made, s.contacted_calls, callRate(s) || null] as (string | number | null)[]),
     ["Not linked to a current lead", null, leadSources.not_linked.calls_made, leadSources.not_linked.contacted_calls, callRate(leadSources.not_linked) || null]]));
  return (
    <ReportSection title="Lead sources" onExport={handleExport}>
      <CallBreakdownTable label="Lead sources" firstHeader="Source" extraHeaders={["New leads"]} rows={rows} footRows={foot} />
    </ReportSection>
  );
};

export default LeadSourceTable;
