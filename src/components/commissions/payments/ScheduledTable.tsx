import { formatCents } from "@/lib/commission/installments";
import type { ScheduledRow } from "@/lib/commission/centerSchemas";
import { LoadingBlock } from "@/components/commission/ui/CommissionSurface";
import type { OpenPolicy } from "../CommissionDrawer";
import { Chip, PolicyIdentity } from "../shared/Bits";
import { CenterEmpty } from "../shared/CenterState";
import { kindLabel, ROW_STATUS, windowLabel } from "../shared/format";

const GRID = "md:grid md:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1.1fr)_6.5rem_6.5rem_6.5rem_8rem_7.5rem] md:items-center md:gap-3";

/** Compact list of expected payments; stacks on phones. Selecting a row opens its policy; the action records a payment. */
export function ScheduledTable({ rows, onOpen }: { rows: ScheduledRow[] | null; onOpen: OpenPolicy }) {
  if (rows === null) return <LoadingBlock label="Loading payments…" rows={5} />;
  if (rows.length === 0) return <CenterEmpty title="No payments match these filters" />;
  return (
    <div role="table" aria-label="Scheduled payments" className="text-sm">
      <div role="row" className={`hidden px-2 pb-2 text-xs font-medium text-muted-foreground ${GRID}`}>
        <span role="columnheader">Client / policy</span><span role="columnheader">Type</span><span role="columnheader">Expected</span>
        <span role="columnheader" className="text-right">Amount</span><span role="columnheader" className="text-right">Received</span>
        <span role="columnheader" className="text-right">Remaining</span><span role="columnheader">Status</span>
        <span role="columnheader" className="sr-only">Action</span>
      </div>
      <div role="rowgroup" className="divide-y divide-border/60 border-y border-border/60">
        {rows.map((row) => {
          const status = ROW_STATUS[row.status];
          return (
            <div role="row" key={row.installment_id} className={`grid grid-cols-2 gap-x-3 gap-y-1 px-2 py-2.5 hover:bg-muted/30 ${GRID}`}>
              <span role="cell" className="col-span-2 md:col-span-1">
                <button type="button" onClick={() => onOpen(row.policy_id)} className="w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <PolicyIdentity contact={row.contact} detail={[row.carrier, row.product].filter(Boolean).join(" · ")} />
                </button>
              </span>
              <span role="cell" className="text-muted-foreground md:text-foreground">{kindLabel(row.kind)}</span>
              <span role="cell" className="text-right text-muted-foreground md:text-left md:text-foreground">{windowLabel(row)}</span>
              <span role="cell" className="tabular-nums md:text-right"><span className="text-xs text-muted-foreground md:hidden">Amount </span>{formatCents(row.expected_cents)}</span>
              <span role="cell" className="text-right tabular-nums"><span className="text-xs text-muted-foreground md:hidden">Received </span>{formatCents(row.received_cents)}</span>
              <span role="cell" className="tabular-nums md:text-right">
                <span className="text-xs text-muted-foreground md:hidden">Remaining </span>{formatCents(row.remaining_cents)}
                {row.excess_cents > 0 && <span className="block text-xs text-amber-800 dark:text-amber-200">+{formatCents(row.excess_cents)}</span>}
              </span>
              <span role="cell" className="text-right md:text-left">{status && <Chip tone={status.tone}>{status.label}</Chip>}</span>
              <span role="cell" className="col-span-2 md:col-span-1 md:text-right">
                {row.remaining_cents > 0 && (
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => onOpen(row.policy_id, { payment: row.installment_id })}>
                    Record payment
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
