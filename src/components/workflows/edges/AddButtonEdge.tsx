import React, { useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import NodePickerPopover from "../NodePickerPopover";
import type { NodeSpec } from "../lib/insertNode";

export interface AddButtonEdgeData {
  edgeRowId: string;
  onPick: (edgeRowId: string, spec: NodeSpec) => void;
  branchLabel?: "Yes" | "No";
  [key: string]: unknown;
}

const AddButtonEdge: React.FC<EdgeProps> = (props) => {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data, style,
  } = props;
  const d = data as unknown as AddButtonEdgeData | undefined;
  const [open, setOpen] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 z-50"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <div className="flex flex-col items-center gap-1">
            {d?.branchLabel && (
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                  d.branchLabel === "Yes"
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-rose-500/15 text-rose-500"
                }`}
              >
                {d.branchLabel}
              </span>
            )}
            {d && (
              <NodePickerPopover
                open={open}
                onOpenChange={setOpen}
                onPick={(spec) => d.onPick(d.edgeRowId, spec)}
                trigger={
                  <button
                    type="button"
                    aria-label="Insert step"
                    className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50 bg-background text-muted-foreground transition-all hover:scale-110 hover:border-primary hover:bg-primary/10 hover:text-primary"
                  >
                    <Plus className="h-3 w-3" strokeWidth={3} />
                  </button>
                }
              />
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default AddButtonEdge;
