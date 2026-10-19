import { formatCalendarDate, formatCents } from "@/lib/commission/installments";
import type { CommissionReceipt } from "@/lib/commission/trackingSchemas";

/** Manually recorded payments for one installment, voids included (struck through, with their reason). */
export function ReceiptList({ receipts, canWrite, onVoid }: {
  receipts: CommissionReceipt[];
  canWrite: boolean;
  onVoid: (receipt: CommissionReceipt) => void;
}) {
  if (receipts.length === 0) return null;
  return (
    <ul aria-label="Payments recorded" className="mt-1 space-y-1">
      {receipts.map((receipt) => {
        const voided = receipt.voided_at !== null;
        return (
          <li key={receipt.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
            <span className={voided ? "tabular-nums text-muted-foreground line-through" : "tabular-nums text-foreground"}>
              {formatCents(receipt.amount_cents)}
            </span>
            <span className="text-muted-foreground">received {formatCalendarDate(receipt.received_on)}</span>
            {receipt.reference && <span className="min-w-0 break-words text-muted-foreground">· {receipt.reference}</span>}
            {receipt.replaces_receipt_id && !voided && <span className="text-muted-foreground">· correction</span>}
            {voided ? (
              <span className="min-w-0 break-words text-muted-foreground">· void: {receipt.void_reason}</span>
            ) : (
              canWrite && (
                <button type="button" className="text-[11px] font-medium text-destructive hover:underline" onClick={() => onVoid(receipt)}>
                  Void
                </button>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
