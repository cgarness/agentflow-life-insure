import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";
import NodeDeleteButton from "./NodeDeleteButton";

export interface WaitNodeData {
  label: string | null;
  config: Record<string, unknown> | null;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

const WaitNode: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const d = data as unknown as WaitNodeData;
  const cfg = (d.config ?? {}) as { duration?: number; unit?: string; duration_minutes?: number };
  const summary =
    d.label ||
    (cfg.duration && cfg.unit
      ? `Wait ${cfg.duration} ${cfg.unit}`
      : cfg.duration_minutes
        ? `Wait ${cfg.duration_minutes} min`
        : "Wait");

  return (
    <div
      className={`group relative min-w-[180px] rounded-2xl border bg-card/80 px-4 py-3 backdrop-blur-sm shadow-md transition-colors cursor-pointer ${
        selected ? "border-primary" : "border-sky-500/50"
      }`}
    >
      {d.onDelete && <NodeDeleteButton onConfirm={() => d.onDelete?.(id)} />}
      <Handle type="target" position={Position.Top} className="!h-3 !w-3 !bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-500">
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-500/80">Wait</span>
          <span className="text-sm font-semibold text-foreground">{summary}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !bg-muted-foreground" />
    </div>
  );
});

WaitNode.displayName = "WaitNode";

export default WaitNode;
