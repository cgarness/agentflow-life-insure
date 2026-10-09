import React from "react";
import { formatCount, formatPremium } from "@/lib/reports-format";
import type { ReportCampaigns } from "@/lib/reports-schemas";
import { ROW_LABEL_WIDE, TD_SUB, TF, TF_FIRST } from "./reportTableStyles";

interface Props {
  campaigns: ReportCampaigns;
  /** The table's screen columns in order; the first is the row label. */
  columns: readonly string[];
}

/**
 * The "Attribution unavailable" row: the calls and policies no visible campaign can claim, so the
 * campaign rows plus this row reconcile with the period on screen. One cell per column; measures that do
 * not apply to unattributed activity are blank, never "—", so they never read as a zero denominator.
 */
const CampaignTotalsFoot: React.FC<Props> = ({ campaigns, columns }) => {
  const p = campaigns.premium_attribution_unavailable;
  const values: Record<string, string> = {
    "Policies (campaign-attributed)": formatCount(campaigns.policies_attribution_unavailable),
    "Known annual premium": formatPremium(p.annual_premium),
    "Known / total policies": `${p.known_count}/${p.policy_count}`,
    "Calls made": formatCount(campaigns.calls_attribution_unavailable),
  };
  return (
    <tfoot>
      <tr>
        <th scope="row" className={TF_FIRST}>
          <span className={ROW_LABEL_WIDE}>
            Attribution unavailable
            <span className={TD_SUB}>Missing, ambiguous or restricted</span>
          </span>
        </th>
        {columns.slice(1).map((column) => <td key={column} className={TF}>{values[column] ?? null}</td>)}
      </tr>
    </tfoot>
  );
};

export default CampaignTotalsFoot;
