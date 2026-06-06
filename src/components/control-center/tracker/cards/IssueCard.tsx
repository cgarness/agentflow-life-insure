import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IssueStatusPill,
  SeverityPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import { TRACKER_ISSUE_QUIET_STATUSES } from "@/lib/control-center/trackerTypes";
import type { TrackerIssue } from "@/lib/control-center/trackerTypes";

interface Props {
  issue: TrackerIssue;
  systemName: string | null;
  onEdit: (issue: TrackerIssue) => void;
  onDelete: (issue: TrackerIssue) => void;
}

const IssueCard: React.FC<Props> = ({ issue, systemName, onEdit, onDelete }) => {
  const quiet = TRACKER_ISSUE_QUIET_STATUSES.includes(issue.status);
  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3",
        quiet
          ? "border-slate-800/60 bg-slate-900/20 opacity-70"
          : "border-slate-800 bg-slate-900/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-slate-100 truncate">{issue.title}</div>
          {systemName && <div className="text-xs text-slate-500 truncate">{systemName}</div>}
        </div>
        <SeverityPill severity={issue.severity} />
      </div>

      {issue.description && (
        <p className="text-sm text-slate-400 line-clamp-2">{issue.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <IssueStatusPill status={issue.status} />
        {issue.owner && <span className="text-xs text-slate-400">{issue.owner}</span>}
      </div>

      {issue.next_action && (
        <p className="text-xs text-slate-400">
          <span className="text-slate-500">Next:</span> {issue.next_action}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 border-slate-700 text-slate-200"
          onClick={() => onEdit(issue)}
        >
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-400 hover:text-rose-300"
          onClick={() => onDelete(issue)}
          aria-label={`Delete ${issue.title}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default IssueCard;
