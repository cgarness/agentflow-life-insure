import { Link } from "react-router-dom";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import { scheduledHref } from "@/lib/commission/centerFilters";
import type { ScheduledRow } from "@/lib/commission/centerSchemas";
import { CenterEmpty } from "../shared/CenterState";
import { PolicyIdentity } from "../shared/Bits";
import { kindLabel, windowLabel } from "../shared/format";
import type { OpenPolicy } from "../CommissionDrawer";

/** The next expected payments (a preview of Next 90 days), each with a direct action. */
export function UpcomingList({ rows, total, onOpen }: { rows: ScheduledRow[]; total: number; onOpen: OpenPolicy }) {
  const { money } = useAmounts();
  if (rows.length === 0) return <CenterEmpty title="No payments expected in the next 90 days" />;
  return (
    <div>
      <ul className="divide-y divide-border/60">
        {rows.map((row) => (
          <li key={row.installment_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
            <button type="button" onClick={() => onOpen(row.policy_id)} className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <PolicyIdentity contact={row.contact} detail={`${row.carrier} · ${kindLabel(row.kind)}`} />
            </button>
            <span className="order-3 text-xs text-muted-foreground sm:order-none sm:text-sm">{windowLabel(row)}</span>
            <span className="text-right text-sm font-medium tabular-nums">{money(row.remaining_cents)}</span>
            <button type="button" onClick={() => onOpen(row.policy_id, { payment: row.installment_id })}
              className="order-4 text-right text-sm font-medium text-primary hover:underline sm:order-none">Record payment</button>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <Link to={scheduledHref({ scope: "next_90" })} className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
          View all {total}
        </Link>
      )}
    </div>
  );
}
