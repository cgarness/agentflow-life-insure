import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { formatCount, formatRate, formatPremium } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import { CAMPAIGN_LINEAGE_NOTE } from "@/lib/reports-policy-text";
import type { ReportCampaigns } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import CampaignCallsChart from "./CampaignCallsChart";
import CampaignTotalsFoot from "./CampaignTotalsFoot";
import ReportSection from "./ReportSection";
import ReportTableFrame from "./ReportTableFrame";
import { ROW_LABEL_WIDE, TD, TD_FIRST, TH, TH_FIRST, TH_LABEL, TR } from "./reportTableStyles";

const CHART_TOP_N = 10;
/** Screen order: production first, so policies and premium are visible without scrolling. */
const COLUMNS = [
  "Campaign", "Policies (campaign-attributed)", "Known annual premium", "Known / total policies", "Calls made",
  "Contacted calls", "Call contact rate", "Leads dialed", "Contacted leads", "Converted leads", "Type",
] as const;
/** The CSV keeps its original column order and values. */
const EXPORT_HEADERS = [
  "Campaign", "Type", "Calls made", "Contacted calls", "Call contact rate %", "Leads dialed", "Contacted leads",
  "Converted leads", "Policies (campaign-attributed)", "Known annual premium", "Known / total policies",
];
/** A real link (U-3): text-sized, with a 40px hit area that reaches into the cell padding, and a visible focus ring. */
const LINK = "relative rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-x-0 after:-inset-y-2.5";

interface Props {
  campaigns: ReportCampaigns;
  onExport?: ReportExportFn;
}

const CampaignPerformance: React.FC<Props> = ({ campaigns, onExport }) => {
  const rows = campaigns.campaigns;
  // Server order is calls_made DESC; the chart shows the busiest campaigns that placed calls.
  const chartData = useMemo(() => rows.filter((c) => c.calls_made > 0).slice(0, CHART_TOP_N), [rows]);
  const unavailable = campaigns.calls_attribution_unavailable > 0 || campaigns.policies_attribution_unavailable > 0;
  const handleExport = onExport
    ? () =>
        onExport(
          "Campaign Performance",
          EXPORT_HEADERS,
          [...rows.map((c) => [
            c.name,
            c.type,
            c.calls_made,
            c.contacted_calls,
            c.contact_rate_pct,
            c.leads_dialed,
            c.contacted_leads,
            c.converted_leads,
            c.attributed_policies, c.premium.annual_premium, `${c.premium.known_count}/${c.premium.policy_count}`,
          ]), ["Attribution unavailable", null, campaigns.calls_attribution_unavailable, null, null, null, null, null, campaigns.policies_attribution_unavailable, campaigns.premium_attribution_unavailable.annual_premium, `${campaigns.premium_attribution_unavailable.known_count}/${campaigns.premium_attribution_unavailable.policy_count}`]],
        )
    : undefined;
  return (
    <ReportSection title="Campaign performance" onExport={handleExport}>
      {rows.length === 0 && (
        <p className={unavailable ? "mb-3 text-sm text-muted-foreground" : "py-12 text-center text-sm text-muted-foreground"}>
          No visible campaign breakdown in this period.
        </p>
      )}
      {chartData.length > 0 && <CampaignCallsChart data={chartData} />}
      {(rows.length > 0 || unavailable) && (
        <>
          <ReportTableFrame label="Campaign performance table" tableClassName="min-w-[960px]"
            caption="Campaign activity and campaign-attributed policies for the selected report. Each campaign name opens that campaign.">
            <thead>
              <tr>
                {COLUMNS.map((label, i) => (
                  <th key={label} scope="col" className={i === 0 ? TH_FIRST : label === "Type" ? cn(TH, "text-left") : TH}>
                    <span className={TH_LABEL}>{label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.campaign_id} className={TR}>
                  <th scope="row" className={TD_FIRST}>
                    <span className={ROW_LABEL_WIDE}><Link to={`/campaigns/${c.campaign_id}`} className={LINK}>{c.name}</Link></span>
                  </th>
                  <td className={TD}>{formatCount(c.attributed_policies)}</td>
                  <td className={TD}>{formatPremium(c.premium.annual_premium)}</td>
                  <td className={TD}>{c.premium.known_count}/{c.premium.policy_count}</td>
                  <td className={TD}>{formatCount(c.calls_made)}</td>
                  <td className={TD}>{formatCount(c.contacted_calls)}</td>
                  <td className={TD}>{formatRate(c.contact_rate_pct)}</td>
                  <td className={TD}>{formatCount(c.leads_dialed)}</td>
                  <td className={TD}>{formatCount(c.contacted_leads)}</td>
                  <td className={TD}>{formatCount(c.converted_leads)}</td>
                  <td className={cn(TD, "text-left text-xs text-muted-foreground")}>{c.type}</td>
                </tr>
              ))}
            </tbody>
            {unavailable && <CampaignTotalsFoot campaigns={campaigns} columns={COLUMNS} />}
          </ReportTableFrame>
          <p className="mt-3 text-xs text-muted-foreground">{CAMPAIGN_LINEAGE_NOTE}</p>
        </>
      )}
    </ReportSection>
  );
};
export default CampaignPerformance;
