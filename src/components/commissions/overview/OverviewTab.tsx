import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LoadingBlock, SurfaceSection } from "@/components/commission/ui/CommissionSurface";
import { useCommissionBreakdown, useCommissionOverview } from "@/hooks/useCommissionsCenter";
import { parsePeriod, periodReady, writePeriod, type CommissionPeriod } from "@/lib/commission/centerFilters";
import { CommissionPeriodControl } from "../CommissionPeriodControl";
import type { OpenPolicy } from "../CommissionDrawer";
import { InfoTip } from "../shared/Bits";
import { CenterError } from "../shared/CenterState";
import { CarrierBreakdown } from "./CarrierBreakdown";
import { CommissionTimeline } from "./CommissionTimeline";
import { Comparisons } from "./Comparisons";
import { MonthsTenToTwelve } from "./MonthsTenToTwelve";
import { NeedsReview } from "./NeedsReview";
import { ProductBreakdown } from "./ProductBreakdown";
import { SummaryCards } from "./SummaryCards";
import { UpcomingList } from "./UpcomingList";

const SOLD_TIP = "Policies by sale date, with their saved first-year estimates. Not Expected, which uses payment dates.";

/** Comparisons and the two breakdowns (one server snapshot for the period), with their own loading and error states. */
function Insights({ period }: { period: CommissionPeriod }) {
  const query = useCommissionBreakdown(period);
  const data = query.data;
  if (!data) {
    return query.isError ? <CenterError compact error={query.error} onRetry={() => void query.refetch()} />
      : <LoadingBlock label="Loading breakdowns…" rows={3} />;
  }
  return (
    <>
      {query.isError && <CenterError compact error={query.error} onRetry={() => void query.refetch()} />}
      <Comparisons data={data} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SurfaceSection title="By carrier" action={<InfoTip label="About By carrier">{SOLD_TIP} Received counts payments recorded in
          this period, whenever the policy sold.</InfoTip>}>
          <CarrierBreakdown data={data} period={period} />
        </SurfaceSection>
        <SurfaceSection title="By product" action={<InfoTip label="About By product">{SOLD_TIP}</InfoTip>}>
          <ProductBreakdown data={data} period={period} />
        </SurfaceSection>
      </div>
      {data.sold.undated_count > 0 && (
        <p className="text-xs text-muted-foreground">{data.sold.undated_count} sold without a sale date not included</p>
      )}
    </>
  );
}

/**
 * Overview: period (default This month), four cards (goal under Received), comparisons, By carrier and By product,
 * the timeline, Months 10–12, Needs review and Upcoming.
 */
export function OverviewTab({ onOpen }: { onOpen: OpenPolicy }) {
  const [params, setParams] = useSearchParams();
  const period = parsePeriod(params, false);
  const query = useCommissionOverview(period);
  const breakdown = useCommissionBreakdown(period);
  const data = query.data;
  return (
    <div className="space-y-5">
      <CommissionPeriodControl value={period} allowAll={false} onChange={(next) => setParams(writePeriod(params, next))} />
      {!periodReady(period) ? null : !data ? (
        query.isError ? <CenterError error={query.error} onRetry={() => void query.refetch()} />
          : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><LoadingBlock label="Loading commissions…" rows={4} className="sm:col-span-2 xl:col-span-4" /></div>
      ) : (
        <>
          {query.isError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <span>Couldn't refresh. Showing the last figures loaded.</span>
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button>
            </div>
          )}
          <SummaryCards data={data} period={period} />
          <Insights period={period} />
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SurfaceSection title="Timeline"><CommissionTimeline buckets={data.timeline} /></SurfaceSection>
            <div className="space-y-5">
              {breakdown.data && <MonthsTenToTwelve data={breakdown.data.months_10_12} />}
              <SurfaceSection title="Needs review"><NeedsReview data={data} /></SurfaceSection>
            </div>
          </div>
          <SurfaceSection title="Upcoming" count={data.upcoming.total_count}>
            <UpcomingList rows={data.upcoming.rows} total={data.upcoming.total_count} onOpen={onOpen} />
          </SurfaceSection>
        </>
      )}
    </div>
  );
}
