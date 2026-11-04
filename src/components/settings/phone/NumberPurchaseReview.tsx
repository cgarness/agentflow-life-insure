import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatNumberPrice, monthlyNumberTotals, type PurchaseOperation } from "@/lib/phone-number-purchase";
import type { useNumberPurchase } from "./useNumberPurchase";

const statusText: Record<PurchaseOperation["state"], string> = {
  quoted: "Purchase not confirmed", purchasing: "Purchase in progress", purchased_pending_save: "Purchased — saving number",
  completed: "Purchased", failed_before_purchase: "Not purchased — review again", needs_review: "Needs review",
};

export function NumberPurchaseReview({ purchase }: { purchase: ReturnType<typeof useNumberPurchase> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const { items, busy, pricesReady, pending, blocked } = purchase;
  const remaining = items.filter((item) => !item.attempted);
  const quotes = remaining.flatMap((item) => item.quote ? [item.quote] : []);
  const totals = monthlyNumberTotals(quotes);
  const completed = items.length > 0 && items.every((item) => item.operation?.state === "completed");
  const expires = Math.min(...quotes.map((quote) => Date.parse(quote.expires_at)));

  return (
    <section aria-label="Purchase review" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={heading} tabIndex={-1} className="font-semibold focus:outline-none">Review purchase</h3>
        <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={purchase.browse}>Back to search</Button>
      </div>
      <ul aria-label="Selected numbers" className="divide-y rounded-lg border px-3">
        {items.map((item) => {
          const quote = item.quote;
          const expired = !item.attempted && quote && Date.parse(quote.expires_at) <= Date.now();
          return (
            <li key={item.number.phone_number} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold">{item.number.phone_number}</p>
                <Badge variant="secondary" className="text-[10px]">{item.number.number_type === "toll_free" ? "Toll-Free · SMS unavailable" : "Local"}</Badge>
              </div>
              {quote ? (
                <dl className="space-y-1 text-xs">
                  <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Monthly rental</dt><dd className="font-medium tabular-nums">{formatNumberPrice(quote.monthly_price, quote.currency)} / month</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Inbound calls</dt><dd className="tabular-nums">{formatNumberPrice(quote.inbound_per_minute, quote.currency)} / minute</dd></div>
                </dl>
              ) : busy === "quote" ? <p className="text-xs text-muted-foreground">Checking current price…</p> : null}
              {item.operation && <p role="status" className={item.operation.state === "completed" ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-amber-600"}>{statusText[item.operation.state]}</p>}
              {expired && <p className="text-xs text-destructive">Price expired. Review current prices before purchasing.</p>}
              {item.error && <p role="alert" className="text-xs text-destructive">{item.error}</p>}
            </li>
          );
        })}
      </ul>
      {quotes.length === remaining.length && quotes.length > 0 && (
        <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Monthly rental for this purchase</p>
          {totals.map((total) => <p key={total.currency} className="font-semibold tabular-nums">{formatNumberPrice(total.amount, total.currency)} / month</p>)}
          <p className="text-xs text-muted-foreground">Usage and applicable taxes are additional.</p>
          {Number.isFinite(expires) && pricesReady && <p className="text-[11px] text-muted-foreground">Prices valid until {new Date(expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>}
        </div>
      )}
      {completed ? <p role="status" className="text-sm">Your numbers are ready in Phone Numbers. Use “Use for Inbounds” there to dedicate an eligible number to the Inbounds room.</p> : (
        <div className="space-y-2">
          {pending && (
            <Button type="button" className="w-full" variant="outline" disabled={!!busy} onClick={() => void purchase.checkStatus()}>
              {busy === "status" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Check purchase status
            </Button>
          )}
          {!pricesReady && !pending && (
            <Button type="button" className="w-full" variant="outline" disabled={!!busy || blocked} onClick={() => void purchase.review()}>
              {busy === "quote" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy === "quote" ? "Checking prices…" : "Review current prices"}
            </Button>
          )}
          <Button type="button" className="w-full" disabled={!purchase.canConfirm} onClick={() => void purchase.confirm()}>
            {(busy === "purchase" || busy === "status") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy === "purchase" ? "Purchasing…" : busy === "status" ? "Checking status…" : `Confirm purchase${remaining.length ? ` of ${remaining.length} number${remaining.length === 1 ? "" : "s"}` : ""}`}
          </Button>
        </div>
      )}
    </section>
  );
}
