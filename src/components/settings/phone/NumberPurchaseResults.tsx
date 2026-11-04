import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatNumberPrice } from "@/lib/phone-number-purchase";
import type { useNumberPurchase } from "./useNumberPurchase";

export function NumberPurchaseResults({ purchase }: { purchase: ReturnType<typeof useNumberPurchase> }) {
  const { numbers, items, busy, searched } = purchase;
  return (
    <div className="space-y-4">
      {searched && numbers.length === 0 && <p role="status" className="text-sm text-muted-foreground">No numbers matched those filters.</p>}
      {numbers.length > 0 && (
        <ul aria-label="Available numbers" className="max-h-64 divide-y overflow-y-auto rounded-lg border px-3">
          {numbers.map((number) => {
            const inCart = items.some((item) => item.number.phone_number === number.phone_number);
            return (
              <li key={number.phone_number} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-36">
                  <p className="font-mono font-medium">{number.phone_number}</p>
                  {number.number_type === "toll_free" ? <Badge variant="secondary" className="mt-1 text-[10px]">Toll-Free · SMS unavailable</Badge> : (
                    <p className="truncate text-xs text-muted-foreground">{[number.locality, number.region, number.postal_code].filter(Boolean).join(", ") || "US local"}</p>
                  )}
                </div>
                <p className="text-right text-xs tabular-nums">
                  <span className="font-semibold text-primary">{formatNumberPrice(number.monthly_price, number.currency)}</span>
                  <span className="block text-muted-foreground">/ month</span>
                </p>
                <Button type="button" size="sm" className="w-full sm:w-auto" variant={inCart ? "secondary" : "default"}
                  disabled={inCart || !!busy} onClick={() => purchase.add(number)} aria-label={`${inCart ? "In cart" : "Add to cart"} ${number.phone_number}`}>
                  {inCart ? "In cart" : "Add to cart"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <section aria-label="Number cart" className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{items.length} in cart</h3>
            <Button type="button" variant="ghost" size="sm" disabled={!!busy || purchase.pending} onClick={purchase.clear}>Clear cart</Button>
          </div>
          <ul className="divide-y rounded-md border bg-background px-2">
            {items.map((item) => (
              <li key={item.number.phone_number} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs">{item.number.phone_number}</p>
                  <p className="text-[10px] text-muted-foreground">{item.number.number_type === "toll_free" ? "Toll-Free" : [item.number.locality, item.number.region].filter(Boolean).join(", ") || "Local"}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={!!busy || item.attempted}
                  onClick={() => purchase.remove(item.number.phone_number)} aria-label={`Remove ${item.number.phone_number} from cart`}><X className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
          <Button type="button" className="w-full" disabled={!!busy || purchase.blocked} onClick={() => void purchase.review()}>
            {purchase.pending ? "View purchase status" : "Review purchase"}
          </Button>
        </section>
      )}
    </div>
  );
}
