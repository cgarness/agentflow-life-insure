import { workflowNodeApi, workflowEdgeApi } from "@/lib/supabase-workflows";
import {
  ACTION_METAS, type ActionType, type NodeKind, type WorkflowNodeRow, type WorkflowEdgeRow,
} from "@/lib/workflow-types";

export type NodeSpec =
  | { kind: "action"; action_type: ActionType }
  | { kind: "condition" }
  | { kind: "wait" };

interface BaseArgs {
  workflowId: string;
  organizationId: string;
}

function defaultLabel(spec: NodeSpec): string {
  if (spec.kind === "action") {
    const meta = ACTION_METAS.find((m) => m.type === spec.action_type);
    return meta?.label ?? "Action";
  }
  if (spec.kind === "condition") return "Condition";
  return "Wait";
}

function nodeKind(spec: NodeSpec): NodeKind {
  return spec.kind === "action" ? "action" : spec.kind;
}

async function createNodeRow(
  base: BaseArgs,
  spec: NodeSpec,
): Promise<WorkflowNodeRow> {
  return workflowNodeApi.create({
    workflow_id: base.workflowId,
    organization_id: base.organizationId,
    type: nodeKind(spec),
    action_type: spec.kind === "action" ? spec.action_type : null,
    config: spec.kind === "wait" ? { duration: 1, unit: "days", duration_minutes: 1440 } : {},
    label: defaultLabel(spec),
    position_x: 0,
    position_y: 0,
  });
}

export interface InsertOnEdgeResult {
  newNode: WorkflowNodeRow;
  newEdges: WorkflowEdgeRow[];
  removedEdgeIds: string[];
}

/** Insert a new node on the existing edge A→B, yielding A→new→B. */
export async function insertNodeOnEdge(
  base: BaseArgs,
  edge: WorkflowEdgeRow,
  spec: NodeSpec,
): Promise<InsertOnEdgeResult> {
  const newNode = await createNodeRow(base, spec);
  const upstream = await workflowEdgeApi.create({
    workflow_id: base.workflowId,
    organization_id: base.organizationId,
    source_node_id: edge.source_node_id,
    target_node_id: newNode.id,
    condition_branch: edge.condition_branch ?? null,
  });

  // Drop the original edge before re-using the (source, branch) slot.
  await workflowEdgeApi.delete(edge.id);

  // For condition nodes, the downstream side has its own yes/no branches.
  // The new edge from the inserted node back to the original target is always
  // unbranched unless the new node is itself a condition.
  const downstream = await workflowEdgeApi.create({
    workflow_id: base.workflowId,
    organization_id: base.organizationId,
    source_node_id: newNode.id,
    target_node_id: edge.target_node_id,
    condition_branch: spec.kind === "condition" ? "yes" : null,
  });

  return {
    newNode,
    newEdges: [upstream, downstream],
    removedEdgeIds: [edge.id],
  };
}

export interface InsertAfterResult {
  newNode: WorkflowNodeRow;
  newEdge: WorkflowEdgeRow;
}

/** Append a node after the given parent (chain leaf or condition branch). */
export async function insertNodeAfter(
  base: BaseArgs,
  parentNodeId: string,
  branch: "yes" | "no" | null,
  spec: NodeSpec,
): Promise<InsertAfterResult> {
  const newNode = await createNodeRow(base, spec);
  const newEdge = await workflowEdgeApi.create({
    workflow_id: base.workflowId,
    organization_id: base.organizationId,
    source_node_id: parentNodeId,
    target_node_id: newNode.id,
    condition_branch: branch,
  });
  return { newNode, newEdge };
}

/**
 * Delete a node and stitch its parent edge straight to its single downstream
 * target when possible. Returns the new edge (if any) plus the deleted edge ids.
 */
export async function deleteNodeWithStitch(
  base: BaseArgs,
  nodeId: string,
  edges: WorkflowEdgeRow[],
): Promise<{ stitched: WorkflowEdgeRow | null }> {
  const incoming = edges.filter((e) => e.target_node_id === nodeId);
  const outgoing = edges.filter((e) => e.source_node_id === nodeId);

  // If the node sits in a linear chain (1 in, 1 out), stitch A→B.
  let stitched: WorkflowEdgeRow | null = null;
  if (incoming.length === 1 && outgoing.length === 1) {
    const parent = incoming[0];
    const child = outgoing[0];
    stitched = await workflowEdgeApi.create({
      workflow_id: base.workflowId,
      organization_id: base.organizationId,
      source_node_id: parent.source_node_id,
      target_node_id: child.target_node_id,
      condition_branch: parent.condition_branch ?? null,
    });
  }

  // Delete the node — CASCADE removes its connected edges in the DB.
  await workflowNodeApi.delete(nodeId);
  return { stitched };
}
