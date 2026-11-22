import { useRef } from "react";
import type { Issue } from "@/lib/automation-api";
import type { AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import type { SummaryNames } from "../../../supabase/functions/_shared/automations/blockRegistry";
import EmptyWorkflow from "./editor/EmptyWorkflow";
import { moveStep, orderedSteps, removeStep, type BlockType, type Branch } from "./lib/draftGraph";
import StepRow, { type RowAction } from "./steps/StepRow";

interface Props {
  graph: AutomationGraph;
  selected: string | null;
  issues: Issue[];
  /** Display names for step summaries, such as the chosen campaign. */
  names?: SummaryNames;
  /** Steps can be opened but not added, moved or removed. */
  readOnly?: boolean;
  onSelect: (id: string) => void;
  /** A null parent places the first step, the trigger. */
  onInsert: (parentId: string | null, branch: Branch, type: BlockType) => void;
  onChange: (graph: AutomationGraph) => void;
}

/** The ordered list of steps. It is the desktop List view and the phone timeline. */
export default function OrderedWorkflowSteps({graph, selected, issues, names, readOnly, onSelect, onInsert, onChange}: Props) {
  const list = useRef<HTMLOListElement>(null);
  if (!graph.nodes.length) {
    return <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-border bg-card">
      <EmptyWorkflow graph={graph} readOnly={readOnly} onStart={type => onInsert(null, undefined, type)}/>
    </div>;
  }
  const steps = orderedSteps(graph);
  const changes = (id: string): Record<RowAction, AutomationGraph> => ({
    up: moveStep(graph, id, "up"), down: moveStep(graph, id, "down"), remove: removeStep(graph, id),
  });

  // A reorder can move the pressed row in the document, and a removal deletes it. Either way the
  // browser drops focus, so it is put back on the same control or on the step that now sits there.
  function act(id: string, index: number, action: RowAction) {
    onChange(changes(id)[action]);
    requestAnimationFrame(() => {
      const rows = Array.from(list.current?.children ?? []) as HTMLElement[];
      const row = action === "remove" ? rows[Math.max(index - 1, 0)] : rows.find(item => item.dataset.row === id);
      const control = action === "remove" ? null : row?.querySelector<HTMLElement>(`[data-action="${action}"]:not(:disabled)`);
      (control ?? row?.querySelector<HTMLElement>("[data-step]"))?.focus();
    });
  }

  return <ol ref={list} role="list" aria-label="Ordered steps">
    {steps.map((step, index) => {
      const next = changes(step.node.id);
      return <StepRow key={step.node.id} graph={graph} step={step} names={names} readOnly={readOnly}
        selected={selected === step.node.id} issueCount={issues.filter(issue => issue.node_id === step.node.id).length}
        allowed={{up: next.up !== graph, down: next.down !== graph, remove: next.remove !== graph}}
        onSelect={onSelect} onInsert={onInsert} onAction={action => act(step.node.id, index, action)}/>;
    })}
  </ol>;
}
