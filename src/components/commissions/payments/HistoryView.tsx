import { useSearchParams } from "react-router-dom";
import { LoadingBlock } from "@/components/commission/ui/CommissionSurface";
import { usePaymentHistory } from "@/hooks/useCommissionsCenter";
import { formatCalendarDate, formatCents } from "@/lib/commission/installments";
import { PAGE_SIZE, parseHistory, periodReady, withParam, writePeriod } from "@/lib/commission/centerFilters";
import type { HistoryRow } from "@/lib/commission/centerSchemas";
import { CommissionPeriodControl } from "../CommissionPeriodControl";
import type { OpenPolicy } from "../CommissionDrawer";
import { Chip, Pager, PolicyIdentity } from "../shared/Bits";
import { CenterEmpty, CenterError } from "../shared/CenterState";
import { kindLabel } from "../shared/format";

const GRID = "md:grid md:grid-cols-[7.5rem_minmax(0,1.6fr)_6rem_7rem_minmax(0,1.2fr)] md:items-center md:gap-3";

function Correction({ row }: { row: HistoryRow }) {
  if (row.voided) return <span className="flex min-w-0 flex-wrap items-center gap-1.5"><Chip tone="muted">Voided</Chip>
    {row.void_reason && <span className="min-w-0 break-words text-xs text-muted-foreground">{row.void_reason}</span>}</span>;
  if (row.replaces_receipt_id) return <Chip tone="neutral">Correction</Chip>;
  return null;
}

/** History: one row per recorded payment, newest first; voids and corrections stay visible with their reasons. */
export function HistoryView({ onOpen }: { onOpen: OpenPolicy }) {
  const [params, setParams] = useSearchParams();
  const filter = parseHistory(params);
  const query = usePaymentHistory(filter);
  const data = query.data;
  const pending = query.isPlaceholderData;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <CommissionPeriodControl value={filter.period} allowAll onChange={(next) => setParams(writePeriod(params, next))} />
        <label className="flex h-9 items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="h-4 w-4 rounded border-input" checked={filter.includeVoided}
            onChange={(event) => setParams(withParam(params, "voided", event.target.checked ? "1" : null))} />
          Show voided
        </label>
      </div>
      {!periodReady(filter.period) ? null : !data ? (
        query.isError ? <CenterError error={query.error} onRetry={() => void query.refetch()} /> : <LoadingBlock label="Loading payments…" rows={5} />
      ) : data.rows.length === 0 ? <CenterEmpty title="No payments recorded in this period" /> : (
        <>
          {query.isError && <CenterError compact error={query.error} onRetry={() => void query.refetch()} />}
          <div role="table" aria-label="Payment history" aria-busy={pending} className={`text-sm ${pending ? "opacity-60" : ""}`}>
            <div role="row" className={`hidden px-2 pb-2 text-xs font-medium text-muted-foreground ${GRID}`}>
              <span role="columnheader">Received</span><span role="columnheader">Client / policy</span><span role="columnheader">Payment</span>
              <span role="columnheader" className="text-right">Amount</span><span role="columnheader">Corrections</span>
            </div>
            <div role="rowgroup" className="divide-y divide-border/60 border-y border-border/60">
              {data.rows.map((row) => (
                <div role="row" key={row.receipt_id} className={`grid grid-cols-2 gap-x-3 gap-y-1 px-2 py-2.5 hover:bg-muted/30 ${GRID}`}>
                  <span role="cell" className="tabular-nums">{formatCalendarDate(row.received_on)}</span>
                  <span role="cell" className="order-first col-span-2 md:order-none md:col-span-1">
                    <button type="button" disabled={pending} onClick={() => onOpen(row.policy_id)} className="w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <PolicyIdentity contact={row.contact} detail={[row.carrier, row.product].filter(Boolean).join(" · ")} />
                    </button>
                  </span>
                  <span role="cell" className="text-right text-muted-foreground md:text-left md:text-foreground">{kindLabel(row.kind)}</span>
                  <span role="cell" className={`tabular-nums md:text-right ${row.voided ? "text-muted-foreground line-through" : ""}`}>{formatCents(row.amount_cents)}</span>
                  <span role="cell" className="text-right md:text-left"><Correction row={row} /></span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-sm">
            <span className="text-muted-foreground">{data.totals.valid_count} recorded{data.totals.voided_count > 0 ? ` · ${data.totals.voided_count} voided` : ""}</span>
            <span className="tabular-nums">Received <span className="font-semibold">{formatCents(data.totals.received_cents)}</span></span>
          </div>
          <Pager label="Payment history pages" page={filter.page} pageSize={PAGE_SIZE} total={data.total_count} pending={pending}
            onPage={(page) => setParams(withParam(params, "page", String(page), "1"))} />
        </>
      )}
    </div>
  );
}
