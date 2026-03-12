import { supabase } from "@/integrations/supabase/client";
import { Disposition } from "@/lib/types";
function rowToDisposition(row: any): Disposition { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.is_default,
    requireNotes: row.require_notes,
    minNoteChars: row.min_note_chars,
    callbackScheduler: row.callback_scheduler,
    appointmentScheduler: row.appointment_scheduler,
    automationTrigger: row.automation_trigger,
    automationId: row.automation_id ?? undefined,
    automationName: row.automation_name ?? undefined,
    order: row.sort_order,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export const dispositionsSupabaseApi = {
  async getAll(): Promise<Disposition[]> {
    const { data, error } = await supabase
      .from("dispositions")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(rowToDisposition);
  },
  async create(input: Omit<Disposition, "id" | "createdAt" | "updatedAt" | "usageCount">): Promise<Disposition> {
    const { data: existing } = await supabase
      .from("dispositions")
      .select("id")
      .ilike("name", input.name)
      .maybeSingle();
    if (existing) throw new Error("A disposition with this name already exists");
    const { count } = await supabase
      .from("dispositions")
      .select("*", { count: "exact", head: true });
    const { data, error } = await supabase
      .from("dispositions")
      .insert({
        name: input.name,
        color: input.color,
        is_default: input.isDefault,
        require_notes: input.requireNotes,
        min_note_chars: input.minNoteChars,
        callback_scheduler: input.callbackScheduler,
        appointment_scheduler: input.appointmentScheduler,
        automation_trigger: input.automationTrigger,
        automation_id: input.automationId ?? null,
        automation_name: input.automationName ?? null,
        sort_order: (count ?? 0) + 1,
        usage_count: 0,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToDisposition(data);
  },
  async update(id: string, input: Partial<Disposition>): Promise<Disposition> {
    if (input.name) {
      const { data: existing } = await supabase
        .from("dispositions")
        .select("id")
        .ilike("name", input.name)
        .neq("id", id)
        .maybeSingle();
      if (existing) throw new Error("A disposition with this name already exists");
    }
    const { data, error } = await supabase
      .from("dispositions")
      .update({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.requireNotes !== undefined && { require_notes: input.requireNotes }),
        ...(input.minNoteChars !== undefined && { min_note_chars: input.minNoteChars }),
        ...(input.callbackScheduler !== undefined && { callback_scheduler: input.callbackScheduler }),
        ...(input.appointmentScheduler !== undefined && { appointment_scheduler: input.appointmentScheduler }),
        ...(input.automationTrigger !== undefined && { automation_trigger: input.automationTrigger }),
        ...(input.automationId !== undefined && { automation_id: input.automationId }),
        ...(input.automationName !== undefined && { automation_name: input.automationName }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToDisposition(data);
  },
  async delete(id: string): Promise<void> {
    const { data: row, error: fetchError } = await supabase
      .from("dispositions")
      .select("is_default")
      .eq("id", id)
      .single();
    if (fetchError) throw new Error(fetchError.message);
    if (row.is_default) throw new Error("Default dispositions cannot be deleted");
    const { error } = await supabase
      .from("dispositions")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
  },
  async reorder(orderedIds: string[]): Promise<void> {
    const updates = orderedIds.map((id, index) =>
      supabase
        .from("dispositions")
        .update({ sort_order: index + 1 })
        .eq("id", id)
    );
    await Promise.all(updates);
  },
  async getAnalytics(period: string): Promise<{
    totalDispositioned: number;
    mostUsed: string;
    positiveRate: string;
    callbackRate: string;
    breakdown: { id: string; name: string; color: string; count: number; percent: number; trend: number }[];
  }> {
    const { data, error } = await supabase
      .from("dispositions")
      .select("*")
      .order("usage_count", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const total = rows.reduce((s: number, d: any) => s + d.usage_count, 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    const positive = rows
      .filter((d: any) => d.name.includes("Sold") || d.name.includes("Interested") || d.name.includes("Appointment")) // eslint-disable-line @typescript-eslint/no-explicit-any
      .reduce((s: number, d: any) => s + d.usage_count, 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    const callbacks = rows
      .filter((d: any) => d.callback_scheduler) // eslint-disable-line @typescript-eslint/no-explicit-any
      .reduce((s: number, d: any) => s + d.usage_count, 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      totalDispositioned: total,
      mostUsed: rows[0]?.name || "N/A",
      positiveRate: total ? `${Math.round((positive / total) * 100)}%` : "0%",
      callbackRate: total ? `${Math.round((callbacks / total) * 100)}%` : "0%",
      breakdown: rows.map((d: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: d.id,
        name: d.name,
        color: d.color,
        count: d.usage_count,
        percent: total ? Math.round((d.usage_count / total) * 100) : 0,
        trend: 0,
      })),
    };
  },
};
