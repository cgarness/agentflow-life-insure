import type { ReportSummary } from "@/lib/reports-schemas";
import { PREMIUM_BASIS, premiumNote, qualityNotes } from "@/lib/reports-integrity-text";
export default function ReportDataQuality({ summary }: { summary: ReportSummary }) {
  return <details className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer font-semibold">Report basis and data quality</summary>
    <div className="mt-3 space-y-2">
      <p>{premiumNote(summary.totals.premium)}</p><p>{PREMIUM_BASIS}</p>
      {qualityNotes(summary.quality).map((note) => <p key={note}>{note}</p>)}
      <p>{summary.totals.session_matched_calls} calls matched same-agent/campaign session intervals; {summary.totals.session_unmatched_calls} unmatched calls stay in Calls Made.</p>
      <p>Summary as of {summary.as_of}. Each panel is calculated independently.</p>
    </div>
  </details>;
}
