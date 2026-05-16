import React, { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Plus } from "lucide-react";
import NodeDeleteButton from "./NodeDeleteButton";
import NodePickerPopover from "../NodePickerPopover";
import type { NodeSpec } from "../lib/insertNode";

export interface ConditionNodeData {
  label: string | null;
  config: Record<string, unknown> | null;
  onDelete?: (id: string) => void;
  hasYesChild?: boolean;
  hasNoChild?: boolean;
  onInsertAfter?: (parentId: string, branch: "yes" | "no" | null, spec: NodeSpec) => void;
  [key: string]: unknown;
}

const ConditionNode: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const d = data as unknown as ConditionNodeData;
  const cfg = (d.config ?? {}) as { field?: string; operator?: string; value?: string };
  const summary = d.label
    || (cfg.field && cfg.operator ? `${cfg.field} ${cfg.operator.replace(/_/g, " ")}${cfg.value ? ` "${cfg.value}"` : ""}` : "Condition");
  const [yesOpen, setYesOpen] = useState(false);
  const [noOpen, setNoOpen] = useState(false);

  return (
    <div
      className={`group relative min-w-[220px] rounded-2xl border bg-card/80 px-4 pb-6 pt-3 shadow-md transition-colors cursor-pointer ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-amber-500/50"
      }`}
      style={{ overflow: "visible" }}
    >
      {d.onDelete && <NodeDeleteButton onConfirm={() => d.onDelete?.(id)} />}
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">If / Else</span>
          <span className="text-sm font-semibold text-foreground line-clamp-1">{summary}</span>
        </div>
      </div>

      <div className="mt-3 flex justify-between text-[10px] font-semibold">
        <span className="text-emerald-500">YES</span>
        <span className="text-rose-500">NO</span>
      </div>

      <Handle id="yes" type="source" position={Position.Bottom} style={{ left: "20%" }} className="!h-3 !w-3 !bg-emerald-500" />
      <Handle id="no" type="source" position={Position.Bottom} style={{ left: "80%" }} className="!h-3 !w-3 !bg-rose-500" />

      {!d.hasYesChild && d.onInsertAfter && (
        <div
          className="absolute flex flex-col items-center"
          style={{ left: "20%", top: "100%", transform: "translateX(-50%)", pointerEvents: "all" }}
        >
          <div className="h-8 w-0.5 bg-emerald-500/30" />
          <NodePickerPopover
            open={yesOpen}
            onOpenChange={setYesOpen}
            onPick={(spec) => d.onInsertAfter!(id, "yes", spec)}
            trigger={
              <button
                type="button"
                aria-label="Add step (Yes branch)"
                onClick={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-emerald-500/30 bg-card text-emerald-500 shadow-sm transition-all hover:scale-110 hover:border-emerald-500 hover:bg-emerald-500/10"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            }
          />
        </div>
      )}

      {!d.hasNoChild && d.onInsertAfter && (
        <div
          className="absolute flex flex-col items-center"
          style={{ left: "80%", top: "100%", transform: "translateX(-50%)", pointerEvents: "all" }}
        >
          <div className="h-8 w-0.5 bg-rose-500/30" />
          <NodePickerPopover
            open={noOpen}
            onOpenChange={setNoOpen}
            onPick={(spec) => d.onInsertAfter!(id, "no", spec)}
            trigger={
              <button
                type="button"
                aria-label="Add step (No branch)"
                onClick={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-rose-500/30 bg-card text-rose-500 shadow-sm transition-all hover:scale-110 hover:border-rose-500 hover:bg-rose-500/10"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            }
          />
        </div>
      )}
    </div>
  );
});

ConditionNode.displayName = "ConditionNode";

export default ConditionNode;
