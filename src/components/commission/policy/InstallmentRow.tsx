import {
  excessCents,
  INSTALLMENT_LABELS,
  receivedCents,
  remainingCents,
  timingLabel,
} from "@/lib/commission/installments";
import type { CommissionInstallment, CommissionReceipt } from "@/lib/commission/trackingSchemas";
import { useAmounts } from "../ui/amountsContext";
import { ReceiptList } from "./ReceiptList";

/** One expected payment: estimate, what was recorded as received, remaining or excess, and its expected date. */
export function InstallmentRow({ installment, canWrite, onRecord, onTiming, onVoid }: {
  installment: CommissionInstallment;
  canWrite: boolean;
  onRecord: () => void;
  onTiming: () => void;
  onVoid: (receipt: CommissionReceipt) => void;
}) {
  const received = receivedCents(installment);
  const remaining = remainingCents(installment);
  const excess = excessCents(installment);
  const { money } = useAmounts();
  return (
    <li className="rounded-md border border-border/60 px-2.5 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-xs font-medium text-foreground">{INSTALLMENT_LABELS[installment.kind]}</span>
        <span className="text-xs tabular-nums text-foreground">{money(installment.expected_cents)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{timingLabel(installment)}</span>
        <span>· Received {money(received)}</span>
        {excess > 0 ? (
          <span className="text-amber-700 dark:text-amber-300">· {money(excess)} above estimate</span>
        ) : (
          <span>· Remaining {money(remaining)}</span>
        )}
      </div>
      <ReceiptList receipts={installment.receipts} canWrite={canWrite} onVoid={onVoid} />
      {canWrite && (
        <div className="mt-1.5 flex flex-wrap gap-3">
          <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={onRecord}>Record payment</button>
          <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={onTiming}>Edit date</button>
        </div>
      )}
    </li>
  );
}
