import { useEffect } from "react";
import { ReactFlow, Background, Controls, useNodesInitialized, useReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import TriggerNode from "./nodes/TriggerNode";
import ActionNode from "./nodes/ActionNode";
import ConditionNode from "./nodes/ConditionNode";
import WaitNode from "./nodes/WaitNode";
import { calculateNodePositions } from "./lib/autoLayout";
import type { NodeKind } from "@/lib/workflow-types";
import { graphBlock, type AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import { type BlockType, type Branch } from "./lib/draftGraph";
import AutomationBlockPicker from "./AutomationBlockPicker";
import AddButtonEdge from "./edges/AddButtonEdge";

const renderers = {trigger: TriggerNode, action: ActionNode, condition: ConditionNode, wait: WaitNode};
function DraftNode(props: NodeProps) {
  const Renderer = renderers[props.type as keyof typeof renderers] ?? ActionNode;
  return <div className="relative"><Renderer {...props}/>
    <div className="absolute inset-x-0 top-full flex justify-around pt-1">{props.data.menu as React.ReactNode}</div>
  </div>;
}
const nodeTypes = {trigger: DraftNode, action: DraftNode, condition: DraftNode, wait: DraftNode};
const edgeTypes = {insert: AddButtonEdge};

function FitGraph({shape}: {shape: string}) {
  const initialized = useNodesInitialized();
  const {fitView} = useReactFlow();
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => { void fitView({maxZoom: 1, padding: 0.18}); });
    return () => cancelAnimationFrame(frame);
  }, [shape, initialized, fitView]);
  return null;
}

interface Props {
  graph: AutomationGraph;
  selected: string | null;
  onSelect: (id: string) => void;
  onInsert: (id: string, branch: Branch, type: BlockType) => void;
}

export default function WorkflowCanvas({graph, selected, onSelect, onInsert}: Props) {
  function plus(id: string, branch?: Branch, edge = false) {
    const label = edge ? "Insert step" : branch ? "Add step on " + branch : "Add step";
    return <AutomationBlockPicker key={branch ?? id} compact label={label} onPick={type => onInsert(id,branch,type)}/>;
  }
  function leafMenus(id: string, condition: boolean) {
    const outgoing = graph.edges.filter(edge => edge.source === id);
    if (!condition) return !outgoing.length && plus(id);
    return (["yes","no"] as const).map(branch => outgoing.some(edge => edge.branch === branch) ? null : plus(id,branch));
  }
  const renderNodes = graph.nodes.map(node => ({
    id: node.id, type: (graphBlock(node)?.category ?? "action") as NodeKind,
    data: { label: graphBlock(node)?.label ?? node.type, action_type: node.type, config: node.config, menu: leafMenus(node.id,graphBlock(node)?.category === "condition") },
    selected: node.id === selected,
  }));
  const edges = graph.edges.map(edge => ({
    ...edge, source_node_id: edge.source, target_node_id: edge.target,
    type: "insert", data: {edgeRowId: edge.id, menu: plus(edge.source,edge.branch ?? undefined,true), branchLabel: edge.branch === "yes" ? "Yes" : edge.branch === "no" ? "No" : undefined},
    sourceHandle: edge.branch, condition_branch: edge.branch ?? null, label: edge.branch,
  }));
  const layout = calculateNodePositions(renderNodes, edges);
  const nodes = renderNodes.map((node,index) => ({
    ...node, position: layout.positions.get(node.id) ?? {x: 0, y: index * 180},
  }));
  return <div className="hidden h-[28rem] rounded-xl border bg-muted/20 md:block" aria-label="Automation canvas">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{maxZoom:1,padding:0.18}}
      nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
      onNodeClick={(_, node) => onSelect(node.id)} proOptions={{hideAttribution: true}}>
      <FitGraph shape={JSON.stringify(edges.map(edge => [edge.source,edge.target,edge.branch]))}/>
      <Background gap={18}/><Controls showInteractive={false}/>
    </ReactFlow>
  </div>;
}
