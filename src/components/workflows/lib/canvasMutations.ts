import { toast } from "@/hooks/use-toast";
import type { WorkflowNodeRow, WorkflowEdgeRow } from "@/lib/workflow-types";
import {
  insertNodeOnEdge, insertNodeAfter, deleteNodeWithStitch, type NodeSpec,
} from "./insertNode";

interface BaseArgs {
  workflowId: string;
  organizationId: string;
}

export async function doInsertOnEdge(
  base: BaseArgs,
  edge: WorkflowEdgeRow | undefined,
  spec: NodeSpec,
): Promise<{ newNode: WorkflowNodeRow; newEdges: WorkflowEdgeRow[]; removedEdgeIds: string[] } | null> {
  if (!edge) return null;
  try {
    return await insertNodeOnEdge(base, edge, spec);
  } catch (e) {
    toast({ title: e instanceof Error ? e.message : "Failed to insert step", variant: "destructive" });
    return null;
  }
}

export async function doInsertAfter(
  base: BaseArgs,
  parentId: string,
  branch: "yes" | "no" | null,
  spec: NodeSpec,
): Promise<{ newNode: WorkflowNodeRow; newEdge: WorkflowEdgeRow } | null> {
  try {
    return await insertNodeAfter(base, parentId, branch, spec);
  } catch (e) {
    toast({ title: e instanceof Error ? e.message : "Failed to add step", variant: "destructive" });
    return null;
  }
}

export async function doDeleteNode(
  base: BaseArgs,
  nodeId: string,
  edges: WorkflowEdgeRow[],
): Promise<{ stitched: WorkflowEdgeRow | null } | null> {
  try {
    return await deleteNodeWithStitch(base, nodeId, edges);
  } catch (e) {
    toast({ title: e instanceof Error ? e.message : "Failed to delete node", variant: "destructive" });
    return null;
  }
}
