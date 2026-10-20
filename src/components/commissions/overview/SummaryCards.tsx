import { Link } from "react-router-dom";
import { formatCalendarDate, formatCents } from "@/lib/commission/installments";
import { historyHref, scheduledHref, type CommissionPeriod } from "@/lib/commission/centerFilters";
import type { CommissionOverview } from "@/lib/commission/centerSchemas";
import { InfoTip } from "../shared/Bits";

interface CardProps { label: string; value: number; note: string; extra?: string | null; to: string; tip: string }

function Card({ label, value, note, extra, to, tip }: CardProps) {
  return (
    <div className="relative rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-center gap-1">
        <Link to={to} className="text-sm font-medium text-muted-foreground after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">
          {label}
        </Link>
        <InfoTip label={`About ${label}`} className="relative z-10">{tip}</InfoTip>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{formatCents(value)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      {extra && <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">{extra}</p>}
    </div>
  );
}

const payments = (n: number) => `${n} ${n === 1 ? "payment" : "payments"}`;

/**
 * Expected · Received · Remaining · Next 90 days. Each card opens exactly the list that sums to it. Definitions live in
 * the ⓘ control, not under the heading.
 */
export function SummaryCards({ data, period }: { data: CommissionOverview; period: CommissionPeriod }) {
  const s = data.summary;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="Expected" value={s.expected_cents} note={payments(s.expected_count)}
        extra={s.held_expected_cents > 0 ? `On hold: ${formatCents(s.held_expected_cents)} not included` : null}
        to={scheduledHref({ period })}
        tip="Estimated payments whose expected date starts in this period. Payments on hold or without a date are not included." />
      <Card label="Received" value={s.received_cents} note={`${s.received_count} recorded`} to={historyHref(period)}
        tip="Payments you recorded with a received date in this period. Voided payments are not included. Not carrier-verified." />
      <Card label="Remaining" value={s.remaining_cents} note={`of ${formatCents(s.expected_cents)} expected`}
        extra={s.excess_cents > 0 ? `${formatCents(s.excess_cents)} above estimate` : null} to={scheduledHref({ period, status: "remaining" })}
        tip="What is still expected on this period's payments after every payment recorded against them, whenever it was received. An overpayment on one payment never reduces another." />
      <Card label="Next 90 days" value={data.next_90.remaining_cents} note={payments(data.next_90.count)} to={scheduledHref({ scope: "next_90" })}
        tip={`Remaining on payments expected from today through ${formatCalendarDate(data.next_90.to)}. Not affected by the selected period.`} />
    </div>
  );
}
