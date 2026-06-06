import React from "react";
import { Pencil, AlertOctagon, Trash2, ShieldAlert } from "lucide-react";
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
import type { TrackerItem } from "@/lib/control-center/trackerTypes";

interface Props {
  items: TrackerItem[];
  systemNameById: Map<string, string>;
  onEdit: (item: TrackerItem) => void;
  onAddIssue: (item: TrackerItem) => void;
  onDelete: (item: TrackerItem) => void;
}

const TrackerItemsTable: React.FC<Props> = ({
  items,
  systemNameById,
  onEdit,
  onAddIssue,
  onDelete,
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="border-slate-800 hover:bg-transparent">
          <TableHead className="text-slate-400">Item</TableHead>
          <TableHead className="text-slate-400">System</TableHead>
          <TableHead className="text-slate-400">Status</TableHead>
          <TableHead className="text-slate-400">Priority</TableHead>
          <TableHead className="text-slate-400">Marketable</TableHead>
          <TableHead className="text-slate-400 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((i) => (
          <TableRow key={i.id} className="border-slate-800 hover:bg-slate-900/60 align-top">
            <TableCell className="max-w-md">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-slate-100">{i.title}</span>
                {i.production_critical && (
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-400 shrink-0" aria-label="Production critical" />
                )}
              </div>
              {i.description && (
                <div className="text-xs text-slate-500 mt-1 line-clamp-2">{i.description}</div>
              )}
            </TableCell>
            <TableCell className="text-slate-300">
              {systemNameById.get(i.system_id) ?? "—"}
            </TableCell>
            <TableCell>
              <StatusPill status={i.status} />
            </TableCell>
            <TableCell>
              <PriorityPill priority={i.priority} />
            </TableCell>
            <TableCell>
              <MarketablePill marketable={i.marketable_status} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-slate-100"
                  onClick={() => onAddIssue(i)}
                  aria-label={`Add issue to ${i.title}`}
                >
                  <AlertOctagon className="h-4 w-4" />
                </Button>
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
        ))}
      </TableBody>
    </Table>
  </div>
);

export default TrackerItemsTable;
