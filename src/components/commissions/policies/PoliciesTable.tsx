import { LoadingBlock } from "@/components/commission/ui/CommissionSurface";
import { formatCalendarDate, formatCents } from "@/lib/commission/installments";
import type { PolicyRow } from "@/lib/commission/centerSchemas";
import type { OpenPolicy } from "../CommissionDrawer";
import { Chip, PolicyIdentity } from "../shared/Bits";
import { CenterEmpty } from "../shared/CenterState";
import { kindLabel, ROW_STATUS, SETUP_STATE, windowLabel } from "../shared/format";

const GRID = "md:grid md:grid-cols-[minmax(0,1.6fr)_6.5rem_6.5rem_6.5rem_6.5rem_minmax(0,1.3fr)_8rem] md:items-center md:gap-3";
/** Missing is shown as a dash, never $0. */
const money = (cents: number | null) => (cents === null ? "—" : formatCents(cents));

function NextPayment({ row }: { row: PolicyRow }) {
  if (row.setup === "missing" || row.setup === "needs_review") return <span className="text-muted-foreground">—</span>;
  if (!row.next_payment) return <span className="text-muted-foreground">{row.date_needed_count > 0 ? "Date needed" : "Nothing remaining"}</span>;
  const n = row.next_payment;
  // "Date needed" is already the window text; a past window is flagged.
  const status = n.status === "check_payment" ? ROW_STATUS[n.status] : null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0">{kindLabel(n.kind)} · {windowLabel(n)}</span>
      {status && <Chip tone={status.tone}>{status.label}</Chip>}
    </span>
  );
}

/** One row per policy (stable policy id) credited to the seller. `pending`: the earlier page while the next loads (inert). */
export function PoliciesTable({ rows, onOpen, pending = false }: { rows: PolicyRow[] | null; onOpen: OpenPolicy; pending?: boolean }) {
  if (rows === null) return <LoadingBlock label="Loading policies…" rows={5} />;
  if (rows.length === 0) return <CenterEmpty title="No policies match these filters" />;
  return (
    <div role="table" aria-label="Policies" aria-busy={pending} className={`text-sm ${pending ? "opacity-60" : ""}`}>
      <div role="row" className={`hidden px-2 pb-2 text-xs font-medium text-muted-foreground ${GRID}`}>
        <span role="columnheader">Client / policy</span><span role="columnheader">Effective</span>
        <span role="columnheader" className="text-right">Estimate</span><span role="columnheader" className="text-right">Received</span>
        <span role="columnheader" className="text-right">Remaining</span><span role="columnheader">Next payment</span>
        <span role="columnheader">Setup</span>
      </div>
      <div role="rowgroup" className="divide-y divide-border/60 border-y border-border/60">
        {rows.map((row) => {
          const setup = SETUP_STATE[row.setup];
          return (
            <div role="row" key={row.policy_id} className={`grid grid-cols-2 gap-x-3 gap-y-1 px-2 py-2.5 hover:bg-muted/30 ${GRID}`}>
              <span role="cell" className="col-span-2 md:col-span-1">
                <button type="button" disabled={pending} onClick={() => onOpen(row.policy_id)} className="w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <PolicyIdentity contact={row.contact} detail={[row.carrier, row.product].filter(Boolean).join(" · ") || "Policy"} />
                </button>
              </span>
              <span role="cell" className="text-muted-foreground md:text-foreground">{row.effective_date ? formatCalendarDate(row.effective_date) : "—"}</span>
              <span role="cell" className="text-right tabular-nums"><span className="text-xs text-muted-foreground md:hidden">Estimate </span>{money(row.estimate_cents)}</span>
              <span role="cell" className="tabular-nums md:text-right"><span className="text-xs text-muted-foreground md:hidden">Received </span>{money(row.received_cents)}</span>
              <span role="cell" className="text-right tabular-nums"><span className="text-xs text-muted-foreground md:hidden">Remaining </span>{money(row.remaining_cents)}</span>
              <span role="cell" className="col-span-2 md:col-span-1"><NextPayment row={row} /></span>
              <span role="cell" className="col-span-2 md:col-span-1">
                {row.setup === "missing" ? (
                  <button type="button" disabled={pending} className="font-medium text-primary hover:underline disabled:no-underline" onClick={() => onOpen(row.policy_id)}>Record estimate</button>
                ) : setup ? <Chip tone={setup.tone}>{setup.label}</Chip> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
