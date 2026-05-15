import React from "react";
import { format } from "date-fns";
import { MoreVertical, FolderInput, Trash2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STATUS_BADGE, TRIGGER_LABELS, triggerIcon,
  type WorkflowRow as WorkflowRowType, type WorkflowStatus, type WorkflowFolderRow,
} from "@/lib/workflow-types";

interface Props {
  workflow: WorkflowRowType;
  folders: WorkflowFolderRow[];
  executionCount: number;
  onOpen: (id: string) => void;
  onCycleStatus: (id: string, next: WorkflowStatus) => void;
  onMoveToFolder: (id: string, folderId: string | null) => void;
  onDelete: (workflow: WorkflowRowType) => void;
}

function nextStatus(current: WorkflowStatus): WorkflowStatus {
  switch (current) {
    case "draft": return "active";
    case "active": return "paused";
    case "paused": return "active";
    case "archived": return "draft";
  }
}

const WorkflowRow: React.FC<Props> = ({
  workflow, folders, executionCount, onOpen, onCycleStatus, onMoveToFolder, onDelete,
}) => {
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel>Workflow</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="mr-2 h-3.5 w-3.5" /> Move to folder
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => onMoveToFolder(workflow.id, null)}>
                Unfiled
              </DropdownMenuItem>
              {folders.length > 0 && <DropdownMenuSeparator />}
              {folders.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => onMoveToFolder(workflow.id, f.id)}>
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: f.color ?? "#6366f1" }} />
                  {f.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDelete(workflow)}
            className="text-rose-500 focus:text-rose-500"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete workflow
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default WorkflowRow;
