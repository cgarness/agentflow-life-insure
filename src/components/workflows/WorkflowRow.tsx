import React from "react";
import { format } from "date-fns";
import {
  STATUS_BADGE, TRIGGER_LABELS, triggerIcon,
  type WorkflowRow as WorkflowRowType, type WorkflowStatus,
} from "@/lib/workflow-types";

interface Props {
  workflow: WorkflowRowType;
  executionCount: number;
  onOpen: (id: string) => void;
  onCycleStatus: (id: string, next: WorkflowStatus) => void;
}

function nextStatus(current: WorkflowStatus): WorkflowStatus {
  switch (current) {
    case "draft": return "active";
    case "active": return "paused";
    case "paused": return "active";
    case "archived": return "draft";
  }
}

const WorkflowRow: React.FC<Props> = ({ workflow, executionCount, onOpen, onCycleStatus }) => {
  const TriggerIcon = triggerIcon();
  const badge = STATUS_BADGE[workflow.status];
  const isArchived = workflow.status === "archived";

  return (
    <div
      onClick={() => onOpen(workflow.id)}
      className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-border/50 bg-card/50 px-4 py-3 backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <TriggerIcon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-foreground">{workflow.name}</h4>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {TRIGGER_LABELS[workflow.trigger_type]}
          {workflow.description ? ` · ${workflow.description}` : ""}
        </p>
      </div>

      <div className="hidden text-right text-xs text-muted-foreground sm:block">
        <div>{executionCount} run{executionCount === 1 ? "" : "s"}</div>
        <div>{format(new Date(workflow.created_at), "MMM d, yyyy")}</div>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCycleStatus(workflow.id, nextStatus(workflow.status)); }}
        className="rounded-lg border border-border/50 bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {isArchived ? "Restore" : workflow.status === "active" ? "Pause" : workflow.status === "paused" ? "Resume" : "Activate"}
      </button>
    </div>
  );
};

export default WorkflowRow;
