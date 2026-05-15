import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";

export interface WaitNodeData {
  label: string | null;
  config: Record<string, unknown> | null;
  [key: string]: unknown;
}

const WaitNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as WaitNodeData;
  const cfg = (d.config ?? {}) as { duration?: number; unit?: string };
  const summary =
    d.label ||
    (cfg.duration && cfg.unit ? `Wait ${cfg.duration} ${cfg.unit}` : "Wait");

  return (
    <div
      className={`min-w-[180px] rounded-2xl border bg-card/80 px-4 py-3 backdrop-blur-sm shadow-md transition-colors ${
        selected ? "border-primary" : "border-sky-500/50"
      }`}
    >
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
};

export default WaitNode;
