import { useState } from "react";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AmountsHiddenGate } from "@/components/commission/ui/AmountsVisibility";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import { LoadingBlock } from "@/components/commission/ui/CommissionSurface";
import { CaptureAttentionNotice } from "@/components/commission/policy/CaptureAttentionNotice";
import { PolicyCommissionDetail } from "@/components/commission/policy/PolicyCommissionDetail";
import { PolicyCommissionSummary } from "@/components/commission/policy/PolicyCommissionSummary";
import { RecordEstimateDialog } from "@/components/commission/policy/RecordEstimateDialog";
import { RecordPaymentDialog } from "@/components/commission/policy/RecordPaymentDialog";
import { useCommissionPolicy } from "@/hooks/useCommissionsCenter";
import { asTrackedPolicy, type CommissionDrawerData } from "@/lib/commission/centerSchemas";
import { CenterError } from "./shared/CenterState";
import { contactName } from "./shared/format";

/** `opened` distinguishes each opening, so a reopened drawer starts fresh. */
export interface DrawerTarget { policyId: string; payment?: string; opened: number }
export type OpenPolicy = (policyId: string, intent?: { payment?: string }) => void;

function policyLine(data: CommissionDrawerData): string {
  const e = data.policy.estimate;
  const parts = e ? [e.product_carrier, e.product_name] : [data.policy.basis.carrier, data.policy.basis.policy_type];
  return parts.filter((part) => part && part.trim()).join(" · ") || "Policy";
}

/**
 * One policy's saved commission, with the existing Phase 2A controls (Record payment, Edit dates, Edit date, Void,
 * hold, replace, confirm, Record estimate) and their unresolved-write recovery. Nothing here writes on its own; every
 * successful change refreshes the center, this drawer and the contact view together.
 */
function DrawerBody({ data, payment }: { data: CommissionDrawerData; payment?: string }) {
  const policy = asTrackedPolicy(data.policy);
  const canWrite = policy.access === "write";
  const [recording, setRecording] = useState(false);
  const [paying, setPaying] = useState(!!payment);
  const estimate = policy.state === "recorded" ? policy.estimate : null;
  return (
    <div className="space-y-4">
      {estimate ? (
        <>
          <PolicyCommissionSummary estimate={estimate} />
          <PolicyCommissionDetail policy={policy} />
          {canWrite && payment && estimate.installments.some((i) => i.id === payment) && (
            <RecordPaymentDialog open={paying} onOpenChange={setPaying} installments={estimate.installments} initialInstallmentId={payment} />
          )}
        </>
      ) : policy.capture && (policy.state === "awaiting_confirmation" || policy.state === "needs_attention") ? (
        <CaptureAttentionNotice policy={policy} onRecordLater={() => setRecording(true)} />
      ) : canWrite ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">No commission estimate recorded.</span>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setRecording(true)}>Record estimate</button>
        </div>
      ) : null}
      {canWrite && <RecordEstimateDialog open={recording} onOpenChange={setRecording} policy={policy} replace={false} />}
    </div>
  );
}

export function CommissionDrawer({ target, onClose }: { target: DrawerTarget | null; onClose: () => void }) {
  const { hidden } = useAmounts();
  const query = useCommissionPolicy(target?.policyId ?? null);
  const data = query.data;
  // A drawer reopened for another policy never shows the previous one's figures.
  const shown = data && data.policy.policy_id === target?.policyId ? data : undefined;
  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="space-y-1 pr-6 text-left">
          <SheetTitle className={shown && !shown.contact ? "italic text-muted-foreground" : undefined}>
            {shown ? contactName(shown.contact) : "Commission"}
          </SheetTitle>
          <SheetDescription>{shown ? policyLine(shown) : "Loading…"}</SheetDescription>
          {shown?.contact && (
            <Link to={`/clients/${shown.contact.client_id}`} className="text-sm font-medium text-primary hover:underline">View policy</Link>
          )}
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {/* The page's eye control is behind this sheet, so the explicit reveal is offered here too (never automatic). */}
          {hidden && <AmountsHiddenGate />}
          {shown ? <DrawerBody key={target?.opened} data={shown} payment={target?.payment} />
            : query.isError ? <CenterError error={query.error} onRetry={() => void query.refetch()} compact />
              : <LoadingBlock label="Loading commission…" rows={4} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
