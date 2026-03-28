import React, { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { Recruit } from "@/lib/types";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import { toast } from "sonner";

interface AddRecruitModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Recruit>) => Promise<void>;
  initial?: Partial<Recruit> | null;
}

const AddRecruitModal: React.FC<AddRecruitModalProps> = ({ open, onClose, onSave, initial }) => {
  const [form, setForm] = useState<Partial<Recruit>>({});
  const [saving, setSaving] = useState(false);
  const [recruitStatuses, setRecruitStatuses] = useState<string[]>(["Prospect", "Contacted", "Interview", "Licensed", "Active"]);

  useEffect(() => {
    async function loadSettings() {
      if (!open) return;
      try {
        const stages = await pipelineSupabaseApi.getRecruitStages();
        if (stages.length > 0) setRecruitStatuses(stages.map(s => s.name));
      } catch (err) {
        console.error("Error loading recruit stages:", err);
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
        status: initial.status || "Prospect",
        notes: initial.notes || ""
      });
    } else {
      setForm({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        status: "Prospect",
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
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} Recruit</h2>
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
            <input required value={form.phone || ""} onChange={e => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="(555) 123-4567" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
            <input type="email" value={form.email || ""} onChange={e => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
            <select value={form.status || "Prospect"} onChange={e => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
              {recruitStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
            <textarea value={form.notes || ""} onChange={e => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none" placeholder="Add any background context..." />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Save Changes" : "Add Recruit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddRecruitModal;
