import { supabase } from "@/integrations/supabase/client";
import { Disposition } from "@/lib/types";

type DispositionRow = {
  id: string;
  name: string;
  color: string;
  is_locked: boolean | null;
  require_notes: boolean;
  min_note_chars: number;
  callback_scheduler: boolean;
  appointment_scheduler: boolean;
  automation_trigger: boolean;
  automation_id: string | null;
  automation_name: string | null;
  campaign_action: string | null;
  dnc_auto_add: boolean | null;
  counts_as_contacted: boolean | null;
  pipeline_stage_id: string | null;
  sort_order: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
};

function rowToDisposition(row: DispositionRow): Disposition {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isLocked: row.is_locked ?? false,
    requireNotes: row.require_notes,
    minNoteChars: row.min_note_chars,
    callbackScheduler: row.callback_scheduler,
    appointmentScheduler: row.appointment_scheduler,
    automationTrigger: row.automation_trigger,
    automationId: row.automation_id ?? undefined,
    automationName: row.automation_name ?? undefined,
    campaignAction: (row.campaign_action as Disposition["campaignAction"]) ?? "none",
    dncAutoAdd: row.dnc_auto_add ?? false,
    countsAsContacted: row.counts_as_contacted ?? false,
    pipelineStageId: row.pipeline_stage_id ?? null,
    order: row.sort_order,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireOrgId(organizationId: string | null | undefined, op: string): string {
  if (!organizationId) {
    throw new Error(`dispositionsApi.${op}: organizationId is required`);
  }
  return organizationId;
}

export const dispositionsSupabaseApi = {
  async getAll(organizationId: string): Promise<Disposition[]> {
    const orgId = requireOrgId(organizationId, "getAll");
    const { data, error } = await supabase
      .from("dispositions")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => rowToDisposition(row as DispositionRow));
  },

  async create(
    input: Omit<Disposition, "id" | "createdAt" | "updatedAt" | "usageCount">,
    organizationId: string,
  ): Promise<Disposition> {
    const orgId = requireOrgId(organizationId, "create");

    const { data: existing } = await supabase
      .from("dispositions")
      .select("id")
      .eq("organization_id", orgId)
      .ilike("name", input.name.trim())
      .maybeSingle();
    if (existing) throw new Error("A disposition with this name already exists");

    const { data: maxRow } = await supabase
      .from("dispositions")
      .select("sort_order")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxRow?.sort_order ?? 0) + 1;

    const { data, error } = await supabase
      .from("dispositions")
      .insert({
        name: input.name.trim(),
        color: input.color,
        is_locked: input.isLocked ?? false,
        require_notes: input.requireNotes,
        min_note_chars: input.minNoteChars,
        callback_scheduler: input.callbackScheduler,
        appointment_scheduler: input.appointmentScheduler,
        automation_trigger: input.automationTrigger,
        automation_id: input.automationId ?? null,
        automation_name: input.automationName ?? null,
        campaign_action: input.campaignAction ?? "none",
        dnc_auto_add: input.dncAutoAdd ?? false,
        counts_as_contacted: input.countsAsContacted ?? false,
        pipeline_stage_id: input.pipelineStageId ?? null,
        sort_order: nextOrder,
        usage_count: 0,
        organization_id: orgId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToDisposition(data as DispositionRow);
  },

  async update(
    id: string,
    input: Partial<Disposition>,
    organizationId: string,
  ): Promise<Disposition> {
    const orgId = requireOrgId(organizationId, "update");

    if (input.name) {
      const { data: existing } = await supabase
        .from("dispositions")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("name", input.name.trim())
        .neq("id", id)
        .maybeSingle();
      if (existing) throw new Error("A disposition with this name already exists");
    }

    const { data, error } = await supabase
      .from("dispositions")
      .update({
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.requireNotes !== undefined && { require_notes: input.requireNotes }),
        ...(input.minNoteChars !== undefined && { min_note_chars: input.minNoteChars }),
        ...(input.callbackScheduler !== undefined && { callback_scheduler: input.callbackScheduler }),
        ...(input.appointmentScheduler !== undefined && { appointment_scheduler: input.appointmentScheduler }),
        ...(input.automationTrigger !== undefined && { automation_trigger: input.automationTrigger }),
        ...(input.automationId !== undefined && { automation_id: input.automationId ?? null }),
        ...(input.automationName !== undefined && { automation_name: input.automationName ?? null }),
        ...(input.campaignAction !== undefined && { campaign_action: input.campaignAction }),
        ...(input.dncAutoAdd !== undefined && { dnc_auto_add: input.dncAutoAdd }),
        ...(input.countsAsContacted !== undefined && { counts_as_contacted: input.countsAsContacted }),
        ...(input.isLocked !== undefined && { is_locked: input.isLocked }),
        ...(input.pipelineStageId !== undefined && { pipeline_stage_id: input.pipelineStageId || null }),
      })
      .eq("id", id)
      .eq("organization_id", orgId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToDisposition(data as DispositionRow);
  },

  async delete(id: string, organizationId: string): Promise<void> {
    const orgId = requireOrgId(organizationId, "delete");

    const { data: row, error: fetchError } = await supabase
      .from("dispositions")
      .select("is_locked")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!row) throw new Error("Disposition not found");
    if (row.is_locked) throw new Error("Locked dispositions cannot be deleted");

    const { error } = await supabase
      .from("dispositions")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
  },

  async reorder(orderedIds: string[], organizationId: string): Promise<void> {
    const orgId = requireOrgId(organizationId, "reorder");
    if (orderedIds.length === 0) return;

    const results = await Promise.all(
      orderedIds.map((id, index) =>
        supabase
          .from("dispositions")
          .update({ sort_order: index + 1 })
          .eq("id", id)
          .eq("organization_id", orgId),
      ),
    );
    const firstError = results.find((r) => r.error);
    if (firstError?.error) throw new Error(firstError.error.message);
  },

  async getAnalytics(
    period: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    organizationId: string,
  ): Promise<{
    totalDispositioned: number;
    mostUsed: string;
    positiveRate: string;
    callbackRate: string;
    breakdown: { id: string; name: string; color: string; count: number; percent: number; trend: number }[];
  }> {
    const orgId = requireOrgId(organizationId, "getAnalytics");

    const { data, error } = await supabase
      .from("dispositions")
      .select("*")
      .eq("organization_id", orgId)
      .order("usage_count", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as DispositionRow[];
    const total = rows.reduce((s, d) => s + (d.usage_count ?? 0), 0);
    const positive = rows
      .filter((d) => d.name.includes("Sold") || d.name.includes("Interested") || d.name.includes("Appointment"))
      .reduce((s, d) => s + (d.usage_count ?? 0), 0);
    const callbacks = rows
      .filter((d) => d.callback_scheduler)
      .reduce((s, d) => s + (d.usage_count ?? 0), 0);
    return {
      totalDispositioned: total,
      mostUsed: rows[0]?.name || "N/A",
      positiveRate: total ? `${Math.round((positive / total) * 100)}%` : "0%",
      callbackRate: total ? `${Math.round((callbacks / total) * 100)}%` : "0%",
      breakdown: rows.map((d) => ({
        id: d.id,
        name: d.name,
        color: d.color,
        count: d.usage_count ?? 0,
        percent: total ? Math.round(((d.usage_count ?? 0) / total) * 100) : 0,
        trend: 0,
      })),
    };
  },
};
