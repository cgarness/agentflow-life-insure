import React, { useState, useEffect, useRef } from "react";
import { clientSaleFormSchema } from "@/lib/clientSaleForm";
import type { ClientSaleOptions } from "@/lib/policySaleRecording";
import { hasClientPolicyEvidence } from "@/lib/policyIdentity";
import { X, Loader2 } from "lucide-react";
import { Client, PolicyType } from "@/lib/types";
import { toast } from "sonner";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { DateInput } from "@/components/shared/DateInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { StateSelector } from "@/components/shared/StateSelector";
import {
  PAYMENT_FREQUENCIES,
  PAYMENT_FREQUENCY_LABELS,
  DEFAULT_PAYMENT_FREQUENCY,
} from "@/lib/policyPaymentFields";

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Client>, sale?: ClientSaleOptions) => Promise<void>;
  initial?: Partial<Client> | null;
}

const AddClientModal: React.FC<AddClientModalProps> = ({ open, onClose, onSave, initial }) => {
  const [form, setForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [historical, setHistorical] = useState(false);
  const requestId = useRef("");
  const inFlight = useRef(false);
  const close = () => { if (!inFlight.current) onClose(); };

  useEffect(() => {
    const base: Partial<Client> = {
      firstName: initial?.firstName || "",
      lastName: initial?.lastName || "",
      phone: initial?.phone || "",
      email: initial?.email || "",
      state: initial?.state || "",
      policyType: initial?.policyType || "Term",
      carrier: initial?.carrier || "",
      policyNumber: initial?.policyNumber || "",
      premiumAmount: initial?.premiumAmount || "",
      faceAmount: initial?.faceAmount || "",
      soldDate: initial?.soldDate || "",
      effectiveDate: initial?.effectiveDate || "",
      draftDate: initial?.draftDate || "",
      // New clients default to Monthly (approved D3). When EDITING, keep the stored value —
      // an unknown/NULL frequency must not be silently rewritten to monthly on save.
      paymentFrequency: initial ? initial.paymentFrequency || "" : DEFAULT_PAYMENT_FREQUENCY,
    };
    setForm(base);
    setHistorical(false);
    if (open) requestId.current = crypto.randomUUID();
  }, [initial, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;

    const isNewSale = hasClientPolicyEvidence(form) && (!initial || !hasClientPolicyEvidence(initial));
    const parsed = clientSaleFormSchema.safeParse({ ...form, recordSale: isNewSale });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }

    inFlight.current = true;
    setSaving(true);
    try {
      await onSave(form, initial ? undefined : { requestId: requestId.current, recordSale: isNewSale, ...(historical && isNewSale ? { historical: true } : {}) });
      onClose();
    } catch (err: unknown) {
      // Persistence failed — keep the modal open, do not show success.
      toast.error((err as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={close} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto" >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} Client</h2>
          <button aria-label="Close client form" onClick={close} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <fieldset disabled={saving} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">First Name *</label>
              <input required value={form.firstName || ""} onChange={e => setForm((f) => ({ ...f, firstName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
              <input required value={form.lastName || ""} onChange={e => setForm((f) => ({ ...f, lastName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Phone *</label>
            <PhoneInput
              required
              value={form.phone || ""}
              onChange={val => setForm((f) => ({ ...f, phone: normalizePhoneNumber(val) }))}
              className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
              placeholder="(555)123-4567"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
              <input type="email" value={form.email || ""} onChange={e => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">State</label>
              <StateSelector value={form.state || ""} onChange={val => setForm((f) => ({ ...f, state: val }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Policy Type</label>
              <select value={form.policyType || "Term"} onChange={e => setForm((f) => ({ ...f, policyType: e.target.value as PolicyType }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                {["Term", "Whole Life", "IUL", "Final Expense"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Carrier</label>
              <input value={form.carrier || ""} onChange={e => setForm((f) => ({ ...f, carrier: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Policy Number</label>
            <input value={form.policyNumber || ""} onChange={e => setForm((f) => ({ ...f, policyNumber: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="e.g. POL-123456" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Monthly Premium</label>
              <input value={form.premiumAmount || ""} onChange={e => setForm((f) => ({ ...f, premiumAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$150.00" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Face Amount</label>
              <input value={form.faceAmount || ""} onChange={e => setForm((f) => ({ ...f, faceAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$500,000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Sold Date</label>
              <DateInput value={form.soldDate || ""} onChange={val => setForm((f) => ({ ...f, soldDate: val }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Effective Date</label>
              <DateInput value={form.effectiveDate || ""} onChange={val => setForm((f) => ({ ...f, effectiveDate: val }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Draft Date</label>
              <DateInput value={form.draftDate || ""} onChange={val => setForm((f) => ({ ...f, draftDate: val }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Payment Frequency</label>
              <select value={form.paymentFrequency || ""} onChange={e => setForm((f) => ({ ...f, paymentFrequency: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                <option value="">—</option>
                {PAYMENT_FREQUENCIES.map(f => <option key={f} value={f}>{PAYMENT_FREQUENCY_LABELS[f]}</option>)}
              </select>
            </div>
          </div>

          {!initial && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={historical} onChange={e => setHistorical(e.target.checked)} className="mt-0.5" />
              Historical policy: credit the Sold Date in the agency timezone, without a new-sale celebration. Every new policy records one sale.
            </label>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={close} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Save Changes" : "Add Client"}
            </button>
          </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
};

export default AddClientModal;
