import { estimateTotals, formatCents } from "@/lib/commission/installments";
import type { CommissionEstimateRecord } from "@/lib/commission/trackingSchemas";

/** One compact line: estimated commission, what was recorded as received, and what remains. */
export function PolicyCommissionSummary({ estimate }: { estimate: CommissionEstimateRecord }) {
  const totals = estimateTotals(estimate);
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
      <span className="text-foreground">
        Estimated commission <span className="font-semibold tabular-nums">{formatCents(estimate.first_year_cents)}</span>
      </span>
      <span className="text-muted-foreground">
        · Received <span className="tabular-nums">{formatCents(totals.received)}</span>
      </span>
      <span className="text-muted-foreground">
        · Remaining <span className="tabular-nums">{formatCents(totals.remaining)}</span>
      </span>
      {estimate.status === "on_hold" && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">On hold</span>
      )}
    </div>
  );
}
