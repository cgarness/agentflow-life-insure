import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Edge, type Node, type NodeChange, type EdgeChange } from "@xyflow/react";
import { toast } from "@/hooks/use-toast";
import { workflowNodeApi, workflowEdgeApi } from "@/lib/supabase-workflows";
import type { WorkflowNodeRow, WorkflowEdgeRow } from "@/lib/workflow-types";
import { calculateNodePositions } from "./lib/autoLayout";
import { doInsertOnEdge, doInsertAfter, doDeleteNode } from "./lib/canvasMutations";
import type { NodeSpec } from "./lib/insertNode";

const POSITION_DEBOUNCE_MS = 1000;

interface NodeExtras {
  isLeaf: boolean;
  hasYesChild?: boolean;
  hasNoChild?: boolean;
  onInsertAfter: (parentId: string, branch: "yes" | "no" | null, spec: NodeSpec) => void;
}

function nodeRowToFlow(
  row: WorkflowNodeRow, pos: { x: number; y: number },
  onDelete: (id: string) => void, selected: boolean, extras: NodeExtras,
): Node {
  return {
    id: row.id,
    type: row.type,
    position: pos,
    data: {
      label: row.label, action_type: row.action_type, config: row.config,
      onDelete, __row: row, nodeType: row.type,
      isLeaf: extras.isLeaf,
      hasYesChild: extras.hasYesChild,
      hasNoChild: extras.hasNoChild,
      onInsertAfter: extras.onInsertAfter,
    },
    deletable: row.type !== "trigger",
    selected,
  };
}

function edgeRowToFlow(row: WorkflowEdgeRow, onInsert: (edgeRowId: string, spec: NodeSpec) => void): Edge {
  return {
    id: row.id,
    source: row.source_node_id,
    target: row.target_node_id,
    sourceHandle: row.condition_branch ?? undefined,
    type: "add-button",
    data: {
      edgeRowId: row.id,
      branchLabel: row.condition_branch === "yes" ? "Yes" : row.condition_branch === "no" ? "No" : undefined,
      onPick: onInsert,
      __row: row,
    },
  };
}

