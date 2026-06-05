import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IssueStatusPill,
  SeverityPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import { TRACKER_ISSUE_QUIET_STATUSES } from "@/lib/control-center/trackerTypes";
import type { TrackerIssue } from "@/lib/control-center/trackerTypes";

interface Props {
  issues: TrackerIssue[];
  systemNameById: Map<string, string>;
  onEdit: (issue: TrackerIssue) => void;
  onDelete: (issue: TrackerIssue) => void;
}

const TrackerIssuesTable: React.FC<Props> = ({ issues, systemNameById, onEdit, onDelete }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="border-slate-800 hover:bg-transparent">
          <TableHead className="text-slate-400">Issue</TableHead>
          <TableHead className="text-slate-400">Severity</TableHead>
          <TableHead className="text-slate-400">Status</TableHead>
          <TableHead className="text-slate-400">System</TableHead>
          <TableHead className="text-slate-400">Next action</TableHead>
          <TableHead className="text-slate-400 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((i) => {
          const quiet = TRACKER_ISSUE_QUIET_STATUSES.includes(i.status);
          return (
            <TableRow
              key={i.id}
              className={cn(
                "border-slate-800 hover:bg-slate-900/60 align-top",
                quiet && "opacity-60",
              )}
            >
              <TableCell className="max-w-sm">
                <div className="font-medium text-slate-100">{i.title}</div>
                {i.description && (
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">{i.description}</div>
                )}
              </TableCell>
              <TableCell>
                <SeverityPill severity={i.severity} />
              </TableCell>
              <TableCell>
                <IssueStatusPill status={i.status} />
              </TableCell>
              <TableCell className="text-slate-300">
                {i.system_id ? systemNameById.get(i.system_id) ?? "—" : "—"}
              </TableCell>
              <TableCell className="text-slate-400 text-sm max-w-xs">
                <span className="line-clamp-2">{i.next_action ?? "—"}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-slate-100"
                    onClick={() => onEdit(i)}
                    aria-label={`Edit ${i.title}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-rose-300"
                    onClick={() => onDelete(i)}
                    aria-label={`Delete ${i.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </div>
);

export default TrackerIssuesTable;
