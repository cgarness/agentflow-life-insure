import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMinWidth } from "@/hooks/useMinWidth";
import type { Issue } from "@/lib/automation-api";
import { graphBlock, type AutomationGraph, type AutomationNode } from "../../../../supabase/functions/_shared/automations/graph";
import type { SummaryNames } from "../../../../supabase/functions/_shared/automations/blockRegistry";
import StepInspector from "../inspector/StepInspector";
import StepInspectorSheet from "../inspector/StepInspectorSheet";
import { insertStep, moveStep, newNode, removeStep, replaceStep, type BlockType, type Branch } from "../lib/draftGraph";
import OrderedWorkflowSteps from "../OrderedWorkflowSteps";
import WorkflowCanvas from "../WorkflowCanvas";
import RunRules from "./RunRules";

interface Props {
  graph: AutomationGraph;
  selected: string | null;
  issues: Issue[];
  names: SummaryNames;
  scope: string;
  readOnly: boolean;
  onChange: (graph: AutomationGraph) => void;
  onSelect: (id: string | null) => void;
}
type View = "canvas" | "list";

/** Where the workflow is built. A desktop shows the canvas or the list beside the settings; a phone shows the timeline. */
export default function WorkflowWorkspace({graph, selected, issues, names, scope, readOnly, onChange, onSelect}: Props) {
  const desktop = useMinWidth(768);
  const [view, setView] = useState<View>("canvas");
  const node = graph.nodes.find(step => step.id === selected);

  function insert(parent: string | null, branch: Branch, type: BlockType) {
    const step = newNode(type);
    onChange(parent ? insertStep(graph, parent, branch, step) : {...graph, nodes: [...graph.nodes, step]});
    onSelect(step.id);
  }
  const moved = (step: AutomationNode, direction: "up" | "down") => moveStep(graph, step.id, direction);
  const actions = (step: AutomationNode) => graphBlock(step)?.category === "trigger" || readOnly ? undefined : <>
    <Button type="button" variant="outline" size="sm" className="h-11 md:h-9" disabled={moved(step, "up") === graph}
      onClick={() => onChange(moved(step, "up"))}><ArrowUp aria-hidden="true"/>Move step up</Button>
    <Button type="button" variant="outline" size="sm" className="h-11 md:h-9" disabled={moved(step, "down") === graph}
      onClick={() => onChange(moved(step, "down"))}><ArrowDown aria-hidden="true"/>Move step down</Button>
    <Button type="button" variant="ghost" size="sm" className="h-11 md:h-9" disabled={removeStep(graph, step.id) === graph}
      onClick={() => { onChange(removeStep(graph, step.id)); onSelect(null); }}><Trash2 aria-hidden="true"/>Remove step</Button>
  </>;
  const inspector = node && {
    graph, node, scope, readOnly, issues: issues.filter(issue => issue.node_id === node.id),
    onChange: (step: AutomationNode) => onChange(replaceStep(graph, step)),
  };
  const list = <OrderedWorkflowSteps graph={graph} selected={selected} issues={issues} names={names} readOnly={readOnly}
    onSelect={onSelect} onInsert={insert} onChange={onChange}/>;

  if (!desktop) {
    return <div className="space-y-4">
      {list}
      <RunRules graph={graph} readOnly={readOnly} onChange={onChange}/>
      {inspector && <StepInspectorSheet {...inspector} open onOpenChange={open => { if (!open) onSelect(null); }}/>}
    </div>;
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <ToggleGroup type="single" variant="outline" size="sm" aria-label="Workflow view" className="justify-start" value={view}
      onValueChange={next => { if (next) setView(next as View); }}>
      <ToggleGroupItem value="canvas">Canvas</ToggleGroupItem>
      <ToggleGroupItem value="list">List</ToggleGroupItem>
    </ToggleGroup>
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-h-0 min-w-0 flex-col">
        {view === "canvas"
          ? <WorkflowCanvas graph={graph} selected={selected} issues={issues} names={names} readOnly={readOnly}
            onSelect={onSelect} onInsert={insert}/>
          : <div className="min-h-0 overflow-y-auto pr-1">{list}</div>}
      </div>
      <aside className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto">
        {inspector
          ? <StepInspector {...inspector} actions={actions(inspector.node)} onClose={() => onSelect(null)}/>
          : <>
            <RunRules graph={graph} readOnly={readOnly} onChange={onChange}/>
            {graph.nodes.length > 0 && <p className="px-1 text-xs text-muted-foreground">Select a step to change its settings.</p>}
          </>}
      </aside>
    </div>
  </div>;
}
