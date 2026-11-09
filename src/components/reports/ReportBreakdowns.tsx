import React from "react";
import { roundHalfUp } from "@/lib/reports-kpi-format";
import { formatCount } from "@/lib/reports-format";
import ReportTableFrame from "./ReportTableFrame";
import { ROW_LABEL_WIDE, TD, TD_FIRST, TF, TF_FIRST, TH, TH_FIRST, TH_LABEL, TR } from "./reportTableStyles";

/** Zod infers optional fields under the app's non-strict config; the schema guarantees them at runtime. */
export interface CallCounts { calls_made?: number; contacted_calls?: number; contact_rate_numerator?: number; contact_rate_denominator?: number }
export interface CallRow extends CallCounts { key: string; label: string; extra?: (string | number | null)[] }

/** Call contact rate rounded once from the row's exact counts; blank when the denominator is 0 (D6 §4.6). */
export const callRate = (r: CallCounts) =>
  (r.contact_rate_denominator ?? 0) > 0 ? roundHalfUp((r.contact_rate_numerator ?? 0) * 100, r.contact_rate_denominator!, 1) : "";

interface TableProps {
  label: string;
  firstHeader: string;
  extraHeaders?: string[];
  rows: CallRow[];
  /** Reconciliation rows (RL-4, RL-49): shown in the footer so Calls made adds up to KPI 5. */
  footRows: CallRow[];
}

/** One call-only breakdown table: rows, then the reconciliation rows; no policy or premium column (D6-22). */
export function CallBreakdownTable({ label, firstHeader, extraHeaders = [], rows, footRows }: TableProps) {
  const cells = (r: CallRow) => [...(r.extra ?? []).map(v => v ?? ""), formatCount(r.calls_made ?? 0), formatCount(r.contacted_calls ?? 0),
    callRate(r) === "" ? "" : `${callRate(r)}%`];
  return (
    <ReportTableFrame label={`${label} table`} tableClassName="min-w-[34rem]">
        <thead>
          <tr>
            <th scope="col" className={TH_FIRST}>{firstHeader}</th>
            {[...extraHeaders, "Calls made", "Contacted calls", "Call contact rate"].map(h => (
              <th key={h} scope="col" className={TH}><span className={TH_LABEL}>{h}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className={TR}>
              <th scope="row" className={TD_FIRST}><span className={ROW_LABEL_WIDE}>{r.label}</span></th>
              {cells(r).map((c, i) => <td key={i} className={TD}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {footRows.length > 0 && (
          <tfoot>
            {footRows.map(r => (
              <tr key={r.key}>
                <th scope="row" className={TF_FIRST}>{r.label}</th>
                {cells(r).map((c, i) => <td key={i} className={TF}>{c}</td>)}
              </tr>
            ))}
          </tfoot>
        )}
    </ReportTableFrame>
  );
}

/** Section 7: Breakdowns, in the saved order (visibility and order are the customizer's). */
export default function ReportBreakdowns({ children }: { children: React.ReactNode }) {
  return (
    <section data-report-group="breakdowns" aria-labelledby="reports-breakdowns-title" className="min-w-0 space-y-4">
      <h2 id="reports-breakdowns-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Breakdowns</h2>
      {children}
    </section>
  );
}
