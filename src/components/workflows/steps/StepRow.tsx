import { useId } from "react";
import { ArrowDown, ArrowUp, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { graphBlock, stepSummary, stepTitle, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";
import type { SummaryNames } from "../../../../supabase/functions/_shared/automations/blockRegistry";
import AutomationBlockPicker from "../AutomationBlockPicker";
import IssueMark from "../editor/IssueMark";
import StepGlyph from "../editor/StepGlyph";
import type { BlockType, Branch, OrderedStep } from "../lib/draftGraph";
import { stepVisual } from "./blockMeta";

export type RowAction = "up" | "down" | "remove";
interface Props {
  graph: AutomationGraph;
  step: OrderedStep;
  selected: boolean;
  issueCount: number;
  names?: SummaryNames;
  readOnly?: boolean;
  /** Which of Move up, Move down and Remove apply to this step. */
  allowed: Record<RowAction, boolean>;
  onSelect: (id: string) => void;
  onInsert: (parentId: string, branch: Branch, type: BlockType) => void;
  onAction: (action: RowAction) => void;
}

// Branch steps step in once per level so a path reads as a group.
const INDENT = ["", "ml-4", "ml-8", "ml-12"];
const ACTIONS: {action: RowAction; label: string; icon: LucideIcon}[] = [
  {action: "up", label: "Move up", icon: ArrowUp},
  {action: "down", label: "Move down", icon: ArrowDown},
  {action: "remove", label: "Remove", icon: Trash2},
];

/** One step of the ordered list, which is also the phone timeline. */
export default function StepRow({graph, step, selected, issueCount, names, readOnly, allowed, onSelect, onInsert, onAction}: Props) {
  const {node, path, depth} = step;
  const titleId = useId();
  const detailId = useId();
  const category = graphBlock(node)?.category;
  const summary = stepSummary(node, names);
  const continues = graph.edges.some(edge => edge.source === node.id);
  const branches: Branch[] = category === "condition" ? ["yes", "no"] : [undefined];
  return <li data-row={node.id} className={cn("min-w-0", INDENT[Math.min(depth, INDENT.length - 1)])}>
    <div className={cn("rounded-lg border bg-card transition-colors duration-150",
      selected ? "border-primary ring-1 ring-primary" : "border-border")}>
      {path && <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">{path} path</p>}
      <div className="flex items-center gap-1 p-1.5">
        {/* The name is exactly the step title; the summary and issue marker are its description. */}
        <button type="button" data-step={node.id} aria-pressed={selected} aria-labelledby={titleId} aria-describedby={detailId}
          onClick={() => onSelect(node.id)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none">
          <StepGlyph visual={stepVisual(node)}/>
          <span className="min-w-0 flex-1">
            <span id={titleId} className="line-clamp-2 break-words text-sm font-semibold text-foreground">{stepTitle(node)}</span>
            <span id={detailId} className="block">
              {summary && <span className="line-clamp-2 break-words text-xs text-muted-foreground">{summary}</span>}
              <IssueMark count={issueCount} className="mt-1"/>
            </span>
          </span>
        </button>
        {category !== "trigger" && !readOnly && <div className="flex shrink-0 items-center">
          {ACTIONS.map(({action, label, icon: Icon}) => <Button key={action} type="button" variant="ghost" size="icon"
            data-action={action} aria-label={label} title={label} disabled={!allowed[action]}
            className="h-11 w-11 md:h-9 md:w-9" onClick={() => onAction(action)}><Icon aria-hidden/></Button>)}
        </div>}
      </div>
    </div>
    {/* Connector rail: drawn only where another step really follows this one. */}
    <div className={cn("ml-7 flex flex-wrap items-center gap-2 border-l pl-4", readOnly ? "h-3" : "py-2",
      continues ? "border-muted-foreground/50" : "border-transparent")}>
      {!readOnly && branches.map(branch => <AutomationBlockPicker key={branch ?? "next"} graph={graph}
        label={branch ? "Add step on " + branch : "Add step"} onPick={type => onInsert(node.id, branch, type)}/>)}
    </div>
  </li>;
}
