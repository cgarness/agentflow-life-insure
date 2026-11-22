import { useEffect } from "react";
import { Background, Controls, ReactFlow, useNodesInitialized, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Issue } from "@/lib/automation-api";
import { cn } from "@/lib/utils";
import { graphBlock, stepSummary, stepTitle, type AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import type { SummaryNames } from "../../../supabase/functions/_shared/automations/blockRegistry";
import AutomationBlockPicker from "./AutomationBlockPicker";
import InsertEdge, { type InsertEdgeType } from "./canvas/InsertEdge";
import StepNode, { type StepNodeType } from "./canvas/StepNode";
import { layoutSteps } from "./canvas/layout";
import EmptyWorkflow from "./editor/EmptyWorkflow";
import { orderedSteps, type BlockType, type Branch } from "./lib/draftGraph";
import { stepVisual } from "./steps/blockMeta";

const nodeTypes = {step: StepNode};
const edgeTypes = {insert: InsertEdge};
const FIT = {maxZoom: 1, padding: 0.18};
// The canvas library reads these variables, so its lines and controls follow the app's colour roles in both themes.
const CHROME = "[--xy-edge-stroke:hsl(var(--muted-foreground))] [--xy-edge-stroke-width:1.5] " +
  "[--xy-background-pattern-color:hsl(var(--border))] [--xy-handle-background-color:hsl(var(--muted-foreground))] " +
  "[--xy-handle-border-color:hsl(var(--card))] [--xy-controls-button-background-color:hsl(var(--card))] " +
  "[--xy-controls-button-background-color-hover:hsl(var(--accent))] [--xy-controls-button-color:hsl(var(--foreground))] " +
  "[--xy-controls-button-color-hover:hsl(var(--foreground))] [--xy-controls-button-border-color:hsl(var(--border))]";

function FitGraph({shape}: {shape: string}) {
  const initialized = useNodesInitialized();
  const {fitView} = useReactFlow();
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => { void fitView(FIT); });
    return () => cancelAnimationFrame(frame);
  }, [shape, initialized, fitView]);
  return null;
}

interface Props {
  graph: AutomationGraph;
  selected: string | null;
  issues?: Issue[];
  /** Display names for step summaries, such as the chosen campaign. */
  names?: SummaryNames;
  /** Steps can be opened but not added. */
  readOnly?: boolean;
  /** Null clears the selection, for example after a press on the empty canvas. */
  onSelect: (id: string | null) => void;
  /** A null parent places the first step, the trigger. */
  onInsert: (parentId: string | null, branch: Branch, type: BlockType) => void;
}

/** The desktop canvas. It is mounted only at 768 px and wider; phones use the ordered timeline. */
export default function WorkflowCanvas({graph, selected, issues = [], names, readOnly, onSelect, onInsert}: Props) {
  const frame = cn("relative h-[26rem] min-h-0 overflow-hidden rounded-lg border border-border bg-muted/30 lg:h-auto lg:min-h-[22rem] lg:flex-1", CHROME);
  if (!graph.nodes.length) {
    return <section aria-label="Automation canvas" className={frame}>
      <div className="absolute inset-0 grid place-items-center overflow-y-auto">
        <EmptyWorkflow graph={graph} readOnly={readOnly} onStart={type => onInsert(null, undefined, type)}/>
      </div>
    </section>;
  }
  const add = (label: string, parent: string, branch: Branch) => readOnly ? null :
    <AutomationBlockPicker compact graph={graph} label={label} onPick={type => onInsert(parent, branch, type)}/>;
  const titles = new Map(graph.nodes.map(node => [node.id, stepTitle(node)]));
  const split = new Set(graph.nodes.filter(node => graphBlock(node)?.category === "condition").map(node => node.id));
  const positions = layoutSteps(graph);
  // Document order follows the workflow, so Tab walks the steps from the trigger down.
  const nodes: StepNodeType[] = orderedSteps(graph).map(({node}) => {
    const title = titles.get(node.id)!;
    const exits = graph.edges.filter(edge => edge.source === node.id);
    const branches: Branch[] = split.has(node.id) ? ["yes", "no"] : [undefined];
    const open = branches.filter(branch => !exits.some(edge => (edge.branch ?? undefined) === branch))
      .filter(branch => branch || !readOnly)
      .map(branch => ({branch, add: add(branch ? `Add step on ${branch} after ${title}` : `Add step after ${title}`, node.id, branch)}));
    return {id: node.id, type: "step", position: positions.get(node.id) ?? {x: 0, y: 0}, data: {
      title, summary: stepSummary(node, names), visual: stepVisual(node), active: node.id === selected,
      issueCount: issues.filter(issue => issue.node_id === node.id).length,
      entry: graphBlock(node)?.category === "trigger", split: split.has(node.id), open, onSelect,
    }};
  });
  const edges: InsertEdgeType[] = graph.edges.map(edge => {
    const branch = split.has(edge.source) ? edge.branch ?? undefined : undefined;
    const label = `Insert step${branch ? " on " + branch : ""} after ${titles.get(edge.source) ?? "this step"}`;
    return {id: edge.id, source: edge.source, target: edge.target, type: "insert", sourceHandle: branch ?? null,
      data: {branch, add: add(label, edge.source, edge.branch ?? undefined)}};
  });
  return <section aria-label="Automation canvas" className={frame}>
    <div className="absolute inset-0">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={FIT}
        nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} edgesReconnectable={false}
        elementsSelectable={false} disableKeyboardA11y deleteKeyCode={null} onPaneClick={() => onSelect(null)}
        proOptions={{hideAttribution: true}}>
        <FitGraph shape={JSON.stringify([graph.nodes.length, ...graph.edges.map(edge => [edge.source, edge.target, edge.branch])])}/>
        <Background gap={18}/><Controls showInteractive={false}/>
      </ReactFlow>
    </div>
  </section>;
}
