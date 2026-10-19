import { useState } from "react";
import type { CommissionInstallment, CommissionReceipt, OpenPolicyCommission } from "@/lib/commission/trackingSchemas";
import { CommissionBasis } from "./CommissionBasis";
import { CommissionHoldDialog } from "./CommissionHoldDialog";
import { InstallmentRow } from "./InstallmentRow";
import { InstallmentTimingDialog } from "./InstallmentTimingDialog";
import { RecordEstimateDialog } from "./RecordEstimateDialog";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import { ScheduleBasisControl } from "./ScheduleBasisControl";
import { VoidReceiptDialog } from "./VoidReceiptDialog";

/** The expected payment schedule with manual receipts, holds, timing and the recorded calculation basis. */
export function PolicyCommissionDetail({ policy }: { policy: OpenPolicyCommission }) {
  const estimate = policy.estimate!;
  const canWrite = policy.access === "write";
  const [payment, setPayment] = useState<string | null>(null);
  const [timing, setTiming] = useState<CommissionInstallment | null>(null);
  const [voiding, setVoiding] = useState<CommissionReceipt | null>(null);
  const [hold, setHold] = useState(false);
  const [replace, setReplace] = useState(false);

  return (
    <div className="space-y-2.5">
      {estimate.status === "on_hold" && (
        <p className="break-words text-[11px] text-amber-800 dark:text-amber-200">On hold: {estimate.status_reason}</p>
      )}
      <ScheduleBasisControl estimate={estimate} effectiveDate={policy.basis.effective_date} canWrite={canWrite} />
      <ul aria-label="Expected payments" className="space-y-1.5">
        {estimate.installments.map((installment) => (
          <InstallmentRow
            key={installment.id}
            installment={installment}
            canWrite={canWrite}
            onRecord={() => setPayment(installment.id)}
            onTiming={() => setTiming(installment)}
            onVoid={setVoiding}
          />
        ))}
      </ul>
      <CommissionBasis estimate={estimate} />
      <p className="text-[10px] text-muted-foreground">
        Estimates use the agency's comp grid assumptions; received amounts are entered by hand. Neither is a carrier statement.
      </p>
      {canWrite && (
        <div className="flex flex-wrap gap-3 text-[11px]">
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setHold(true)}>
            {estimate.status === "on_hold" ? "Release hold" : "Place on hold"}
          </button>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setReplace(true)}>Replace estimate</button>
        </div>
      )}
      {canWrite && (
        <>
          <RecordPaymentDialog open={payment !== null} onOpenChange={(open) => { if (!open) setPayment(null); }}
            installments={estimate.installments} initialInstallmentId={payment ?? estimate.installments[0].id} />
          <InstallmentTimingDialog open={timing !== null} onOpenChange={(open) => { if (!open) setTiming(null); }}
            installment={timing} estimateRevision={estimate.state_revision} />
          <VoidReceiptDialog open={voiding !== null} onOpenChange={(open) => { if (!open) setVoiding(null); }}
            receipt={voiding} installments={estimate.installments} estimateRevision={estimate.state_revision} />
          <CommissionHoldDialog open={hold} onOpenChange={setHold} estimate={estimate} />
          <RecordEstimateDialog open={replace} onOpenChange={setReplace} policy={policy} replace />
        </>
      )}
    </div>
  );
}
