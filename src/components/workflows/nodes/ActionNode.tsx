import React, { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Sparkles, Plus } from "lucide-react";
import { actionMeta, type ActionType } from "@/lib/workflow-types";
import NodeDeleteButton from "./NodeDeleteButton";
import NodePickerPopover from "../NodePickerPopover";
import type { NodeSpec } from "../lib/insertNode";

export interface ActionNodeData {
  label: string | null;
  action_type: ActionType | null;
  config: Record<string, unknown> | null;
  onDelete?: (id: string) => void;
  isLeaf?: boolean;
  onInsertAfter?: (parentId: string, branch: "yes" | "no" | null, spec: NodeSpec) => void;
  [key: string]: unknown;
}

const ActionNode: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const d = data as unknown as ActionNodeData;
  const meta = actionMeta(d.action_type);
  const Icon = meta?.icon ?? Sparkles;
  const display = d.label || meta?.label || "Action";
  const [addOpen, setAddOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  return (
    <div
      className={`group relative min-w-[200px] rounded-2xl border bg-card/80 px-4 py-3 shadow-md transition-colors cursor-pointer ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border/60"
      }`}
      style={{ overflow: "visible" }}
    >
      {d.onDelete && <NodeDeleteButton onConfirm={() => d.onDelete?.(id)} />}
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Action</span>
          <span className="text-sm font-semibold text-foreground">{display}</span>
        </div>
      </div>
      {meta?.comingSoon && (
        <span className="mt-2 inline-block rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-500">
          Coming Soon
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !bg-muted-foreground" />

      {d.isLeaf && d.onInsertAfter && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center"
          style={{ top: "100%", pointerEvents: "all" }}
        >
          <div className="h-8 w-0.5 bg-border" />
          <NodePickerPopover
            open={addOpen}
            onOpenChange={setAddOpen}
            onPick={(spec) => d.onInsertAfter!(id, null, spec)}
            trigger={
              <button
                type="button"
                aria-label="Add step"
                onClick={(e) => e.stopPropagation()}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 bg-card text-muted-foreground shadow-sm transition-all hover:scale-110 hover:border-primary hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            }
          />
        </div>
      )}

      {!d.isLeaf && d.onInsertAfter && (
        <div
          className="absolute flex items-center"
          style={{ top: "50%", right: "-40px", transform: "translateY(-50%)", pointerEvents: "all" }}
        >
          <div className="h-0.5 w-3 bg-border/50" />
          <NodePickerPopover
            open={branchOpen}
            onOpenChange={setBranchOpen}
            onPick={(spec) => d.onInsertAfter!(id, null, spec)}
            trigger={
              <button
                type="button"
                aria-label="Add branch"
                title="Add branch"
                onClick={(e) => e.stopPropagation()}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/30 bg-card text-muted-foreground shadow-sm transition-all hover:scale-110 hover:border-primary hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="h-3 w-3" strokeWidth={2.5} />
              </button>
            }
          />
        </div>
      )}
    </div>
  );
});

ActionNode.displayName = "ActionNode";

export default ActionNode;
