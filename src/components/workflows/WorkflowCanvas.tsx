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

  const selectedNodeRow = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (!n || n.type === "leaf-add") return null;
    return (n.data as { __row?: import("@/lib/workflow-types").WorkflowNodeRow }).__row ?? null;
  }, [nodes, selectedNodeId]);

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type === "leaf-add") return;
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

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm">
      <WorkflowToolbar
        workflow={workflow}
        onBack={onBack}
        onShowExecutionLog={() => setShowLog(true)}
        onUpdated={setWorkflow}
      />

      <div className="relative flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
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
