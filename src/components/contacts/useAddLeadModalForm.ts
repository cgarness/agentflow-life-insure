import { useEffect, useState } from "react";
import type { Lead } from "@/lib/types";
import { leadSourcesSupabaseApi } from "@/lib/supabase-settings";

const DEFAULT_LEAD_SOURCES = [
  "Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar",
  "Cold Call", "TV Ad", "Radio Ad", "Other",
];

type Opts = {
  open: boolean;
  initial?: Partial<Lead> | null;
  resetAssignFields: () => void;
};

export function useAddLeadModalForm({ open, initial, resetAssignFields }: Opts) {
  const [form, setForm] = useState<Partial<Lead>>({});
  const [leadSources, setLeadSources] = useState<string[]>(DEFAULT_LEAD_SOURCES);

  useEffect(() => {
    async function load() {
      if (!open) return;
      try {
        const sources = await leadSourcesSupabaseApi.getAll();
        if (sources.length > 0) setLeadSources(sources.map((s) => s.name));
      } catch (err) {
        console.error("Error loading settings in modal:", err);
      }
    }
    load();
  }, [open]);

  useEffect(() => {
    if (initial) {
      resetAssignFields();
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
        bestTimeToCall: initial.bestTimeToCall || "",
        notes: initial.notes || "",
      });
    } else if (open) {
      resetAssignFields();
      setForm({
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        state: "",
        leadSource: leadSources[0] || "Facebook Ads",
        status: "New",
        age: undefined,
        dateOfBirth: "",
        bestTimeToCall: "",
        notes: "",
      });
    }
  }, [initial, open, leadSources, resetAssignFields]);

  useEffect(() => {
    if (!open || initial) return;
    if (leadSources.length === 0) return;
    setForm((f) => {
      const cur = f.leadSource;
      if (cur && leadSources.includes(cur)) return f;
      return { ...f, leadSource: leadSources[0]! };
    });
  }, [open, initial, leadSources]);

  return { form, setForm, leadSources };
}
