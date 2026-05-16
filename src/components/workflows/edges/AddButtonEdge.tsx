import React, { useState } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getStraightPath, getSmoothStepPath,
  type EdgeProps,
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

  const isVertical = Math.abs(sourceX - targetX) < 3;
  const [edgePath, labelX, labelY] = isVertical
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getSmoothStepPath({
        sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
        borderRadius: 20,
      });

  const edgeStyle = {
    ...style,
    strokeWidth: 2,
    stroke: d?.branchLabel
      ? d.branchLabel === "Yes" ? "hsl(var(--chart-2))" : "hsl(var(--chart-5))"
      : "hsl(var(--border))",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} />
      <EdgeLabelRenderer>
        <div
          className="absolute z-[100]"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <div className="group/edge flex flex-col items-center gap-1">
            {d?.branchLabel && (
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  d.branchLabel === "Yes"
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-rose-500/15 text-rose-500"
                }`}
              >
                {d.branchLabel}
              </span>
            )}
            {d && (
              <div className={`transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 group-hover/edge:opacity-100"}`}>
                <NodePickerPopover
                  open={open}
                  onOpenChange={setOpen}
                  onPick={(spec) => d.onPick(d.edgeRowId, spec)}
                  trigger={
                    <button
                      type="button"
                      aria-label="Insert step"
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-all hover:scale-110 hover:border-primary hover:bg-primary/10 hover:text-primary"
                    >
                      <Plus className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default AddButtonEdge;
