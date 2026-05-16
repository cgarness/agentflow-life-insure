import React, { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, Plus } from "lucide-react";
import { formatTriggerLabelSync, TRIGGER_LABELS, type TriggerType } from "@/lib/workflow-types";
import NodePickerPopover from "../NodePickerPopover";
import type { NodeSpec } from "../lib/insertNode";

export interface TriggerNodeData {
  label: string | null;
  trigger_type?: TriggerType;
  config?: Record<string, unknown> | null;
  __row?: { config: Record<string, unknown> | null };
  isLeaf?: boolean;
  onInsertAfter?: (parentId: string, branch: "yes" | "no" | null, spec: NodeSpec) => void;
  [key: string]: unknown;
}

const TriggerNode: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const d = data as unknown as TriggerNodeData;
  const row = d.__row as { config: Record<string, unknown> | null; label: string | null } | undefined;
  const cfg = row?.config ?? d.config ?? null;
  const tType: TriggerType | undefined = d.trigger_type
    ?? (cfg && typeof cfg.trigger_type === "string" ? (cfg.trigger_type as TriggerType) : undefined);
  const display = d.label
    || (tType ? formatTriggerLabelSync(tType, cfg) : null)
    || (tType ? TRIGGER_LABELS[tType] : "Trigger");
  const [addOpen, setAddOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  return (
    <div
      className={`relative min-w-[200px] rounded-2xl border-2 px-4 py-3 shadow-lg transition-colors cursor-pointer ${
        selected ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "border-primary/60 bg-primary/5"
      }`}
      style={{ overflow: "visible" }}
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

      {d.isLeaf && d.onInsertAfter && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center"
          style={{ top: "100%", pointerEvents: "all" }}
        >
          <div className="h-8 w-0.5 bg-primary/30" />
          <NodePickerPopover
            open={addOpen}
            onOpenChange={setAddOpen}
            onPick={(spec) => d.onInsertAfter!(id, null, spec)}
            trigger={
              <button
                type="button"
                aria-label="Add step"
                onClick={(e) => e.stopPropagation()}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-primary/30 bg-card text-primary shadow-sm transition-all hover:scale-110 hover:border-primary hover:bg-primary/10"
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
          <div className="h-0.5 w-3 bg-primary/30" />
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
                className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-primary/30 bg-card text-primary shadow-sm transition-all hover:scale-110 hover:border-primary hover:bg-primary/10"
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

TriggerNode.displayName = "TriggerNode";

export default TriggerNode;
