import { useId, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import IssueMark from "../editor/IssueMark";
import StepGlyph from "../editor/StepGlyph";
import type { BlockVisual } from "../steps/blockMeta";
import BranchTag from "./BranchTag";

export type StepNodeData = {
  title: string;
  summary: string;
  visual: BlockVisual;
  issueCount: number;
  /** Selected in the editor. */
  active: boolean;
  /** The trigger: nothing leads into it. */
  entry: boolean;
  /** A condition: it leaves through Yes and No. */
  split: boolean;
  /** Exits with no following step yet, each with its add button when the draft can be edited. */
  open: {branch?: "yes" | "no"; add: ReactNode}[];
  onSelect: (id: string) => void;
};
export type StepNodeType = Node<StepNodeData, "step">;

const stub = <span aria-hidden className="h-4 w-px bg-muted-foreground/50"/>;

/** One canvas card for every kind of step. The card is a real button, so the keyboard can select it. */
export default function StepNode({id, data}: NodeProps<StepNodeType>) {
  const titleId = useId();
  const detailId = useId();
  const exit = (branch?: "yes" | "no") => data.open.find(item => item.branch === branch);
  return <div className="pointer-events-auto relative w-64">
    {!data.entry && <Handle type="target" position={Position.Top} isConnectable={false}/>}
    <button type="button" data-step={id} aria-pressed={data.active} aria-labelledby={titleId} aria-describedby={detailId}
      onClick={() => data.onSelect(id)}
      className={cn("nodrag nopan flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left shadow-sm transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none",
        data.active ? "border-primary ring-1 ring-primary" : "border-border")}>
      <StepGlyph visual={data.visual}/>
      <span className="min-w-0 flex-1">
        <span id={titleId} className="line-clamp-2 break-words text-sm font-semibold text-foreground">{data.title}</span>
        <span id={detailId} className="block">
          {data.summary && <span className="line-clamp-2 break-words text-xs text-muted-foreground">{data.summary}</span>}
          <IssueMark count={data.issueCount} className="mt-1"/>
        </span>
      </span>
    </button>
    {data.split ? <>
      <Handle id="yes" type="source" position={Position.Bottom} isConnectable={false} className="!left-1/4"/>
      <Handle id="no" type="source" position={Position.Bottom} isConnectable={false} className="!left-3/4"/>
      <div className="absolute inset-x-0 top-full flex">
        {(["yes", "no"] as const).map(branch => <div key={branch} className="flex w-1/2 flex-col items-center gap-1">
          {exit(branch) && <>{stub}<BranchTag branch={branch}/>{exit(branch)!.add}</>}
        </div>)}
      </div>
    </> : <>
      <Handle type="source" position={Position.Bottom} isConnectable={false}/>
      {exit() && <div className="absolute inset-x-0 top-full flex flex-col items-center gap-1">{stub}{exit()!.add}</div>}
    </>}
  </div>;
}
