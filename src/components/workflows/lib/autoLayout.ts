import type { WorkflowNodeRow, WorkflowEdgeRow } from "@/lib/workflow-types";

export const LAYOUT = {
  trigger_x: 0,
  trigger_y: 0,
  vertical_gap: 220,
  branch_x_offset: 160,
  trailing_gap: 110,
} as const;

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  leafAddNodes: Array<{
    id: string;
    parentId: string;
    branch: "yes" | "no" | null;
    x: number;
    y: number;
  }>;
}

/**
 * Walks the workflow graph from the trigger node and assigns vertical
 * positions. Condition nodes branch left ("yes") and right ("no"). Each leaf
 * gets a virtual leaf-add node for the trailing "+" button.
 */
export function calculateNodePositions(
  nodes: WorkflowNodeRow[],
  edges: WorkflowEdgeRow[],
): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const leafAddNodes: LayoutResult["leafAddNodes"] = [];

  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return { positions, leafAddNodes };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, WorkflowEdgeRow[]>();
  for (const e of edges) {
    const list = outgoing.get(e.source_node_id) ?? [];
    list.push(e);
    outgoing.set(e.source_node_id, list);
  }

  const visited = new Set<string>();
  const walk = (
    nodeId: string,
    x: number,
    y: number,
    incomingBranch: "yes" | "no" | null,
    parentId: string | null,
  ) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) return;
    positions.set(nodeId, { x, y });

    const outs = outgoing.get(nodeId) ?? [];
    if (node.type === "condition") {
      const yesEdge = outs.find((e) => e.condition_branch === "yes");
      const noEdge = outs.find((e) => e.condition_branch === "no");
      const childY = y + LAYOUT.vertical_gap;
      if (yesEdge?.target_node_id) {
        walk(yesEdge.target_node_id, x - LAYOUT.branch_x_offset, childY, "yes", nodeId);
      } else {
        leafAddNodes.push({
          id: `leaf-${nodeId}-yes`,
          parentId: nodeId,
          branch: "yes",
          x: x - LAYOUT.branch_x_offset,
          y: childY,
        });
      }
      if (noEdge?.target_node_id) {
        walk(noEdge.target_node_id, x + LAYOUT.branch_x_offset, childY, "no", nodeId);
      } else {
        leafAddNodes.push({
          id: `leaf-${nodeId}-no`,
          parentId: nodeId,
          branch: "no",
          x: x + LAYOUT.branch_x_offset,
          y: childY,
        });
      }
      return;
    }

    // Linear nodes (trigger, action, wait): one outgoing edge expected.
    const next = outs[0];
    if (next?.target_node_id) {
      walk(next.target_node_id, x, y + LAYOUT.vertical_gap, null, nodeId);
    } else {
      leafAddNodes.push({
        id: `leaf-${nodeId}-${incomingBranch ?? "main"}`,
        parentId: nodeId,
        branch: null,
        x,
        y: y + LAYOUT.trailing_gap + 30,
      });
    }
    void parentId;
  };

  walk(trigger.id, LAYOUT.trigger_x, LAYOUT.trigger_y, null, null);
  return { positions, leafAddNodes };
}
