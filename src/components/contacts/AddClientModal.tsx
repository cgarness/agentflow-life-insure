import React, { useState, useEffect } from "react";
import { z } from "zod";
import { X, Loader2 } from "lucide-react";
import { Client, PolicyType } from "@/lib/types";
import { toast } from "sonner";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { DateInput } from "@/components/shared/DateInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { StateSelector } from "@/components/shared/StateSelector";

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Client>) => Promise<void>;
  initial?: Partial<Client> | null;
}

const AddClientModal: React.FC<AddClientModalProps> = ({ open, onClose, onSave, initial }) => {
  const [form, setForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        firstName: initial.firstName || "",
        lastName: initial.lastName || "",
        phone: initial.phone || "",
        email: initial.email || "",
        state: initial.state || "",
        policyType: initial.policyType || "Term",
        carrier: initial.carrier || "",
        premiumAmount: initial.premiumAmount || "",
        faceAmount: initial.faceAmount || "",
        issueDate: initial.issueDate || ""
      });
    } else {
      setForm({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        state: "",
        policyType: "Term",
        carrier: "",
        premiumAmount: "",
        faceAmount: "",
        issueDate: ""
      });
    }
  }, [initial, open]);

const clientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  state: z.string().length(2, "State must be exactly 2 letters").optional().or(z.literal("")),
});

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      clientSchema.parse({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        state: form.state,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        toast.error(err.errors[0].message);
        return;
      }
    }

    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <style dangerouslySetInnerHTML={{ __html: `::-webkit-scrollbar { display: none; }` }} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} Client</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
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
              <StateSelector 
                value={form.state || ""} 
                onChange={val => setForm((f) => ({ ...f, state: val }))} 
              />
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Premium</label>
              <input value={form.premiumAmount || ""} onChange={e => setForm((f) => ({ ...f, premiumAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$150/mo" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Face Amount</label>
              <input value={form.faceAmount || ""} onChange={e => setForm((f) => ({ ...f, faceAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$500,000" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Issue Date</label>
            <DateInput value={form.issueDate || ""} onChange={val => setForm((f) => ({ ...f, issueDate: val }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Save Changes" : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddClientModal;
