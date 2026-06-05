import React from "react";
import { Pencil, AlertOctagon, Trash2 } from "lucide-react";
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
  MarketablePill,
  PriorityPill,
  StatusPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import type { TrackerSystem } from "@/lib/control-center/trackerTypes";

interface Props {
  systems: TrackerSystem[];
  completionBySystem: Map<string, number>;
  openIssuesBySystem: Map<string, number>;
  onEdit: (system: TrackerSystem) => void;
  onAddIssue: (system: TrackerSystem) => void;
  onDelete: (system: TrackerSystem) => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

const TrackerSystemsTable: React.FC<Props> = ({
  systems,
  completionBySystem,
  openIssuesBySystem,
  onEdit,
  onAddIssue,
  onDelete,
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="border-slate-800 hover:bg-transparent">
          <TableHead className="text-slate-400">System</TableHead>
          <TableHead className="text-slate-400">Status</TableHead>
          <TableHead className="text-slate-400">Priority</TableHead>
          <TableHead className="text-slate-400">Marketable</TableHead>
          <TableHead className="text-slate-400">Completion</TableHead>
          <TableHead className="text-slate-400">Open issues</TableHead>
          <TableHead className="text-slate-400">Last reviewed</TableHead>
          <TableHead className="text-slate-400 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {systems.map((s) => {
          const completion = completionBySystem.get(s.id) ?? 0;
          const open = openIssuesBySystem.get(s.id) ?? 0;
          return (
            <TableRow key={s.id} className="border-slate-800 hover:bg-slate-900/60 align-top">
              <TableCell>
                <div className="font-medium text-slate-100">{s.name}</div>
                <div className="text-xs text-slate-500">{s.category}</div>
              </TableCell>
              <TableCell>
                <StatusPill status={s.status} />
              </TableCell>
              <TableCell>
                <PriorityPill priority={s.priority} />
              </TableCell>
              <TableCell>
                <MarketablePill marketable={s.marketable_status} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/80"
                      style={{ width: `${completion}%` }}
                      aria-hidden
                    />
                  </div>
                  <span className="text-xs text-slate-300">{completion}%</span>
                </div>
              </TableCell>
              <TableCell>
                <span className={open > 0 ? "text-rose-300" : "text-slate-500"}>{open}</span>
              </TableCell>
              <TableCell className="text-slate-400 text-sm">{fmtDate(s.last_reviewed_at)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-slate-100"
                    onClick={() => onAddIssue(s)}
                    aria-label={`Add issue to ${s.name}`}
                  >
                    <AlertOctagon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-slate-100"
                    onClick={() => onEdit(s)}
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-rose-300"
                    onClick={() => onDelete(s)}
                    aria-label={`Delete ${s.name}`}
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

export default TrackerSystemsTable;
