import { Button } from "@/components/ui/button";
import AutomationBlockPicker from "./AutomationBlockPicker";
import { graphBlock, type AutomationGraph } from "../../../supabase/functions/_shared/automations/graph";
import { insertStep, moveStep, newNode, orderedSteps, removeStep, type Branch } from "./lib/draftGraph";
import type { Issue } from "@/lib/automation-api";

interface Props {
  graph: AutomationGraph;
  onChange: (graph: AutomationGraph) => void;
  onSelect: (id: string) => void;
  selected: string | null;
  issues: Issue[];
}

export default function OrderedWorkflowSteps({graph, onChange, onSelect, selected, issues}: Props) {
  function choose(parentId?: string, branch?: Branch) {
    const label = !parentId ? "Choose trigger" : branch ? "Add step on " + branch : "Add step";
    return <AutomationBlockPicker key={branch ?? parentId ?? "trigger"} triggerOnly={!parentId} label={label} onPick={type => {
      const node = newNode(type);
      onChange(parentId ? insertStep(graph, parentId, branch, node) : {...graph, nodes: [node]});
      onSelect(node.id);
    }}/>;
  }
  if (!graph.nodes.length) return <div className="grid min-h-52 place-items-center rounded-xl border border-dashed bg-card">{choose()}</div>;
  return <ol aria-label="Ordered steps" className="space-y-2">
    {orderedSteps(graph).map(({node, path}) => {
      const up = moveStep(graph, node.id, "up");
      const down = moveStep(graph, node.id, "down");
      const removal = removeStep(graph, node.id);
      const errors = issues.filter(issue => issue.node_id === node.id);
      return <li className="rounded-lg border bg-card p-3" key={node.id}>
        {path && <span className="text-xs text-muted-foreground">{path} path</span>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={selected === node.id ? "secondary" : "ghost"} aria-pressed={selected === node.id}
            onClick={() => onSelect(node.id)}>{graphBlock(node)?.label ?? node.type}</Button>
          {graphBlock(node)?.category !== "trigger" && <>
            <Button size="sm" variant="ghost" disabled={up === graph} onClick={() => onChange(up)}>Move up</Button>
            <Button size="sm" variant="ghost" disabled={down === graph} onClick={() => onChange(down)}>Move down</Button>
            <Button size="sm" variant="ghost" disabled={removal === graph} onClick={() => onChange(removal)}>Remove</Button>
          </>}
        </div>
        {errors.map((error,i) => <p className="text-sm text-red-700 dark:text-red-300" key={i}>{error.message}</p>)}
        <div className="mt-2 flex flex-wrap gap-2">
          {graphBlock(node)?.category === "condition" ? (["yes","no"] as const).map(branch => choose(node.id, branch)) : choose(node.id)}
        </div>
      </li>;
    })}
  </ol>;
}
