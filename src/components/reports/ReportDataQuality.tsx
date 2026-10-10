import type { ReportSummary } from "@/lib/reports-schemas";
import { DATA_QUALITY_LOADING, DATA_QUALITY_UNAVAILABLE, liveQualityNotes } from "@/lib/reports-basis-text";

/** The summary the Data basis may describe: "ready" only for the current, non-withheld payload. */
export type LiveSummary = { status: "loading" } | { status: "unavailable" } | { status: "ready"; data: ReportSummary };

/**
 * Live data quality inside the Data basis sheet. The counts are the summary CSV's own Note sentences, so the
 * screen and the export read the same; loading and failure say so in words and never show a digit or a zero.
 */
export default function ReportDataQuality({ summary }: { summary: LiveSummary }) {
  if (summary.status !== "ready") {
    return (
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground" data-report-quality={summary.status}>
        {summary.status === "loading" ? DATA_QUALITY_LOADING : DATA_QUALITY_UNAVAILABLE}
      </p>
    );
  }
  return (
    <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-relaxed tabular-nums text-muted-foreground" data-report-quality="ready">
      {liveQualityNotes(summary.data).map((note) => <li key={note}>{note}</li>)}
    </ul>
  );
}
