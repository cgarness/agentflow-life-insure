import type { WorkflowNodeRow, WorkflowEdgeRow } from "@/lib/workflow-types";

export const LAYOUT = {
  trigger_x: 0,
  trigger_y: 0,
  vertical_gap: 180,
  branch_x_offset: 200,
  trailing_gap: 100,
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
    depth: number = 0,
  ) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) return;
    positions.set(nodeId, { x, y });

    const outs = outgoing.get(nodeId) ?? [];
    const currentOffset = LAYOUT.branch_x_offset / Math.pow(2, depth);

    if (node.type === "condition") {
      const yesEdge = outs.find((e) => e.condition_branch === "yes");
      const noEdge = outs.find((e) => e.condition_branch === "no");
      const childY = y + LAYOUT.vertical_gap;
      if (yesEdge?.target_node_id) {
        walk(yesEdge.target_node_id, x - currentOffset, childY, "yes", nodeId, depth + 1);
      } else {
        leafAddNodes.push({
          id: `leaf-${nodeId}-yes`,
          parentId: nodeId,
          branch: "yes",
          x: x - currentOffset,
          y: y + LAYOUT.trailing_gap,
        });
      }
      if (noEdge?.target_node_id) {
        walk(noEdge.target_node_id, x + currentOffset, childY, "no", nodeId, depth + 1);
      } else {
        leafAddNodes.push({
          id: `leaf-${nodeId}-no`,
          parentId: nodeId,
          branch: "no",
          x: x + currentOffset,
          y: y + LAYOUT.trailing_gap,
        });
      }
      return;
    }

    if (outs.length === 0) {
      // Leaf — "+" handled by node component
    } else if (outs.length === 1) {
      walk(outs[0].target_node_id, x, y + LAYOUT.vertical_gap, null, nodeId, depth);
    } else {
      // Multiple outgoing edges — spread children horizontally
      const childY = y + LAYOUT.vertical_gap;
      const mid = (outs.length - 1) / 2;
      outs.forEach((edge, i) => {
        if (edge.target_node_id) {
          walk(edge.target_node_id, x + (i - mid) * currentOffset, childY, null, nodeId, depth + 1);
        }
      });
    }
    void parentId;
  };

  walk(trigger.id, LAYOUT.trigger_x, LAYOUT.trigger_y, null, null, 0);
  return { positions, leafAddNodes };
}
