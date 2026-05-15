import { supabase } from "@/integrations/supabase/client";
import type {
  WorkflowRow, WorkflowNodeRow, WorkflowEdgeRow,
  WorkflowExecutionRow, WorkflowExecutionStepRow,
  WorkflowStatus, TriggerType, NodeKind, ActionType,
} from "@/lib/workflow-types";

// Workflow tables aren't in the generated Database types yet — same untyped
// access pattern as src/lib/tasksApi.ts.
const sb: any = supabase;

export const workflowApi = {
  async list(orgId: string): Promise<WorkflowRow[]> {
    const { data, error } = await sb
      .from("workflows")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as WorkflowRow[];
  },

  async get(workflowId: string): Promise<WorkflowRow | null> {
    const { data, error } = await sb
      .from("workflows").select("*").eq("id", workflowId).maybeSingle();
    if (error) throw error;
    return (data ?? null) as WorkflowRow | null;
  },

  async create(input: {
    organization_id: string;
    name: string;
    description?: string | null;
    trigger_type: TriggerType;
    trigger_config: Record<string, unknown>;
    created_by?: string | null;
  }): Promise<WorkflowRow> {
    const { data, error } = await sb
      .from("workflows")
      .insert({ ...input, status: "draft" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as WorkflowRow;
  },

  async update(
    workflowId: string,
    patch: Partial<Pick<WorkflowRow, "name" | "description" | "status" | "trigger_type" | "trigger_config">>,
  ): Promise<void> {
    const { error } = await sb.from("workflows").update(patch).eq("id", workflowId);
    if (error) throw error;
  },

  async setStatus(workflowId: string, status: WorkflowStatus): Promise<void> {
    const { error } = await sb.from("workflows").update({ status }).eq("id", workflowId);
    if (error) throw error;
  },

  async executionCounts(orgId: string, workflowIds: string[]): Promise<Record<string, number>> {
    if (workflowIds.length === 0) return {};
    const { data, error } = await sb
      .from("workflow_executions")
      .select("workflow_id")
      .eq("organization_id", orgId)
      .in("workflow_id", workflowIds);
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ workflow_id: string }>) {
      counts[row.workflow_id] = (counts[row.workflow_id] ?? 0) + 1;
    }
    return counts;
  },
};

export const workflowNodeApi = {
  async listForWorkflow(workflowId: string): Promise<WorkflowNodeRow[]> {
    const { data, error } = await sb
      .from("workflow_nodes")
      .select("*")
      .eq("workflow_id", workflowId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as WorkflowNodeRow[];
  },

  async create(input: {
    workflow_id: string;
    organization_id: string;
    type: NodeKind;
    action_type?: ActionType | null;
    config?: Record<string, unknown> | null;
    label?: string | null;
    position_x: number;
    position_y: number;
  }): Promise<WorkflowNodeRow> {
    const { data, error } = await sb
      .from("workflow_nodes")
      .insert(input)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as WorkflowNodeRow;
  },

  async update(
    nodeId: string,
    patch: Partial<Pick<WorkflowNodeRow, "label" | "config" | "action_type" | "position_x" | "position_y">>,
  ): Promise<void> {
    const { error } = await sb.from("workflow_nodes").update(patch).eq("id", nodeId);
    if (error) throw error;
  },

  async delete(nodeId: string): Promise<void> {
    const { error } = await sb.from("workflow_nodes").delete().eq("id", nodeId);
    if (error) throw error;
  },

  async batchUpdatePositions(
    updates: Array<{ id: string; position_x: number; position_y: number }>,
  ): Promise<void> {
    await Promise.all(updates.map((u) =>
      sb.from("workflow_nodes")
        .update({ position_x: u.position_x, position_y: u.position_y })
        .eq("id", u.id)
    ));
  },
};

export const workflowEdgeApi = {
  async listForWorkflow(workflowId: string): Promise<WorkflowEdgeRow[]> {
    const { data, error } = await sb
      .from("workflow_edges")
      .select("*")
      .eq("workflow_id", workflowId);
    if (error) throw error;
    return (data ?? []) as WorkflowEdgeRow[];
  },

  async create(input: {
    workflow_id: string;
    organization_id: string;
    source_node_id: string;
    target_node_id: string;
    condition_branch?: "yes" | "no" | null;
  }): Promise<WorkflowEdgeRow> {
    const { data, error } = await sb
      .from("workflow_edges")
      .insert(input)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data as WorkflowEdgeRow;
  },

  async delete(edgeId: string): Promise<void> {
    const { error } = await sb.from("workflow_edges").delete().eq("id", edgeId);
    if (error) throw error;
  },
};

export const workflowExecutionApi = {
  async listForWorkflow(workflowId: string, limit = 50): Promise<WorkflowExecutionRow[]> {
    const { data, error } = await sb
      .from("workflow_executions")
      .select("*")
      .eq("workflow_id", workflowId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as WorkflowExecutionRow[];
  },

  async listSteps(executionId: string): Promise<WorkflowExecutionStepRow[]> {
    const { data, error } = await sb
      .from("workflow_execution_steps")
      .select("*")
      .eq("execution_id", executionId)
      .order("started_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as WorkflowExecutionStepRow[];
  },
};
