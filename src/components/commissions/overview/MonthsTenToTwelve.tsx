import { Link } from "react-router-dom";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import { monthsTenToTwelveHref } from "@/lib/commission/centerFilters";
import type { CommissionBreakdown } from "@/lib/commission/centerSchemas";
import { formatMonth } from "@/lib/commission/installments";
import { InfoTip } from "../shared/Bits";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Months 10–12 in the next agency month: what remains on first-year Month 10, 11 and 12 payments whose saved window
 * starts then (held and replaced estimates excluded; an Advance overpayment never counts here). Not renewals.
 */
export function MonthsTenToTwelve({ data }: { data: CommissionBreakdown["months_10_12"] }) {
  const { money } = useAmounts();
  const month = formatMonth(data.from);
  return (
    <section aria-label="Months 10–12" className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Months 10–12 · {month}</h2>
        <InfoTip label="About Months 10–12">
          Remaining on Month 10, 11 and 12 payments expected in {month}. First-year payments, not renewals. On hold not included. Not
          affected by the selected period.
        </InfoTip>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{money(data.remaining_cents)}</p>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{count(data.policy_count, "policy", "policies")} · {count(data.payment_count, "payment", "payments")}</span>
        {data.payment_count > 0 && (
          <Link to={monthsTenToTwelveHref()} className="text-sm font-medium text-primary hover:underline">View payments</Link>
        )}
      </div>
    </section>
  );
}
