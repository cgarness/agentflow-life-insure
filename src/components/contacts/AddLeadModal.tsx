import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Lead, LeadStatus } from "@/lib/types";
import { leadSourcesSupabaseApi, healthStatusesSupabaseApi } from "@/lib/supabase-settings";
import { toast } from "sonner";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { calculateAge } from "@/utils/dateUtils";

interface AddLeadModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead>) => Promise<void>;
  initial?: Partial<Lead> | null;
}

const AddLeadModal: React.FC<AddLeadModalProps> = ({ open, onClose, onSave, initial }) => {
  const [form, setForm] = useState<Partial<Lead>>({});
  const [saving, setSaving] = useState(false);
  const [leadSources, setLeadSources] = useState<string[]>(["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar", "Cold Call", "TV Ad", "Radio Ad", "Other"]);
  const [healthStatuses, setHealthStatuses] = useState<string[]>(["Excellent", "Good", "Fair", "Poor"]);

  useEffect(() => {
    async function loadSettings() {
      if (!open) return;
      try {
        const [sources, healths] = await Promise.all([
          leadSourcesSupabaseApi.getAll(),
          healthStatusesSupabaseApi.getAll()
        ]);
        if (sources.length > 0) setLeadSources(sources.map(s => s.name));
        if (healths.length > 0) setHealthStatuses(healths.map(h => h.name));
      } catch (err) {
        console.error("Error loading settings in modal:", err);
      }
    }
    loadSettings();
  }, [open]);

  useEffect(() => {
    if (initial) {
      setForm({
        firstName: initial.firstName || "",
        lastName: initial.lastName || "",
        phone: initial.phone || "",
        email: initial.email || "",
        state: initial.state || "",
        leadSource: initial.leadSource || "Facebook Ads",
        status: initial.status || "New",
        age: initial.age || undefined,
        dateOfBirth: initial.dateOfBirth || "",
        healthStatus: initial.healthStatus || "",
        bestTimeToCall: initial.bestTimeToCall || "",
        notes: initial.notes || ""
      });
    } else {
      setForm({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        state: "",
        leadSource: "Facebook Ads",
        status: "New",
        age: undefined,
        dateOfBirth: "",
        healthStatus: "",
        bestTimeToCall: "",
        notes: ""
      });
    }
  }, [initial, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} Lead</h2>
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
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
            <input type="email" value={form.email || ""} onChange={e => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">State</label>
              <input value={form.state || ""} onChange={e => setForm((f) => ({ ...f, state: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="FL" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Lead Source</label>
              <select value={form.leadSource || (leadSources[0] || "")} onChange={e => setForm((f) => ({ ...f, leadSource: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                {leadSources.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Date of Birth</label>
              <input 
                type="date" 
                value={form.dateOfBirth || ""} 
                onChange={e => {
                  const dob = e.target.value;
                  const calculatedAge = calculateAge(dob);
                  setForm((f) => ({ ...f, dateOfBirth: dob, age: calculatedAge ?? f.age }));
                }} 
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" 
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Age</label>
              <input type="number" value={form.age || ""} onChange={e => setForm((f) => ({ ...f, age: e.target.value ? parseInt(e.target.value) : undefined }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="e.g. 45" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Health Status</label>
              <select value={form.healthStatus || ""} onChange={e => setForm((f) => ({ ...f, healthStatus: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                <option value="">Select...</option>
                {healthStatuses.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Best Time to Call</label>
              <select value={form.bestTimeToCall || ""} onChange={e => setForm((f) => ({ ...f, bestTimeToCall: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                <option value="">Select...</option>
                {["Morning", "Afternoon", "Evening", "Anytime"].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Initial Notes</label>
            <textarea value={form.notes || ""} onChange={e => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none" placeholder="Add any background context..." />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Save Changes" : "Add Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddLeadModal;
