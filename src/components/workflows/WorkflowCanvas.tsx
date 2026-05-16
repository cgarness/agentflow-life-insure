import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { workflowApi, workflowNodeApi } from "@/lib/supabase-workflows";
import { type WorkflowRow } from "@/lib/workflow-types";
import WorkflowToolbar from "./WorkflowToolbar";
import TriggerNode from "./nodes/TriggerNode";
import ActionNode from "./nodes/ActionNode";
import ConditionNode from "./nodes/ConditionNode";
import WaitNode from "./nodes/WaitNode";
import LeafAddNode from "./nodes/LeafAddNode";
import AddButtonEdge from "./edges/AddButtonEdge";
import ActionConfigPanel from "./panels/ActionConfigPanel";
import ConditionConfigPanel from "./panels/ConditionConfigPanel";
import WaitConfigPanel from "./panels/WaitConfigPanel";
import TriggerConfigPanel from "./panels/TriggerConfigPanel";
import WorkflowExecutionLog from "./WorkflowExecutionLog";
import { useCanvasState } from "./useCanvasState";

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  wait: WaitNode,
  "leaf-add": LeafAddNode,
};

const edgeTypes = { "add-button": AddButtonEdge };

interface Props {
  workflowId: string;
  onBack: () => void;
}

const WorkflowCanvas: React.FC<Props> = ({ workflowId, onBack }) => {
  const { organizationId } = useOrganization();
  const [workflow, setWorkflow] = useState<WorkflowRow | null>(null);
  const [showLog, setShowLog] = useState(false);
  const {
    nodes, edges, loading, selectedNodeId, setSelectedNodeId,
    onNodesChange, onEdgesChange, handleDeleteNode, upsertNodeLocal,
  } = useCanvasState({ workflowId, organizationId });

  useEffect(() => {
    let alive = true;
    workflowApi.get(workflowId)
      .then((wf) => { if (alive) setWorkflow(wf); })
      .catch((e) => toast({ title: e instanceof Error ? e.message : "Failed to load workflow", variant: "destructive" }));
    return () => { alive = false; };
  }, [workflowId]);

  const selectedNode = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (!n || n.type === "leaf-add") return null;
    return n;
  }, [nodes, selectedNodeId]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type === "leaf-add") return;
    toast({ title: `[DEBUG] onNodeClick: ${node.id} type=${node.type}` });
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onNodesDelete = useCallback(async (deleted: Node[]) => {
    for (const n of deleted) {
      if (n.type !== "leaf-add" && n.type !== "trigger") {
        await handleDeleteNode(n.id);
      }
    }
  }, [handleDeleteNode]);

  if (!workflow) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading workflow…</div>;
  }

  const renderPanel = () => {
    if (!selectedNode) return null;
    const row = selectedNode.data.__row as import("@/lib/workflow-types").WorkflowNodeRow;
    const close = () => setSelectedNodeId(null);
    const onSave = async (patch: { config: Record<string, unknown>; label?: string | null }) => {
      await workflowNodeApi.update(row.id, patch);
      upsertNodeLocal({ ...row, ...patch, label: patch.label ?? row.label });
    };
    const nodeType = selectedNode.data.nodeType;
    if (nodeType === "action") return <ActionConfigPanel node={row} onClose={close} onSave={onSave} />;
    if (nodeType === "condition") return <ConditionConfigPanel node={row} onClose={close} onSave={onSave} />;
    if (nodeType === "wait") return <WaitConfigPanel node={row} onClose={close} onSave={onSave} />;
    if (nodeType === "trigger" && workflow) {
      return (
        <TriggerConfigPanel
          workflow={workflow}
          onClose={close}
          onSaved={(updated) => {
            setWorkflow(updated);
            workflowNodeApi.update(row.id, { config: updated.trigger_config ?? {} }).catch(() => undefined);
            upsertNodeLocal({ ...row, config: updated.trigger_config ?? {} });
          }}
        />
      );
    }
    return null;
  };

  return (
    <>
      <div className="flex h-[calc(100vh-180px)] min-h-[600px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/30">
        <WorkflowToolbar
          workflow={workflow}
          onBack={onBack}
          onShowExecutionLog={() => setShowLog(true)}
          onUpdated={setWorkflow}
        />

        <div className="relative flex-1 overflow-hidden">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={() => { toast({ title: "[DEBUG] onPaneClick fired" }); setSelectedNodeId(null); }}
              onNodesDelete={onNodesDelete}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesConnectable={false}
              edgesFocusable={false}
              edgesReconnectable={false}
              fitView
              fitViewOptions={{ padding: 0.3, minZoom: 0.4, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
              style={{ background: "transparent" }}
            >
              <Background gap={16} className="!bg-transparent opacity-50" />
              <Controls className="!bg-card !border-border/50 !rounded-lg" />
              <MiniMap pannable zoomable className="!bg-card/80 !border !border-border/50 !rounded-lg" />
            </ReactFlow>
          </ReactFlowProvider>

          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-card/30 text-sm text-muted-foreground">
              Loading canvas…
            </div>
          )}

          {/* DEBUG — remove after diagnosing */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-[200] rounded bg-black/80 px-2 py-1 text-[10px] font-mono text-white">
            selectedNodeId: {selectedNodeId ?? "null"} | selectedNode: {selectedNode ? `${selectedNode.data.nodeType}` : "null"} | panel: {selectedNode ? "YES" : "NO"}
          </div>
        </div>

        <WorkflowExecutionLog open={showLog} workflowId={workflowId} onClose={() => setShowLog(false)} />
      </div>

      {/* Panel rendered OUTSIDE the canvas container — no backdrop-blur stacking context, no overflow clipping */}
      {renderPanel()}
    </>
  );
};

export default WorkflowCanvas;
