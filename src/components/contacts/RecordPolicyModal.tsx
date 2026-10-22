import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recordClientPolicyHandoff, saleMonthlyPremium } from "@/lib/policySaleRecording";
import { commissionNotice } from "@/lib/policySaleOutcome";
import { commissionPayload, PRIMARY_SLOT, type CommissionSlotInputs } from "@/lib/commission/capture";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePolicySaleSubmission } from "@/hooks/usePolicySaleSubmission";
import { useOrganizationCarriers } from "@/hooks/useOrganizationCarriers";
import { carrierSelectionError } from "@/lib/carrierSelection";
import { CarrierCombobox } from "@/components/shared/CarrierCombobox";
import { PolicyCommissionEstimate } from "@/components/commission/preview/PolicyCommissionEstimate";
import { SaleSubmissionNotice } from "./SaleSubmissionNotice";

const policySchema = z.object({
  policy_type: z.string().trim().min(1, "Choose a policy type"),
  carrier: z.string().trim().min(1, "Carrier is required"),
  policy_number: z.string(),
  premium: z.string(),
  sold_date: z.string().refine(v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v, "Enter a valid Sold Date"),
});
type Props = { open: boolean; clientId: string; primary?: boolean; onClose: () => void; onSaved: () => void };

export default function RecordPolicyModal({ open, clientId, primary = false, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const [form, setForm] = useState({ policy_type: "Term", carrier: "", policy_number: "", premium: "", sold_date: "" });
  const [historical, setHistorical] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submission = usePolicySaleSubmission();
  const { reset } = submission;
  const carriers = useOrganizationCarriers(open);
  const carrierId = useId();
  const requestId = useRef("");
  const capture = useRef<CommissionSlotInputs | null>(null);
  const scope = [user?.id, organizationId, clientId, open].join("|");
  useEffect(() => {
    if (open) {
      requestId.current = crypto.randomUUID();
      setForm({ policy_type: "Term", carrier: "", policy_number: "", premium: "", sold_date: "" });
      setHistorical(false); setError(null); reset(); capture.current = null;
    }
  }, [scope, open, reset]);
  const saving = submission.phase === "sending";
  const close = () => { if (!saving) onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submission.locked && !submission.frozen) return;
    if (!user?.id || !organizationId) return;
    const parsed = policySchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    // A frozen retry replays the exact submission that already passed this check; the carrier list is not consulted.
    const carrierError = submission.frozen ? null : carrierSelectionError(carriers.carriers, parsed.data.carrier);
    if (carrierError) { setError(carrierError); return; }
    setError(null);
    const commission = commissionPayload([{ slot: PRIMARY_SLOT, inputs: capture.current }]);
    const outcome = await submission.submit((attempt) => recordClientPolicyHandoff(attempt, requestId.current, clientId, {
      carrier: parsed.data.carrier!, policy_type: parsed.data.policy_type!, sold_date: parsed.data.sold_date!,
      policy_number: parsed.data.policy_number, premium: saleMonthlyPremium(parsed.data.premium), sale_mode: historical ? "historical" : "new",
    }, primary, commission));
    if (!outcome.saved) return;
    const notice = outcome.result?.commission ? commissionNotice(outcome.result.commission, commission.slots.length) : null;
    if (notice) toast.warning(notice);
    onSaved(); onClose();
  };
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Record Policy</DialogTitle>
        <DialogDescription>Save this policy and its sale together. Editing an existing policy does not record another sale.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <fieldset disabled={submission.locked} className="space-y-3">
          <label className="block text-sm">Policy type
            <select className="mt-1 w-full rounded border bg-background p-2" value={form.policy_type} onChange={e => setForm({ ...form, policy_type: e.target.value })}>
              {["Term", "Whole Life", "Final Expense", "IUL"].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <div className="text-sm"><label htmlFor={carrierId} className="mb-1 block">Carrier</label>
            <CarrierCombobox id={carrierId} value={form.carrier} onChange={carrier => setForm(f => ({ ...f, carrier }))}
              list={carriers} disabled={submission.locked} className="rounded bg-background hover:bg-background" />
          </div>
          {(["policy_number", "premium", "sold_date"] as const).map(key => <label key={key} className="block text-sm">
            {{ policy_number: "Policy number", premium: "Monthly premium", sold_date: "Sold Date" }[key]}
            <input className="mt-1 w-full rounded border bg-background p-2" type={key === "sold_date" ? "date" : "text"}
              required={key === "sold_date"} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
          </label>)}
          <PolicyCommissionEstimate owner={{ kind: "client", id: clientId }} policyType={form.policy_type}
            carrier={form.carrier} monthlyPremium={form.premium} onCaptureChange={inputs => { capture.current = inputs; }} />
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={historical} onChange={e => setHistorical(e.target.checked)} />
            Historical policy: credit the start of the Sold Date in the agency timezone, without celebration.
          </label>
        </fieldset>
        <div className="mt-3 space-y-3">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <SaleSubmissionNotice submission={submission} />
          <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={close} disabled={saving}>
            {submission.phase === "conflict" ? "Close" : "Cancel"}</Button>
            <Button type="submit" disabled={!user?.id || !organizationId || saving || submission.phase === "conflict" || submission.phase === "saved"}>
              {saving ? "Saving…" : "Record Policy"}</Button></div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
