import { formatAsOf, longDateLabel, type CalendarRange } from "@/lib/reports-format";
import type { ReportScope } from "@/lib/reports-schemas";
import { DataBasisButton } from "./ReportDataBasis";
import type { DataBasisContent } from "./DataBasisSections";

interface Props {
  scope: ReportScope | null;
  /** Shown instead of the context while the scope is loading or failed. */
  scopeStatusText: string;
  range: CalendarRange | null;
  /** The summary's own `as_of`, only while that summary is ready, current and not withheld. Never cached. */
  asOf: string | null;
  dataBasis?: DataBasisContent;
}

/**
 * Period · agency time zone · "Summary as of" · Data basis. The selected scope tab names the scope, so
 * the line does not repeat it. Panels are independent responses, so the time is labelled as the summary's.
 */
export default function ReportContextLine({ scope, scopeStatusText, range, asOf, dataBasis }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pb-3 text-xs text-muted-foreground">
      {!scope ? <span>{scopeStatusText}</span> : (
        <>
          {range && (
            <>
              <span className="font-medium tabular-nums text-foreground" data-testid="report-period">{longDateLabel(range.startDate)} – {longDateLabel(range.endDate)}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{scope.time_zone}</span>
          {asOf && (
            <>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span data-testid="report-as-of">
                Summary as of <time dateTime={asOf} className="tabular-nums">{formatAsOf(asOf, scope.time_zone, scope.today)}</time>
              </span>
            </>
          )}
          {dataBasis && <DataBasisButton {...dataBasis} className="ml-auto" />}
        </>
      )}
    </div>
  );
}
