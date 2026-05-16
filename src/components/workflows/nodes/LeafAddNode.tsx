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
    <div className="relative flex flex-col items-center gap-1.5">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-transparent !border-transparent" />
      <NodePickerPopover
        open={open}
        onOpenChange={setOpen}
        onPick={(spec) => d.onPick(d.parentId, d.branch, spec)}
        trigger={
          <button
            type="button"
            aria-label="Add step"
            className="group flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 bg-card text-muted-foreground shadow-sm transition-all hover:scale-110 hover:border-primary hover:bg-primary/10 hover:text-primary hover:shadow-md"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        }
      />
    </div>
  );
};

export default LeafAddNode;
