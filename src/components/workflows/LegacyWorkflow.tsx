import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { WorkflowNodeRow, WorkflowEdgeRow } from "@/lib/workflow-types";
import WorkflowExecutionLog from "./WorkflowExecutionLog";
import TriggerNode from "./nodes/TriggerNode";
import ActionNode from "./nodes/ActionNode";
import ConditionNode from "./nodes/ConditionNode";
import WaitNode from "./nodes/WaitNode";

const nodeTypes = {trigger: TriggerNode, action: ActionNode, condition: ConditionNode, wait: WaitNode};
export default function LegacyWorkflow({id, org}: {id: string; org: string}) {
  const [log, setLog] = useState(false);
  const graph = useQuery({
    queryKey: ["legacy-automation",org,id],
    queryFn: async () => {
      const [nodes,edges] = await Promise.all(["workflow_nodes","workflow_edges"].map(table =>
        supabase.from(table as never).select("*").eq("organization_id",org).eq("workflow_id",id)));
      if (nodes.error || edges.error) throw new Error((nodes.error || edges.error)!.message);
      return {nodes: nodes.data as WorkflowNodeRow[], edges: edges.data as WorkflowEdgeRow[]};
    },
  });
  if (graph.isError) return <p role="alert">The saved graph could not be loaded.</p>;
  if (!graph.data) return <p role="status">Loading saved graph…</p>;
  const nodes = graph.data.nodes.map(node => ({
    id: node.id, type: node.type in nodeTypes ? node.type : "default",
    position: {x: node.position_x,y: node.position_y}, data: {...node, label: node.label ?? node.action_type ?? node.type},
  }));
  const edges = graph.data.edges.map(edge => ({
    id: edge.id, source: edge.source_node_id, target: edge.target_node_id, label: edge.condition_branch, sourceHandle: edge.condition_branch,
  }));
  return <section className="space-y-3">
    <p>This automation uses the original graph format. Inspect its saved steps and history here.</p>
    <div className="h-96 rounded-lg border"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView
      nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}><Background/><Controls/></ReactFlow></div>
    {graph.data.nodes.map(node => <details key={node.id}><summary>{node.label ?? node.action_type ?? node.type}</summary>
      <pre className="whitespace-pre-wrap break-all rounded border p-2">{JSON.stringify(node.config,null,2)}</pre></details>)}
    <Button variant="outline" onClick={() => setLog(true)}>Execution history</Button>
    <WorkflowExecutionLog open={log} workflowId={id} organizationId={org} onClose={() => setLog(false)}/>
  </section>;
}
