import type { LoadState } from "@/hooks/useReportsData";
import type { ReportSummary } from "@/lib/reports-schemas";
import { formatCount } from "@/lib/reports-format";
import { PERIOD_TOTALS_LINE } from "@/lib/reports-basis-text";
import ReportPanelState from "./ReportPanelState";

export interface ReportsActivityFlowProps {
  summary: LoadState<ReportSummary>;
  onRetry: () => void;
}

/** Five tiles; they wrap two per row on phones and three from sm, and sit in one equal row from lg. */
const TILE = "min-w-[50%] flex-1 border-l border-t border-border/60 px-4 py-3 sm:min-w-[33.333%] lg:min-w-0";

/**
 * Period totals: five independent totals of equal weight, each with its own date basis. No arrows, no
 * ordering and no percentages, so nothing reads as one cohort moving through a funnel (U-1). The full
 * cohort statement is in Data basis.
 */
export default function ReportsActivityFlow({ summary, onRetry }: ReportsActivityFlowProps) {
  return (
    <section aria-labelledby="report-totals-title" className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 id="report-totals-title" className="text-sm font-semibold tracking-tight text-foreground">Period totals</h2>
        <p className="text-xs text-muted-foreground">{PERIOD_TOTALS_LINE}</p>
      </div>
      <ReportPanelState title="Period totals" state={summary} onRetry={onRetry}>
        {({ totals }) => {
          const tiles = [
            { label: "Calls made", count: totals.calls_made, basis: "by call date" },
            { label: "Contacted calls", count: totals.contacted, basis: "by call date" },
            { label: "Bookings created (all types)", count: totals.appointments_set, basis: "by date created" },
            { label: "Converted leads/clients", count: totals.converted, basis: "distinct people · by call date" },
            { label: "Policies sold", count: totals.policies_sold, basis: "by sale date" },
          ];
          return (
            <div className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-muted/20">
              <dl className="-ml-px -mt-px flex flex-wrap">
                {tiles.map((tile) => (
                  <div key={tile.label} className={TILE}>
                    <dt className="text-xs font-medium leading-4 text-muted-foreground">{tile.label}</dt>
                    <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-foreground [overflow-wrap:anywhere]">{formatCount(tile.count)}</dd>
                    <dd className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{tile.basis}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }}
      </ReportPanelState>
    </section>
  );
}
