import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recordClientPolicy, saleMonthlyPremium } from "@/lib/policySaleRecording";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

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
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const requestId = useRef("");
  const scope = [user?.id, organizationId, clientId, open].join("|");
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    if (open) {
      requestId.current = crypto.randomUUID();
      setForm({ policy_type: "Term", carrier: "", policy_number: "", premium: "", sold_date: "" });
      setHistorical(false); setError(null); setSaving(false); pending.current = false;
    }
  }, [scope, open]);
  const close = () => { if (!pending.current) onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !user?.id || !organizationId) return;
    const parsed = policySchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const savedScope = scope;
    pending.current = true; setSaving(true); setError(null);
    try {
      await recordClientPolicy(requestId.current, clientId, {
        carrier: parsed.data.carrier!, policy_type: parsed.data.policy_type!, sold_date: parsed.data.sold_date!,
        policy_number: parsed.data.policy_number, premium: saleMonthlyPremium(parsed.data.premium), sale_mode: historical ? "historical" : "new",
      }, primary);
      if (currentScope.current !== savedScope) return;
      onSaved(); onClose();
    } catch (failure) {
      if (currentScope.current === savedScope) setError(failure instanceof Error ? failure.message : "Policy could not be saved. Retry.");
    } finally {
      if (currentScope.current === savedScope) { pending.current = false; setSaving(false); }
    }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Record Policy</DialogTitle>
        <DialogDescription>Save this policy and its sale together. Editing an existing policy does not record another sale.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-3">
          <label className="block text-sm">Policy type
            <select className="mt-1 w-full rounded border bg-background p-2" value={form.policy_type} onChange={e => setForm({ ...form, policy_type: e.target.value })}>
              {["Term", "Whole Life", "Final Expense", "IUL"].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          {(["carrier", "policy_number", "premium", "sold_date"] as const).map(key => <label key={key} className="block text-sm">
            {{ carrier: "Carrier", policy_number: "Policy number", premium: "Monthly premium", sold_date: "Sold Date" }[key]}
            <input className="mt-1 w-full rounded border bg-background p-2" type={key === "sold_date" ? "date" : "text"}
              required={key === "carrier" || key === "sold_date"} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
          </label>)}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={historical} onChange={e => setHistorical(e.target.checked)} />
            Historical policy: credit the start of the Sold Date in the agency timezone, without celebration.
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!user?.id || !organizationId}>{saving ? "Saving…" : "Record Policy"}</Button></div>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>;
}
