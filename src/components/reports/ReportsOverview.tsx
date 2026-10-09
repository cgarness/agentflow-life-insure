import { AlertTriangle } from "lucide-react";
import type { LoadState } from "@/hooks/useReportsData";
import type { ReportSummary } from "@/lib/reports-schemas";
import { formatCount, formatPremium } from "@/lib/reports-format";
import { PRODUCTION_BASIS_BAR, PRODUCTION_BASIS_BAR_SHORT, policyLeaderText } from "@/lib/reports-basis-text";
import { policyQualityNote } from "@/lib/reports-policy-text";
import { cn } from "@/lib/utils";
import ReportPanelState from "./ReportPanelState";
import PremiumCoverage from "./PremiumCoverage";
import { DataBasisButton } from "./ReportDataBasis";
import type { DataBasisContent } from "./DataBasisSections";

export interface ReportsOverviewProps {
  summary: LoadState<ReportSummary>;
  onRetry: () => void;
  /** The band's own Data basis trigger; omitted until the report scope resolves. */
  dataBasis?: DataBasisContent;
}

/** A formatted premium longer than this stacks the band instead of shrinking the number. */
const LONG_PREMIUM = 12;

const LABEL = "text-xs font-medium text-muted-foreground md:text-sm";
const HERO = "font-semibold leading-none tracking-tight tabular-nums [overflow-wrap:anywhere]";

/** Fixed production band: only the current, parsed summary can supply these amounts. */
export default function ReportsOverview({ summary, onRetry, dataBasis }: ReportsOverviewProps) {
  return (
    <section aria-label="Production overview" className="min-w-0">
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
          // The average divides by known premiums; with none known its denominator is zero.
          const average = premium.known_count === 0 ? "—" : formatPremium(premium.average_annual_premium);
          const stacked = annual.length > LONG_PREMIUM;
          // "Most policies — current assignments", from this same summary; never in the viewer's own scope.
          const leader = data.scope === "own" ? null : policyLeaderText(data.by_agent);
          const policyQuality = policyQualityNote(data.policy_quality);

          // Under the count beside the (taller) premium cell, so it adds no row on phones; full width when stacked.
          const leaderRow = leader && (
            <dl className={cn("flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-border/60 py-2 pl-4 pr-2 text-xs md:px-6",
              stacked && "col-span-full")}>
              <dt className="text-muted-foreground">Most policies — current assignments</dt>
              <dd className="min-w-0 font-medium tabular-nums text-foreground [overflow-wrap:anywhere]">{leader}</dd>
            </dl>
          );

          return (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
              <div data-hero-layout={stacked ? "stacked" : "split"}
                className={cn("grid min-w-0", stacked ? "grid-cols-1" : "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
                <article aria-label="Policies sold" className="min-w-0 p-4 md:p-6">
                  <h2 className={LABEL}>Policies sold</h2>
                  <p data-report-value="hero" className={cn("mt-1 text-4xl text-foreground md:mt-2 md:text-5xl xl:text-[3.5rem]", HERO)}>
                    {formatCount(policiesSold)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground md:text-sm">
                    {policiesSold === 0 ? "No policies sold in this period." : "Primary + additional policies"}
                  </p>
                </article>
                {stacked && leaderRow}
                <article aria-label="Known annual premium"
                  className={cn("min-w-0 border-border/60 p-4 md:p-6", stacked ? "border-t" : "border-l", !stacked && leader && "row-span-2")}>
                  <h2 className={LABEL}>Known annual premium</h2>
                  <p data-report-value="hero" className={cn("mt-1 md:mt-2", HERO, annual === "Unavailable"
                    ? "text-2xl text-muted-foreground md:text-3xl"
                    : "text-3xl text-foreground md:text-4xl xl:text-[3.5rem]")}>
                    {annual}
                  </p>
                  <PremiumCoverage premium={premium} />
                  <dl className="mt-3 grid gap-1 text-xs sm:flex sm:flex-wrap sm:gap-x-4">
                    <div className="flex justify-between gap-2 sm:justify-start">
                      <dt className="text-muted-foreground">Known monthly</dt>
                      <dd className="font-medium tabular-nums text-foreground [overflow-wrap:anywhere]">{monthly}</dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:justify-start">
                      <dt className="text-muted-foreground">
                        <span className="sm:hidden">Avg / known policy</span>
                        <span className="hidden sm:inline">Avg per known policy</span>
                      </dt>
                      <dd className="font-medium tabular-nums text-foreground [overflow-wrap:anywhere]">{average}</dd>
                    </div>
                  </dl>
                </article>
                {!stacked && leaderRow}
              </div>
              {policyQuality && (
                <p className="flex gap-1.5 border-t border-border/60 px-4 py-2 text-xs text-foreground md:px-6">
                  <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="min-w-0">{policyQuality}</span>
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground md:px-6">
                <p className="min-w-0">
                  <span className="sm:hidden">{PRODUCTION_BASIS_BAR_SHORT}</span>
                  <span className="hidden sm:inline">{PRODUCTION_BASIS_BAR}</span>
                </p>
                {dataBasis && <DataBasisButton {...dataBasis} className="shrink-0" />}
              </div>
            </div>
          );
        }}
      </ReportPanelState>
    </section>
  );
}
