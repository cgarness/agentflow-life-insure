import { useId, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  APPOINTMENT_BUSINESS_CATEGORY_LABELS, SELECTABLE_APPOINTMENT_BUSINESS_CATEGORIES, selectableAppointmentBusinessCategorySchema,
  type AppointmentTypeRecord,
} from "@/lib/calendar/appointmentTypes";

/**
 * A type's business category in Settings (D4 §4): read-only on locked defaults; a select on custom types. The server
 * guard (…40) refuses a locked change and audits every classification. Mounted by CalendarSettings (protected file).
 */
export function AppointmentTypeCategoryControl({ type, onChanged }: { type: AppointmentTypeRecord; onChanged?: () => void }) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = type.businessCategory ?? "unclassified";
  if (type.isLocked) return <span className="text-xs text-muted-foreground">{APPOINTMENT_BUSINESS_CATEGORY_LABELS[current]}</span>;
  const change = async (value: string) => {
    const parsed = selectableAppointmentBusinessCategorySchema.safeParse(value);
    if (!parsed.success) return;
    setSaving(true); setError(null);
    const { data, error: e } = await (supabase as any).from("appointment_types").update({ business_category: parsed.data })
      .eq("id", type.id).eq("organization_id", type.organizationId).select("id");
    setSaving(false);
    if (e || !data?.length) setError("The category wasn't saved."); else onChanged?.();
  };
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <label htmlFor={id} className="sr-only">Category for {type.name}</label>
      <select id={id} className="rounded border bg-background px-1 py-0.5" value={current === "unclassified" ? "" : current} disabled={saving}
        onChange={(e) => void change(e.target.value)}>
        <option value="" disabled>{APPOINTMENT_BUSINESS_CATEGORY_LABELS.unclassified}</option>
        {SELECTABLE_APPOINTMENT_BUSINESS_CATEGORIES.map((c) => <option key={c} value={c}>{APPOINTMENT_BUSINESS_CATEGORY_LABELS[c]}</option>)}
      </select>
      {error && <span role="alert" className="text-destructive">{error}</span>}
    </span>
  );
}
