import { useId } from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { viewerTimeZoneLabel } from "@/lib/contactFollowUps";
import { isTimedTask, type TaskDueStatus } from "@/lib/taskDates";
import { cn } from "@/lib/utils";

export interface TaskListItem {
  id: string;
  title: string;
  task_type: string;
  due_date: string;
  /** False only for a task with a time of day, which automations create. */
  all_day?: boolean | null;
  automation_run_id?: string | null;
  completed_at: string | null;
  notes: string | null;
  assigned_to?: string | null;
  /** Empty for a task an automation created. */
  created_by?: string | null;
  assignee?: { first_name: string | null; last_name: string | null } | null;
}
interface Props {
  task: TaskListItem;
  status: TaskDueStatus;
  /** A completion is being saved. */
  busy: boolean;
  /** Only the task's assignee or the person who created it may complete it; the database refuses anyone else. */
  canComplete: boolean;
  formatDateTime: (value: string) => string;
  onComplete: (id: string) => void;
}

/** One task on a contact. A timed task shows its actual due date and time; an all-day task keeps its relative text. */
export default function TaskRow({task, status, busy, canComplete, formatDateTime, onComplete}: Props) {
  const reasonId = useId();
  const completed = status === "completed";
  const overdue = status === "overdue";
  const due = completed ? "Completed"
    : isTimedTask(task) ? `${formatDateTime(task.due_date)} ${viewerTimeZoneLabel(new Date(task.due_date))}`.trim()
    : formatDistanceToNow(new Date(task.due_date), {addSuffix: true});
  return <div className={cn("relative mb-2 flex items-start gap-3 overflow-hidden rounded-lg border bg-card p-3 transition-colors", completed && "opacity-60")}>
    {overdue && <div aria-hidden className="absolute bottom-0 left-0 top-0 w-1 bg-badge-warning-text"/>}
    <div className="pt-1">
      <Checkbox aria-label={"Mark “" + task.title + "” complete"} checked={completed} disabled={completed || busy || !canComplete}
        aria-describedby={!completed && !canComplete ? reasonId : undefined} onCheckedChange={() => onComplete(task.id)}/>
    </div>
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", completed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
            {task.task_type}
          </span>
          {task.automation_run_id && <Badge variant="neutral">Automation</Badge>}
        </span>
        <span className={cn("flex items-center text-xs", overdue ? "font-medium text-badge-warning-text" : "text-muted-foreground")}>
          <Clock aria-hidden className="mr-1 h-3 w-3"/>
          {overdue && isTimedTask(task) ? "Overdue · " + due : due}
        </span>
      </div>
      <p className={cn("truncate text-sm font-medium", completed ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</p>
      <div className="mt-2 flex items-center justify-between">
        <p className="truncate text-xs text-muted-foreground">{task.notes || "No notes"}</p>
        <p className="ml-2 shrink-0 text-xs text-muted-foreground">{task.assignee?.first_name} {task.assignee?.last_name}</p>
      </div>
      {!completed && !canComplete && <p id={reasonId} className="mt-1 text-xs text-muted-foreground">
        Only the assigned agent can complete this task.
      </p>}
    </div>
  </div>;
}
