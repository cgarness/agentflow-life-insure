import { ArrowRight } from "lucide-react";
import type { LoadState } from "@/hooks/useReportsData";
import type { ReportSummary } from "@/lib/reports-schemas";
import { formatCount } from "@/lib/reports-format";
import ReportPanelState from "./ReportPanelState";

export interface ReportsActivityFlowProps {
  summary: LoadState<ReportSummary>;
  onRetry: () => void;
}

/** A reading order for independent totals, never a cohort or a conversion-rate funnel. */
export default function ReportsActivityFlow({ summary, onRetry }: ReportsActivityFlowProps) {
  return (
    <section aria-label="Activity and production">
      <ReportPanelState title="Activity and production" state={summary} onRetry={onRetry}>
        {({ totals }) => {
          const stages = [
            { label: "Calls made", count: totals.calls_made, basis: "Outbound calls" },
            { label: "Contacted", count: totals.contacted, basis: "Contacted outbound calls" },
            { label: "Bookings created", count: totals.appointments_set, basis: "All booking types" },
            { label: "Converted leads / clients", count: totals.converted, basis: "Converting outbound calls" },
            { label: "Policies sold", count: totals.policies_sold, basis: "Primary + additional policies" },
          ];

          return (
            <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
              <div className="mb-6">
                <h2 className="text-base font-semibold tracking-tight text-foreground">Activity and production</h2>
                <p className="mt-1 text-sm text-muted-foreground">A view across the work and outcomes recorded in this period.</p>
              </div>
              <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
                {stages.map((stage, index) => (
                  <div key={stage.label} className="relative min-w-0 lg:pr-6">
                    <dt className="min-h-10 text-xs font-medium leading-5 text-muted-foreground">{stage.label}</dt>
                    <dd className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere]">{formatCount(stage.count)}</dd>
                    <dd className="mt-1 text-xs leading-5 text-muted-foreground">{stage.basis}</dd>
                    {index < stages.length - 1 && <ArrowRight aria-hidden="true" className="absolute -right-1 top-10 hidden h-4 w-4 text-muted-foreground/40 lg:block" />}
                  </div>
                ))}
              </dl>
              <p className="mt-6 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
                These are independent period totals, not one cohort moving through a funnel. Calls and conversions use call creation dates; bookings use booking creation dates; policies use their sale dates. Conversions count distinct identities on converting outbound calls, with campaign-lead or call identity used when a contact identity is missing. No stage-to-stage conversion rate is implied.
              </p>
            </div>
          );
        }}
      </ReportPanelState>
    </section>
  );
}
