import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  type Node, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { workflowApi, workflowNodeApi } from "@/lib/supabase-workflows";
import {
  ACTION_METAS, type WorkflowRow, type NodeKind,
} from "@/lib/workflow-types";
import WorkflowToolbar from "./WorkflowToolbar";
import NodePalette, { type PaletteDragPayload } from "./NodePalette";
import TriggerNode from "./nodes/TriggerNode";
import ActionNode from "./nodes/ActionNode";
import ConditionNode from "./nodes/ConditionNode";
import WaitNode from "./nodes/WaitNode";
import ActionConfigPanel from "./panels/ActionConfigPanel";
import ConditionConfigPanel from "./panels/ConditionConfigPanel";
import WaitConfigPanel from "./panels/WaitConfigPanel";
import TriggerConfigPanel from "./panels/TriggerConfigPanel";
import WorkflowExecutionLog from "./WorkflowExecutionLog";
import { useCanvasState } from "./useCanvasState";

const nodeTypes = {
  trigger: TriggerNode, action: ActionNode, condition: ConditionNode, wait: WaitNode,
};

interface Props {
  workflowId: string;
  onBack: () => void;
}

const WorkflowCanvas: React.FC<Props> = ({ workflowId, onBack }) => {
  const { organizationId } = useOrganization();
  const [workflow, setWorkflow] = useState<WorkflowRow | null>(null);
  const [showLog, setShowLog] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const {
    nodes, edges, loading, selectedNodeId, setSelectedNodeId,
    onNodesChange, onEdgesChange, onConnect,
    handleDeleteNode, upsertNodeLocal,
  } = useCanvasState({ workflowId, organizationId });

  useEffect(() => {
    let alive = true;
    workflowApi.get(workflowId)
      .then((wf) => { if (alive) setWorkflow(wf); })
      .catch((e) => toast({ title: e instanceof Error ? e.message : "Failed to load workflow", variant: "destructive" }));
    return () => { alive = false; };
  }, [workflowId]);

  const selectedNodeRow = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (!n) return null;
    return n.data.__row as import("@/lib/workflow-types").WorkflowNodeRow;
  }, [nodes, selectedNodeId]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    if (!organizationId || !rfInstance || !wrapperRef.current) return;
    const raw = e.dataTransfer.getData("application/reactflow");
    if (!raw) return;
    let payload: PaletteDragPayload;
    try { payload = JSON.parse(raw) as PaletteDragPayload; } catch { return; }
    const position = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const isAction = payload.kind === "action";
    const kind: NodeKind = isAction ? "action" : (payload.kind as NodeKind);
    const meta = isAction ? ACTION_METAS.find((a) => a.type === payload.action_type) : undefined;
    if (isAction && meta?.comingSoon) {
      toast({ title: `${meta.label} is coming soon`, variant: "destructive" });
      return;
    }

    try {
      const row = await workflowNodeApi.create({
        workflow_id: workflowId,
        organization_id: organizationId,
        type: kind,
        action_type: isAction ? payload.action_type : null,
        config: {},
        label: isAction ? meta?.label ?? "Action" : kind === "condition" ? "Condition" : kind === "wait" ? "Wait" : "Step",
        position_x: Math.round(position.x),
        position_y: Math.round(position.y),
      });
      upsertNodeLocal(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create node";
      toast({ title: msg, variant: "destructive" });
    }
  }, [organizationId, rfInstance, workflowId, upsertNodeLocal]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onNodesDelete = useCallback(async (deleted: Node[]) => {
    for (const n of deleted) {
      await handleDeleteNode(n.id);
    }
  }, [handleDeleteNode]);

  if (!workflow) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading workflow…</div>;
  }

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm">
      <WorkflowToolbar
        workflow={workflow}
        onBack={onBack}
        onShowExecutionLog={() => setShowLog(true)}
        onUpdated={setWorkflow}
      />

      <div className="relative flex flex-1 overflow-hidden">
        <NodePalette />

        <div ref={wrapperRef} className="relative flex-1" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onNodesDelete={onNodesDelete}
              onInit={setRfInstance}
              nodeTypes={nodeTypes}
              fitView
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

          {selectedNodeRow && (() => {
            const close = () => setSelectedNodeId(null);
            const onSave = async (patch: { config: Record<string, unknown>; label?: string | null }) => {
              await workflowNodeApi.update(selectedNodeRow.id, patch);
              upsertNodeLocal({ ...selectedNodeRow, ...patch, label: patch.label ?? selectedNodeRow.label });
            };
            if (selectedNodeRow.type === "action") return <ActionConfigPanel node={selectedNodeRow} onClose={close} onSave={onSave} />;
            if (selectedNodeRow.type === "condition") return <ConditionConfigPanel node={selectedNodeRow} onClose={close} onSave={onSave} />;
            if (selectedNodeRow.type === "wait") return <WaitConfigPanel node={selectedNodeRow} onClose={close} onSave={onSave} />;
            if (selectedNodeRow.type === "trigger" && workflow) {
              return (
                <TriggerConfigPanel
                  workflow={workflow}
                  onClose={close}
                  onSaved={(updated) => {
                    setWorkflow(updated);
                    workflowNodeApi.update(selectedNodeRow.id, { config: updated.trigger_config ?? {} }).catch(() => undefined);
                    upsertNodeLocal({ ...selectedNodeRow, config: updated.trigger_config ?? {} });
                  }}
                />
              );
            }
            return null;
          })()}
        </div>
      </div>

      <WorkflowExecutionLog open={showLog} workflowId={workflowId} onClose={() => setShowLog(false)} />
    </div>
  );
};

export default WorkflowCanvas;
