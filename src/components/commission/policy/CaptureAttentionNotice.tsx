import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTrackingMutation } from "@/hooks/useClientPolicyCommissions";
import { attentionMessage } from "@/lib/commission/installments";
import { commissionTrackingApi } from "@/lib/commission/trackingApi";
import type { OpenPolicyCommission } from "@/lib/commission/trackingSchemas";
import { WhenAmountsShown } from "../ui/AmountsVisibility";
import { useAmounts } from "../ui/amountsContext";

const fieldCls =
  "w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

/**
 * An estimate shown when the sale was saved that is not recorded yet: it awaits the seller's (or an admin's)
 * confirmation, or a check found a difference. Confirming re-validates it against current facts.
 */
export function CaptureAttentionNotice({ policy, onRecordLater }: { policy: OpenPolicyCommission; onRecordLater: () => void }) {
  const id = useId();
  const { money } = useAmounts();
  const capture = policy.capture!;
  const canWrite = policy.access === "write";
  const confirm = useTrackingMutation(`confirm:${capture.id}`);
  const dismiss = useTrackingMutation<{ reason: string }>(`dismiss:${capture.id}`);
  // A dismissal whose outcome is unknown reopens locked with the submitted reason.
  const [dismissing, setDismissing] = useState(dismiss.unresolved);
  const [reason, setReason] = useState(dismiss.pending?.reason ?? "");
  const [note, setNote] = useState<string | null>(null);
  const awaiting = capture.status === "awaiting_confirmation";

  const onConfirm = async () => {
    setNote(null);
    const result = confirm.unresolved ? await confirm.retry<Awaited<ReturnType<typeof commissionTrackingApi.confirmCapture>>>()
      : await confirm.run((requestId) => commissionTrackingApi.confirmCapture({ requestId, captureId: capture.id }));
    if (result && result.status === "needs_attention") { setNote(attentionMessage(result.code)); confirm.restart(); }
  };
  const onDismiss = async (event: React.FormEvent) => {
    event.preventDefault();
    if (dismiss.unresolved) { await dismiss.retry(); return; }
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 200) { setNote("Give a reason of 3 to 200 characters."); return; }
    setNote(null);
    await dismiss.run((requestId) => commissionTrackingApi.dismissCapture({ requestId, captureId: capture.id, reason: trimmed }), { reason });
  };

  return (
    <div role="status" className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100">
      <p className="break-words">
        {awaiting ? "Estimate shown at sale awaits confirmation by the agent or an admin" : attentionMessage(capture.attention_code)}
        {": "}
        <span className="tabular-nums">{money(capture.first_year_cents)}</span> first-year,{" "}
        <span className="tabular-nums">{money(capture.advance_cents)}</span> advance.
      </p>
      {/* Confirming or dismissing never happens blind: hidden amounts keep these closed (state kept). */}
      <WhenAmountsShown>
        {canWrite && !dismissing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-7 px-2 text-[11px]" disabled={confirm.saving || confirm.syncing} onClick={() => void onConfirm()}>
              {confirm.saving ? "Checking…" : confirm.locked ? "Retry confirm" : "Confirm estimate"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={onRecordLater}>Record with current rates</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setDismissing(true); dismiss.restart(); }}>Dismiss</Button>
          </div>
        )}
        {canWrite && dismissing && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={onDismiss}>
            <label htmlFor={`${id}-reason`} className="sr-only">Reason for dismissing</label>
            <input id={`${id}-reason`} className={`${fieldCls} h-8 min-w-0 flex-1 text-xs`} placeholder="Reason for dismissing" maxLength={200}
              value={reason} disabled={dismiss.saving || dismiss.locked} onChange={(event) => setReason(event.target.value)} />
            <Button type="submit" size="sm" variant="destructive" className="h-8" disabled={dismiss.saving || dismiss.syncing}>{dismiss.locked ? "Retry" : "Dismiss"}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" disabled={dismiss.saving || dismiss.unresolved} onClick={() => setDismissing(false)}>Cancel</Button>
          </form>
        )}
      </WhenAmountsShown>
      {(note || confirm.message || dismiss.message) && (
        <p role="alert" className="break-words text-destructive">{note ?? confirm.message ?? dismiss.message}</p>
      )}
    </div>
  );
}
