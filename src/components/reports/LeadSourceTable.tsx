import React from "react";
import { convertedBySourceNote } from "@/lib/reports-basis-text";
import { formatCount, formatRate } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import type { ReportLeadSources } from "@/lib/reports-schemas";
import ReportSection from "./ReportSection";
import ReportTableFrame from "./ReportTableFrame";
import { ROW_LABEL, TD, TD_FIRST, TF, TF_FIRST, TH, TH_FIRST, TH_LABEL, TR } from "./reportTableStyles";

interface Props {
  leadSources: ReportLeadSources;
  onExport?: ReportExportFn;
}

/** Screen columns. Converted is CSV-only: the server pins it unavailable, so on screen it would only say so. */
const HEADERS = [
  "Source",
  "New leads",
  "Calls made",
  "Contacted calls",
  "Call contact rate",
  "Leads dialed",
  "Contacted leads",
];

const EXPORT_HEADERS = [
  "Source",
  "New leads",
  "Calls made",
  "Contacted calls",
  "Call contact rate %",
  "Leads dialed",
  "Contacted leads",
  "Converted",
];

/**
 * Lead Source Performance — per-source activity from the secured lead-source RPC, in server order.
 * Converted-by-source is not measurable (conversion removes the source lead): one line says so and the
 * CSV keeps the empty column. Calls with no current lead stay visible as the "Not linked to a current
 * lead" row, even when no source has activity. There is no cost / ROI data and no conversion rate.
 */
const LeadSourceTable: React.FC<Props> = ({ leadSources, onExport }) => {
  const { sources, converted_unavailable_reason: convertedReason, unattributed_calls: unattributed } = leadSources;

  const handleExport = onExport
    ? () =>
        onExport(
          "Lead Source Performance",
          EXPORT_HEADERS,
          [...sources.map((s): CsvCell[] => [
            s.lead_source,
            s.new_leads,
            s.calls_made,
            s.contacted_calls,
            s.contact_rate_pct,
            s.leads_dialed,
            s.contacted_leads,
            null,
          ]), ["Attribution unavailable", null, unattributed, null, null, null, null, null]],
        )
    : undefined;

  return (
    <ReportSection title="Lead sources" onExport={handleExport}>
      {sources.length > 0 && <p className="mb-3 text-xs text-muted-foreground">{convertedBySourceNote(convertedReason)}</p>}
      {sources.length === 0 && (
        <p className={unattributed > 0 ? "mb-3 text-sm text-muted-foreground" : "py-12 text-center text-sm text-muted-foreground"}>
          No lead-source activity in this period.
        </p>
      )}
      {(sources.length > 0 || unattributed > 0) && (
        <ReportTableFrame label="Lead sources table" tableClassName="min-w-[720px]"
          caption="Outbound call activity by the current lead's source for the selected report.">
          <thead>
            <tr>
              {HEADERS.map((h, i) => (
                <th key={h} scope="col" className={i === 0 ? TH_FIRST : TH}><span className={TH_LABEL}>{h}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.lead_source} className={TR}>
                <th scope="row" className={TD_FIRST}><span className={ROW_LABEL}>{s.lead_source}</span></th>
                <td className={TD}>{formatCount(s.new_leads)}</td>
                <td className={TD}>{formatCount(s.calls_made)}</td>
                <td className={TD}>{formatCount(s.contacted_calls)}</td>
                <td className={TD}>{formatRate(s.contact_rate_pct)}</td>
                <td className={TD}>{formatCount(s.leads_dialed)}</td>
                <td className={TD}>{formatCount(s.contacted_leads)}</td>
              </tr>
            ))}
          </tbody>
          {unattributed > 0 && (
            <tfoot>
              {/* One cell per column: only calls can be counted without a current lead. */}
              <tr>
                <th scope="row" className={TF_FIRST}><span className={ROW_LABEL}>Not linked to a current lead</span></th>
                {HEADERS.slice(1).map((h) => <td key={h} className={TF}>{h === "Calls made" ? formatCount(unattributed) : null}</td>)}
              </tr>
            </tfoot>
          )}
        </ReportTableFrame>
      )}
    </ReportSection>
  );
};

export default LeadSourceTable;
