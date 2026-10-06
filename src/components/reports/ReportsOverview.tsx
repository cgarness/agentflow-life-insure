import { CircleDollarSign, ShieldCheck } from "lucide-react";
import type { LoadState } from "@/hooks/useReportsData";
import type { ReportSummary } from "@/lib/reports-schemas";
import { formatCount, formatPremium } from "@/lib/reports-format";
import { PREMIUM_BASIS } from "@/lib/reports-integrity-text";
import { CURRENT_ASSIGNMENT_NOTE, POLICY_SOURCE_NOTE, policyQualityNote } from "@/lib/reports-policy-text";
import ReportPanelState from "./ReportPanelState";

export interface ReportsOverviewProps {
  summary: LoadState<ReportSummary>;
  onRetry: () => void;
}

/** Fixed production anchors: only the current, parsed summary can supply these amounts. */
export default function ReportsOverview({ summary, onRetry }: ReportsOverviewProps) {
  return (
    <section aria-label="Production overview" className="space-y-4">
      <ReportPanelState title="Production overview" state={summary} onRetry={onRetry}>
        {(data) => {
          const { premium, policies_sold: policiesSold } = data.totals;
          // An all-unknown cohort must never acquire a $0 value from a display fallback.
          const premiumUnavailable = premium.policy_count > 0 && premium.known_count === 0;
          const annual = premiumUnavailable || premium.annual_premium === null
            ? "Unavailable"
            : formatPremium(premium.annual_premium);
          const monthly = premiumUnavailable || premium.monthly_premium === null
            ? "Unavailable"
            : formatPremium(premium.monthly_premium);
          const policyQuality = policyQualityNote(data.policy_quality);

          return (
            <>
              <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:gap-6">
                <article aria-label="Policies sold" className="min-w-0 rounded-2xl border border-border/70 bg-card p-6 sm:p-8">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-sm font-semibold text-muted-foreground">Policies Sold</h2>
                    <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-primary/70" />
                  </div>
                  <p className="mt-6 text-[clamp(2.5rem,5vw,4rem)] font-semibold leading-tight tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere]">
                    {formatCount(policiesSold)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {policiesSold === 0 ? "No policies sold in this period." : "Stored policies sold in this period."}
                  </p>
                  <div className="mt-6 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
                    <p>{POLICY_SOURCE_NOTE} One client can hold several policies.</p>
                    {policyQuality && <p className="mt-2">{policyQuality}</p>}
                  </div>
                </article>

                <article aria-label="Known annual premium" className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.03] p-6 sm:p-8">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-sm font-semibold text-muted-foreground">Known Annual Premium</h2>
                    <CircleDollarSign aria-hidden="true" className="h-5 w-5 shrink-0 text-primary/70" />
                  </div>
                  <p className="mt-6 text-[clamp(1.75rem,4vw,3.5rem)] font-semibold leading-tight tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere]">
                    {annual}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {premium.policy_count === 0
                      ? "No policies sold in this period."
                      : `${formatCount(premium.known_count)} of ${formatCount(premium.policy_count)} policies have a known premium.`}
                  </p>
                  <dl className="mt-6 grid min-w-0 grid-cols-1 gap-4 border-t border-primary/15 pt-4 text-xs sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Known monthly premium</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground tabular-nums [overflow-wrap:anywhere]">{monthly}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Unknown premium</dt>
                      <dd className="mt-1 text-sm font-medium text-foreground">
                        {formatCount(premium.unknown_count)} {premium.unknown_count === 1 ? "policy" : "policies"}
                        {premium.unknown_count > 0 && <span className="font-normal text-muted-foreground"> · excluded from amount</span>}
                      </dd>
                    </div>
                  </dl>
                </article>
              </div>
              <div className="space-y-1 px-1 text-xs leading-relaxed text-muted-foreground">
                <p>{PREMIUM_BASIS}</p>
                <p>{CURRENT_ASSIGNMENT_NOTE}</p>
              </div>
            </>
          );
        }}
      </ReportPanelState>
    </section>
  );
}