export function useCanvasState({
  workflowId, organizationId,
}: { workflowId: string; organizationId: string | null }) {
  const [nodeRows, setNodeRows] = useState<WorkflowNodeRow[]>([]);
  const [edgeRows, setEdgeRows] = useState<WorkflowEdgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rfOverrides, setRfOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nodes, edges] = await Promise.all([
        workflowNodeApi.listForWorkflow(workflowId),
        workflowEdgeApi.listForWorkflow(workflowId),
      ]);
      setNodeRows(nodes); setEdgeRows(edges);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to load workflow", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    const row = nodeRows.find((n) => n.id === nodeId);
    if (!row || row.type === "trigger") return;
    const result = await doDeleteNode({ workflowId, organizationId: row.organization_id }, nodeId, edgeRows);
    if (!result) return;
    setNodeRows((prev) => prev.filter((n) => n.id !== nodeId));
    setEdgeRows((prev) => {
      const trimmed = prev.filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId);
      return result.stitched ? [...trimmed, result.stitched] : trimmed;
    });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [nodeRows, edgeRows, selectedNodeId, workflowId]);

  const handleInsertOnEdge = useCallback(async (edgeRowId: string, spec: NodeSpec) => {
    if (!organizationId) return;
    const edge = edgeRows.find((e) => e.id === edgeRowId);
    const result = await doInsertOnEdge({ workflowId, organizationId }, edge, spec);
    if (!result) return;
    setNodeRows((prev) => [...prev, result.newNode]);
    setEdgeRows((prev) => [
      ...prev.filter((e) => !result.removedEdgeIds.includes(e.id)),
      ...result.newEdges,
    ]);
  }, [organizationId, workflowId, edgeRows]);

  const handleInsertAfter = useCallback(async (
    parentId: string, branch: "yes" | "no" | null, spec: NodeSpec,
  ) => {
    if (!organizationId) return;
    const result = await doInsertAfter({ workflowId, organizationId }, parentId, branch, spec);
    if (!result) return;
    setNodeRows((prev) => [...prev, result.newNode]);
    setEdgeRows((prev) => [...prev, result.newEdge]);
  }, [organizationId, workflowId]);

  const upsertNodeLocal = useCallback((row: WorkflowNodeRow) => {
    setNodeRows((prev) => {
      const idx = prev.findIndex((n) => n.id === row.id);
      if (idx === -1) return [...prev, row];
      const next = [...prev]; next[idx] = row; return next;
    });
  }, []);

  const layout = useMemo(() => calculateNodePositions(nodeRows, edgeRows), [nodeRows, edgeRows]);

  const nodes: Node[] = useMemo(() => {
    const outMap = new Map<string, WorkflowEdgeRow[]>();
    for (const e of edgeRows) {
      const list = outMap.get(e.source_node_id) ?? [];
      list.push(e);
      outMap.set(e.source_node_id, list);
    }
    return nodeRows.map((row) => {
      const pos = rfOverrides.get(row.id) ?? layout.positions.get(row.id) ?? { x: row.position_x ?? 0, y: row.position_y ?? 0 };
      const outs = outMap.get(row.id) ?? [];
      return nodeRowToFlow(row, pos, handleDeleteNode, row.id === selectedNodeId, {
        isLeaf: outs.length === 0,
        hasYesChild: row.type === "condition" ? outs.some((e) => e.condition_branch === "yes") : undefined,
        hasNoChild: row.type === "condition" ? outs.some((e) => e.condition_branch === "no") : undefined,
        onInsertAfter: handleInsertAfter,
      });
    });
  }, [nodeRows, edgeRows, layout, rfOverrides, handleDeleteNode, handleInsertAfter, selectedNodeId]);

  const edges: Edge[] = useMemo(() => {
    return edgeRows.map((row) => edgeRowToFlow(row, handleInsertOnEdge));
  }, [edgeRows, handleInsertOnEdge]);

  /* ── onNodesChange ──
   * Handles ONLY position and selection changes from React Flow.
   * Position changes update rfOverrides; selection changes sync selectedNodeId.
   * Does NOT capture `nodes` in the closure — reads changes directly. */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let hasPositionChange = false;
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        hasPositionChange = true;
      }
      if (c.type === "select" && c.selected && !c.id.startsWith("leaf-")) {
        setSelectedNodeId(c.id);
      }
    }
    if (hasPositionChange) {
      setRfOverrides((prev) => {
        const map = new Map(prev);
        for (const c of changes) {
          if (c.type === "position" && c.position) {
            map.set(c.id, { x: c.position.x, y: c.position.y });
          }
        }
        return map;
      });
    }
    for (const c of changes) {
      if (c.type === "position" && c.position && !c.dragging && !c.id.startsWith("leaf-")) {
        dirtyPositions.current.set(c.id, c.position);
      }
    }
    if (dirtyPositions.current.size > 0) {
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(async () => {
        const updates = Array.from(dirtyPositions.current.entries()).map(([id, pos]) => ({
          id, position_x: pos.x, position_y: pos.y,
        }));
        dirtyPositions.current.clear();
        try { await workflowNodeApi.batchUpdatePositions(updates); }
        catch (e) {
          toast({ title: e instanceof Error ? e.message : "Failed to save positions", variant: "destructive" });
        }
      }, POSITION_DEBOUNCE_MS);
    }
  }, [setSelectedNodeId]);

  const onEdgesChange = useCallback((_changes: EdgeChange[]) => {
    // Edge mutations are disabled — edges are derived from DB rows.
  }, []);

  return {
    nodes, edges, loading, selectedNodeId, setSelectedNodeId,
    onNodesChange, onEdgesChange,
    handleDeleteNode, handleInsertOnEdge, handleInsertAfter,
    upsertNodeLocal, refresh,
  };
}
