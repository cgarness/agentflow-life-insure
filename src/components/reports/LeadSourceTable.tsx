import React from "react";
import { Info } from "lucide-react";
import { formatCount, formatRate } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import type { ReportLeadSources } from "@/lib/reports-schemas";
import ReportSection from "./ReportSection";

interface Props {
  leadSources: ReportLeadSources;
  onExport?: ReportExportFn;
}

const HEADERS = [
  "Source",
  "New leads",
  "Calls made",
  "Contacted calls",
  "Contact rate",
  "Leads dialed",
  "Contacted leads",
  "Converted",
];

const EXPORT_HEADERS = [
  "Source",
  "New leads",
  "Calls made",
  "Contacted calls",
  "Contact rate %",
  "Leads dialed",
  "Contacted leads",
  "Converted",
];

const th = "py-3 px-4 text-muted-foreground font-bold uppercase tracking-wider text-[11px] whitespace-nowrap";
const td = "py-3 px-4 text-right text-muted-foreground font-medium tabular-nums";

/**
 * Lead Source Performance — per-source activity from the secured lead-source RPC, in server order.
 * Converted-by-source is not measurable (conversion removes the source lead), so the column says so
 * instead of showing a number. There is no cost / ROI data and no conversion rate.
 */
const LeadSourceTable: React.FC<Props> = ({ leadSources, onExport }) => {
  const { sources, converted_unavailable_reason: convertedReason, unattributed_calls: unattributed } = leadSources;

  const handleExport = onExport
    ? () =>
        onExport(
          "Lead Source Performance",
          EXPORT_HEADERS,
          sources.map((s): CsvCell[] => [
            s.lead_source,
            s.new_leads,
            s.calls_made,
            s.contacted_calls,
            s.contact_rate_pct,
            s.leads_dialed,
            s.contacted_leads,
            null,
          ]),
        )
    : undefined;

  return (
    <ReportSection title="Lead Source Performance" onExport={handleExport}>
      <p className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <Info className="w-3.5 h-3.5 text-primary shrink-0" />
        Cost and ROI tracking are not available yet.
      </p>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No lead-source activity in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="border-b border-border/60">
                {HEADERS.map((h, i) => (
                  <th key={h} className={`${th} ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {sources.map((s) => (
                <tr key={s.lead_source} className="hover:bg-muted/40 transition-colors">
                  <td className="py-3 px-4 font-bold text-foreground">{s.lead_source}</td>
                  <td className={td}>{formatCount(s.new_leads)}</td>
                  <td className={td}>{formatCount(s.calls_made)}</td>
                  <td className={td}>{formatCount(s.contacted_calls)}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {s.contact_rate_pct !== null && (
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(Math.max(s.contact_rate_pct, 0), 100)}%` }}
                          />
                        </div>
                      )}
                      <span className="font-bold text-foreground tabular-nums w-14 text-right">
                        {formatRate(s.contact_rate_pct)}
                      </span>
                    </div>
                  </td>
                  <td className={td}>{formatCount(s.leads_dialed)}</td>
                  <td className={td}>{formatCount(s.contacted_leads)}</td>
                  <td className="py-3 px-4 text-right">
                    <span
                      className="text-[11px] font-medium text-muted-foreground cursor-help underline decoration-dotted underline-offset-2 whitespace-nowrap"
                      title={convertedReason}
                    >
                      Not available
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sources.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">Converted by source is not available: {convertedReason}</p>
      )}
      {unattributed > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          {formatCount(unattributed)} outbound calls are not linked to a current lead (for example, leads that were
          converted), so they are not attributed to a source.
        </p>
      )}
    </ReportSection>
  );
};

export default LeadSourceTable;
