import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/workflow-types";

export interface TriggerNodeData {
  label: string | null;
  trigger_type: TriggerType;
  [key: string]: unknown;
}

const TriggerNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as TriggerNodeData;
  const display = d.label || TRIGGER_LABELS[d.trigger_type] || "Trigger";
  return (
    <div
      className={`min-w-[200px] rounded-2xl border-2 px-4 py-3 backdrop-blur-sm shadow-lg transition-colors ${
        selected ? "border-primary bg-primary/10" : "border-primary/60 bg-primary/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
          <Zap className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">Trigger</span>
          <span className="text-sm font-semibold text-foreground">{display}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-3 !w-3 !bg-primary" />
    </div>
  );
};

export default TriggerNode;
