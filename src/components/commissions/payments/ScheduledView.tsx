import { Link, useSearchParams } from "react-router-dom";
import { useScheduledPayments } from "@/hooks/useCommissionsCenter";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import {
  KIND_LABELS, PAGE_SIZE, PAYMENT_KINDS, SCHEDULED_SCOPES, SCHEDULED_STATUSES, SCOPE_LABELS, STATUS_LABELS, parseScheduled,
  scheduledReady, withParam, writePeriod, type PaymentKindFilter,
} from "@/lib/commission/centerFilters";
import { CommissionPeriodControl } from "../CommissionPeriodControl";
import type { OpenPolicy } from "../CommissionDrawer";
import { FilterSelect, Pager } from "../shared/Bits";
import { CenterError } from "../shared/CenterState";
import { useCarrierOptions } from "../shared/useCarrierOptions";
import { ScheduledTable } from "./ScheduledTable";

const ALL = "__all__";

/** Scheduled: one row per expected payment, filtered by dates, status, type and carrier; totals cover the whole filter. */
export function ScheduledView({ onOpen }: { onOpen: OpenPolicy }) {
  const { money } = useAmounts();
  const [params, setParams] = useSearchParams();
  const filter = parseScheduled(params);
  const query = useScheduledPayments(filter);
  const data = query.data;
  const pending = query.isPlaceholderData;
  const set = (key: string, value: string | null, fallback?: string) => setParams(withParam(params, key, value, fallback));
  const carriers = useCarrierOptions(data?.carriers, filter.carrier);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Dates" value={filter.scope} className="w-40" options={SCHEDULED_SCOPES.map((s) => [s, SCOPE_LABELS[s]] as const)}
          onChange={(scope) => set("dates", scope, "period")} />
        {filter.scope === "period" && (
          <CommissionPeriodControl value={filter.period} allowAll onChange={(next) => setParams(writePeriod(params, next))} />
        )}
        <FilterSelect label="Status" value={filter.status} className="w-40" options={SCHEDULED_STATUSES.map((s) => [s, STATUS_LABELS[s]] as const)}
          onChange={(status) => set("status", status, "all")} />
        <FilterSelect<string> label="Type" value={filter.kind ?? ALL} className="w-40"
          options={[[ALL, "All types"], ...PAYMENT_KINDS.map((k) => [k, KIND_LABELS[k as PaymentKindFilter]] as const)]}
          onChange={(kind) => set("kind", kind === ALL ? null : kind)} />
        <FilterSelect<string> label="Carrier" value={filter.carrier ?? ALL} className="w-44"
          options={[[ALL, "All carriers"], ...carriers.map((c) => [c, c] as const)]} onChange={(c) => set("carrier", c === ALL ? null : c)} />
      </div>
      {!scheduledReady(filter) ? null : !data ? (
        query.isError ? <CenterError error={query.error} onRetry={() => void query.refetch()} /> : <ScheduledTable rows={null} onOpen={onOpen} />
      ) : (
        <>
          {query.isError && <CenterError compact error={query.error} onRetry={() => void query.refetch()} />}
          <ScheduledTable rows={data.rows} onOpen={onOpen} pending={pending} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-sm">
            <span className="text-muted-foreground">{data.total_count} {data.total_count === 1 ? "payment" : "payments"}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
              <span>Expected <span className="font-semibold">{money(data.totals.expected_cents)}</span></span>
              <span>Received <span className="font-semibold">{money(data.totals.received_cents)}</span></span>
              <span>Remaining <span className="font-semibold">{money(data.totals.remaining_cents)}</span></span>
              {data.totals.excess_cents > 0 && <span className="text-amber-800 dark:text-amber-200">{money(data.totals.excess_cents)} above estimate</span>}
            </span>
          </div>
          {data.held_count > 0 && filter.status !== "on_hold" && !pending && (
            <Link to={`?${withParam(params, "status", "on_hold").toString()}`} className="text-sm font-medium text-primary hover:underline">
              On hold: {data.held_count} not shown
            </Link>
          )}
          <Pager label="Scheduled payments pages" page={filter.page} pageSize={PAGE_SIZE} total={data.total_count}
            pending={pending} onPage={(page) => set("page", String(page), "1")} />
        </>
      )}
    </div>
  );
}
