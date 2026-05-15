import React, { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import NodePickerPopover from "../NodePickerPopover";
import type { NodeSpec } from "../lib/insertNode";

export interface LeafAddNodeData {
  parentId: string;
  branch: "yes" | "no" | null;
  onPick: (parentId: string, branch: "yes" | "no" | null, spec: NodeSpec) => void;
  [key: string]: unknown;
}

const LeafAddNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as unknown as LeafAddNodeData;
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex flex-col items-center gap-1">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-transparent !border-transparent" />
      <NodePickerPopover
        open={open}
        onOpenChange={setOpen}
        onPick={(spec) => d.onPick(d.parentId, d.branch, spec)}
        trigger={
          <button
            type="button"
            aria-label="Add step"
            className="group flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50 bg-background text-muted-foreground transition-all hover:scale-110 hover:border-primary hover:bg-primary/10 hover:text-primary"
          >
            <Plus className="h-3 w-3" strokeWidth={3} />
          </button>
        }
      />
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {d.branch === "yes" ? "Yes — Add step" : d.branch === "no" ? "No — Add step" : "Add step"}
      </span>
    </div>
  );
};

export default LeafAddNode;
