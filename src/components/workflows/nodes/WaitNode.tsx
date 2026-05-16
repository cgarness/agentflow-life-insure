import React, { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock, Plus } from "lucide-react";
import NodeDeleteButton from "./NodeDeleteButton";
import NodePickerPopover from "../NodePickerPopover";
import type { NodeSpec } from "../lib/insertNode";

export interface WaitNodeData {
  label: string | null;
  config: Record<string, unknown> | null;
  onDelete?: (id: string) => void;
  isLeaf?: boolean;
  onInsertAfter?: (parentId: string, branch: "yes" | "no" | null, spec: NodeSpec) => void;
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
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div
      className={`group relative min-w-[180px] rounded-2xl border bg-card/80 px-4 py-3 shadow-md transition-colors cursor-pointer ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-sky-500/50"
      }`}
      style={{ overflow: "visible" }}
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
    </div>
  );
});

WaitNode.displayName = "WaitNode";

export default WaitNode;
