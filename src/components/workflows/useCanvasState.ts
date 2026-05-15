import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Edge, type Node, type NodeChange, applyNodeChanges,
  type EdgeChange, applyEdgeChanges, addEdge, type Connection,
} from "@xyflow/react";
import { toast } from "@/hooks/use-toast";
import {
  workflowNodeApi, workflowEdgeApi,
} from "@/lib/supabase-workflows";
import type { WorkflowNodeRow, WorkflowEdgeRow } from "@/lib/workflow-types";

const POSITION_DEBOUNCE_MS = 1000;

function nodeRowToFlow(row: WorkflowNodeRow): Node {
  const typeMap: Record<string, string> = {
    trigger: "trigger", action: "action", condition: "condition", wait: "wait",
  };
  return {
    id: row.id,
    type: typeMap[row.type] ?? "action",
    position: { x: row.position_x, y: row.position_y },
    data: {
      label: row.label,
      action_type: row.action_type,
      config: row.config,
      trigger_type: (row.config as { disposition_id?: string } | null)?.disposition_id ? "disposition" : undefined,
      // Carry the row through for click handlers.
      __row: row,
    },
    deletable: row.type !== "trigger",
  };
}

function edgeRowToFlow(row: WorkflowEdgeRow): Edge {
  return {
    id: row.id,
    source: row.source_node_id,
    target: row.target_node_id,
    sourceHandle: row.condition_branch ?? undefined,
    animated: false,
    data: { __row: row },
  };
}

export interface UseCanvasStateArgs {
  workflowId: string;
  organizationId: string | null;
}

export function useCanvasState({ workflowId, organizationId }: UseCanvasStateArgs) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nodeRows, edgeRows] = await Promise.all([
        workflowNodeApi.listForWorkflow(workflowId),
        workflowEdgeApi.listForWorkflow(workflowId),
      ]);
      setNodes(nodeRows.map(nodeRowToFlow));
      setEdges(edgeRows.map(edgeRowToFlow));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load workflow";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Persist position changes (debounced) and apply local node changes.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    let touched = false;
    for (const c of changes) {
      if (c.type === "position" && c.position && !c.dragging) {
        dirtyPositions.current.set(c.id, c.position);
        touched = true;
      }
    }
    if (touched) {
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(async () => {
        const updates = Array.from(dirtyPositions.current.entries()).map(([id, pos]) => ({
          id, position_x: pos.x, position_y: pos.y,
        }));
        dirtyPositions.current.clear();
        try { await workflowNodeApi.batchUpdatePositions(updates); }
        catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to save positions";
          toast({ title: msg, variant: "destructive" });
        }
      }, POSITION_DEBOUNCE_MS);
    }
  }, []);

  const onEdgesChange = useCallback(async (changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    for (const c of changes) {
      if (c.type === "remove") {
        try { await workflowEdgeApi.delete(c.id); }
        catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to remove edge";
          toast({ title: msg, variant: "destructive" });
        }
      }
    }
  }, []);

  const onConnect = useCallback(async (conn: Connection) => {
    if (!organizationId || !conn.source || !conn.target) return;
    // Validate: trigger node may not be a target.
    const sourceNode = nodes.find((n) => n.id === conn.source);
    const targetNode = nodes.find((n) => n.id === conn.target);
    if (targetNode?.type === "trigger") {
      toast({ title: "Trigger nodes cannot have incoming edges", variant: "destructive" });
      return;
    }
    const branch =
      sourceNode?.type === "condition"
        ? (conn.sourceHandle === "no" ? "no" : "yes")
        : null;
    try {
      const row = await workflowEdgeApi.create({
        workflow_id: workflowId,
        organization_id: organizationId,
        source_node_id: conn.source,
        target_node_id: conn.target,
        condition_branch: branch,
      });
      setEdges((eds) => addEdge(edgeRowToFlow(row), eds));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to connect nodes";
      toast({ title: msg, variant: "destructive" });
    }
  }, [organizationId, workflowId, nodes]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    const n = nodes.find((x) => x.id === nodeId);
    if (n?.type === "trigger") {
      toast({ title: "Trigger node cannot be deleted", variant: "destructive" });
      return;
    }
    try {
      await workflowNodeApi.delete(nodeId);
      setNodes((nds) => nds.filter((x) => x.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete node";
      toast({ title: msg, variant: "destructive" });
    }
  }, [nodes, selectedNodeId]);

  const upsertNodeLocal = useCallback((row: WorkflowNodeRow) => {
    setNodes((nds) => {
      const idx = nds.findIndex((n) => n.id === row.id);
      const next = nodeRowToFlow(row);
      if (idx === -1) return [...nds, next];
      const copy = [...nds];
      copy[idx] = next;
      return copy;
    });
  }, []);

  return {
    nodes, edges, loading, selectedNodeId, setSelectedNodeId,
    onNodesChange, onEdgesChange, onConnect,
    handleDeleteNode, upsertNodeLocal, refresh,
  };
}
