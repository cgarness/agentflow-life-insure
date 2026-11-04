import { useId } from "react";
import { Loader2, Search, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { getNumberPurchaseScope, type PurchaseCompletion } from "@/lib/phone-number-purchase";
import { NumberPurchaseResults } from "./NumberPurchaseResults";
import { NumberPurchaseReview } from "./NumberPurchaseReview";
import { useNumberPurchase } from "./useNumberPurchase";

type Props = {
  open: boolean; organizationId: string | null; onOpenChange: (open: boolean) => void;
  onCompleted: (numbers: string[], counts?: PurchaseCompletion) => Promise<void>;
};

export function NumberPurchaseDialog({ open, organizationId, onOpenChange, onCompleted }: Props) {
  const { user, realProfile, isImpersonating } = useAuth();
  const scope = getNumberPurchaseScope(user?.id, realProfile, organizationId, isImpersonating);
  const purchase = useNumberPurchase({ scope, open, onCompleted });
  const id = useId();
  const { filters, busy } = purchase;
  const filtersDisabled = !!busy && busy !== "search";
  const hasFilter = filters.numberType === "toll_free" || !!(filters.areaCode.trim() || filters.state.trim() || filters.locality.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || purchase.close()) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[min(90vh,800px)] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:p-0">
        <div className="border-b px-6 pb-4 pr-14 pt-6">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" />Purchase number</DialogTitle>
            <DialogDescription className="text-xs">Choose US numbers for your agency. Availability can change.</DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {!purchase.allowed ? (
            <p role="alert" className="text-sm text-destructive">An active agency Admin must purchase numbers from their own agency. Exit View As to continue.</p>
          ) : (
            <>
              {purchase.error && <p role="alert" className="text-sm text-destructive">{purchase.error}</p>}
              {purchase.phase === "review" ? <NumberPurchaseReview purchase={purchase} /> : (
                <>
                  <div role="group" aria-label="Number type" className="grid grid-cols-2 gap-2">
                    {(["local", "toll_free"] as const).map((type) => (
                      <Button key={type} type="button" variant={filters.numberType === type ? "default" : "outline"}
                        aria-pressed={filters.numberType === type} disabled={filtersDisabled}
                        onClick={() => purchase.setFilters({ numberType: type })}>
                        {type === "local" ? "Local" : "Toll-Free"}
                      </Button>
                    ))}
                  </div>
                  {filters.numberType === "local" ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                      <div className="space-y-1.5">
                        <label htmlFor={`${id}-area`} className="text-xs font-medium text-muted-foreground">Area code</label>
                        <Input id={`${id}-area`} placeholder="e.g. 213" autoComplete="off" inputMode="numeric"
                          value={filters.areaCode} disabled={filtersDisabled}
                          onChange={(event) => purchase.setFilters({ areaCode: event.target.value.replace(/\D/g, "").slice(0, 3) })} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`${id}-state`} className="text-xs font-medium text-muted-foreground">State (2-letter)</label>
                        <Input id={`${id}-state`} placeholder="e.g. CA" autoComplete="off" value={filters.state} disabled={filtersDisabled}
                          onChange={(event) => purchase.setFilters({ state: event.target.value.toUpperCase().slice(0, 2) })} />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <label htmlFor={`${id}-city`} className="text-xs font-medium text-muted-foreground">City</label>
                        <Input id={`${id}-city`} placeholder="e.g. Los Angeles" autoComplete="off" value={filters.locality} disabled={filtersDisabled}
                          onChange={(event) => purchase.setFilters({ locality: event.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Toll-free prefix</p>
                      <div role="group" aria-label="Toll-free prefix" className="grid grid-cols-3 gap-2">
                        {([ ["prefer_800", "Prefer 800"], ["800", "800 only"], ["888", "888 only"] ] as const).map(([prefix, label]) => (
                          <Button key={prefix} type="button" size="sm" variant={filters.prefix === prefix ? "secondary" : "outline"}
                            className="px-2" aria-pressed={filters.prefix === prefix} disabled={filtersDisabled}
                            onClick={() => purchase.setFilters({ prefix })}>{label}</Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Voice available. Toll-free SMS requires separate verification and is unavailable.</p>
                    </div>
                  )}
                  <Button type="button" className="w-full" onClick={() => void purchase.search()} disabled={!!busy || !hasFilter}>
                    {busy === "search" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Search available numbers
                  </Button>
                  <NumberPurchaseResults purchase={purchase} />
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
