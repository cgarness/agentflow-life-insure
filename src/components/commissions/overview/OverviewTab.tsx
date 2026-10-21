import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LoadingBlock, SurfaceSection } from "@/components/commission/ui/CommissionSurface";
import { useCommissionOverview } from "@/hooks/useCommissionsCenter";
import { parsePeriod, periodReady, writePeriod } from "@/lib/commission/centerFilters";
import { CommissionPeriodControl } from "../CommissionPeriodControl";
import type { OpenPolicy } from "../CommissionDrawer";
import { CenterError } from "../shared/CenterState";
import { CommissionTimeline } from "./CommissionTimeline";
import { NeedsReview } from "./NeedsReview";
import { SummaryCards } from "./SummaryCards";
import { UpcomingList } from "./UpcomingList";

/** Overview: period (default This month), four cards, the timeline, Needs review and Upcoming — one server snapshot. */
export function OverviewTab({ onOpen }: { onOpen: OpenPolicy }) {
  const [params, setParams] = useSearchParams();
  const period = parsePeriod(params, false);
  const query = useCommissionOverview(period);
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
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SurfaceSection title="Timeline"><CommissionTimeline buckets={data.timeline} /></SurfaceSection>
            <SurfaceSection title="Needs review"><NeedsReview data={data} /></SurfaceSection>
          </div>
          <SurfaceSection title="Upcoming" count={data.upcoming.total_count}>
            <UpcomingList rows={data.upcoming.rows} total={data.upcoming.total_count} onOpen={onOpen} />
          </SurfaceSection>
        </>
      )}
    </div>
  );
}
