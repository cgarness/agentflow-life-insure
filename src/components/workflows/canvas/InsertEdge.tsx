import type { ReactNode } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getStraightPath, type Edge, type EdgeProps } from "@xyflow/react";
import BranchTag from "./BranchTag";

export type InsertEdgeData = {
  /** Set on the two exits of a condition. */
  branch?: "yes" | "no";
  /** Button that inserts a step on this connection. Absent when the draft is read-only. */
  add?: ReactNode;
};
export type InsertEdgeType = Edge<InsertEdgeData, "insert">;

/** A connection between two steps, carrying its branch name and the insert button. */
export default function InsertEdge({id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data}: EdgeProps<InsertEdgeType>) {
  const [path, labelX, labelY] = Math.abs(sourceX - targetX) < 3
    ? getStraightPath({sourceX, sourceY, targetX, targetY})
    : getSmoothStepPath({sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 12});
  return <>
    <BaseEdge id={id} path={path} interactionWidth={0}/>
    {(data?.branch || data?.add) && <EdgeLabelRenderer>
      {/* The canvas library positions edge labels with an inline transform. */}
      <div className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-1"
        style={{transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}}>
        {data.branch && <BranchTag branch={data.branch}/>}
        {data.add}
      </div>
    </EdgeLabelRenderer>}
  </>;
}
