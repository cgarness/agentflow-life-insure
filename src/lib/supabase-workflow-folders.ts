import { supabase } from "@/integrations/supabase/client";
import type { WorkflowFolderRow } from "@/lib/workflow-types";

const sb: any = supabase;

export const workflowFolderApi = {
  async list(orgId: string): Promise<WorkflowFolderRow[]> {
    const { data, error } = await sb
      .from("workflow_folders")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as WorkflowFolderRow[];
  },

  async create(input: {
    organization_id: string;
    name: string;
    color?: string;
  }): Promise<WorkflowFolderRow> {
    const { data, error } = await sb
      .from("workflow_folders")
      .insert({ ...input, sort_order: 0 })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as WorkflowFolderRow;
  },

  async update(
    folderId: string,
    patch: Partial<Pick<WorkflowFolderRow, "name" | "color" | "sort_order">>,
  ): Promise<void> {
    const { error } = await sb.from("workflow_folders").update(patch).eq("id", folderId);
    if (error) throw error;
  },

  async delete(folderId: string): Promise<void> {
    const { error } = await sb.from("workflow_folders").delete().eq("id", folderId);
    if (error) throw error;
  },
};
