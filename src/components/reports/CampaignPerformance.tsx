import React from "react";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportCampaignCallsV3 } from "@/lib/reports-v3-schemas";
import ReportSection from "./ReportSection";
import { CallBreakdownTable, callRate, type CallRow } from "./ReportBreakdowns";

interface Props { campaigns: ReportCampaignCallsV3; onExport?: ReportExportFn }

/** Campaign performance (call-only, D6-22): visible campaigns, then "Calls without a campaign" and "Other campaigns"
 * (in-scope calls on campaigns the viewer cannot see: counts only, no name or type; RL-49). */
const CampaignPerformance: React.FC<Props> = ({ campaigns, onExport }) => {
  const rows: CallRow[] = campaigns.campaigns.map(c => ({ ...c, key: c.campaign_id, label: c.name, extra: [c.type] }));
  const foot: CallRow[] = [
    { ...campaigns.calls_without_campaign, key: "without", label: "Calls without a campaign", extra: [null] },
    { ...campaigns.other_campaigns, key: "other", label: "Other campaigns", extra: [null] },
  ];
  const handleExport = onExport && (() => onExport("Campaign performance", ["Campaign", "Type", "Calls", "Contacted calls", "Call contact rate %"],
    [...rows, ...foot].map(r => [r.label, (r.extra?.[0] as string | null) ?? null, r.calls_made, r.contacted_calls, callRate(r) || null])));
  return (
    <ReportSection title="Campaign performance" onExport={handleExport}>
      <CallBreakdownTable label="Campaign performance" firstHeader="Campaign" extraHeaders={["Type"]} rows={rows} footRows={foot} />
    </ReportSection>
  );
};

export default CampaignPerformance;
