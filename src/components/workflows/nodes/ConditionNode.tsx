import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import NodeDeleteButton from "./NodeDeleteButton";

export interface ConditionNodeData {
  label: string | null;
  config: Record<string, unknown> | null;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

const ConditionNode: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const d = data as unknown as ConditionNodeData;
  const cfg = (d.config ?? {}) as { field?: string; operator?: string; value?: string };
  const summary = d.label
    || (cfg.field && cfg.operator ? `${cfg.field} ${cfg.operator.replace(/_/g, " ")}${cfg.value ? ` "${cfg.value}"` : ""}` : "Condition");

  return (
    <div
      className={`group relative min-w-[220px] rounded-2xl border bg-card/80 px-4 pb-6 pt-3 backdrop-blur-sm shadow-md transition-colors cursor-pointer ${
        selected ? "border-primary" : "border-amber-500/50"
      }`}
    >
      {d.onDelete && <NodeDeleteButton onConfirm={() => d.onDelete?.(id)} />}
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">Condition</span>
          <span className="text-sm font-semibold text-foreground line-clamp-1">{summary}</span>
        </div>
      </div>

      <div className="mt-3 flex justify-between text-[10px] font-semibold">
        <span className="text-emerald-500">YES</span>
        <span className="text-rose-500">NO</span>
      </div>

      <Handle
        id="yes"
        type="source"
        position={Position.Bottom}
        style={{ left: "20%" }}
        className="!h-3 !w-3 !bg-emerald-500"
      />
      <Handle
        id="no"
        type="source"
        position={Position.Bottom}
        style={{ left: "80%" }}
        className="!h-3 !w-3 !bg-rose-500"
      />
    </div>
  );
});

ConditionNode.displayName = "ConditionNode";

export default ConditionNode;
