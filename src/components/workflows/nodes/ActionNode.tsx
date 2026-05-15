import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { actionMeta, type ActionType } from "@/lib/workflow-types";

export interface ActionNodeData {
  label: string | null;
  action_type: ActionType | null;
  config: Record<string, unknown> | null;
  [key: string]: unknown;
}

const ActionNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as ActionNodeData;
  const meta = actionMeta(d.action_type);
  const Icon = meta?.icon ?? Sparkles;
  const display = d.label || meta?.label || "Action";
  return (
    <div
      className={`min-w-[200px] rounded-2xl border bg-card/80 px-4 py-3 backdrop-blur-sm shadow-md transition-colors ${
        selected ? "border-primary" : "border-border/60"
      }`}
    >
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
    </div>
  );
};

export default ActionNode;
