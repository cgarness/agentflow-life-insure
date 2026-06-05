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
  PriorityPill,
  RealityPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import { TRACKER_ACTION_NEEDED_LABELS } from "@/lib/control-center/trackerTypes";
import type { TrackerMarketingClaim } from "@/lib/control-center/trackerTypes";

interface Props {
  claims: TrackerMarketingClaim[];
  onEdit: (claim: TrackerMarketingClaim) => void;
  onDelete: (claim: TrackerMarketingClaim) => void;
}

const TrackerMarketingTable: React.FC<Props> = ({ claims, onEdit, onDelete }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="border-slate-800 hover:bg-transparent">
          <TableHead className="text-slate-400">Claim</TableHead>
          <TableHead className="text-slate-400">Location</TableHead>
          <TableHead className="text-slate-400">Reality</TableHead>
          <TableHead className="text-slate-400">Action</TableHead>
          <TableHead className="text-slate-400">Priority</TableHead>
          <TableHead className="text-slate-400 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {claims.map((c) => {
          const warn = c.reality_status !== "accurate";
          return (
            <TableRow
              key={c.id}
              className={cn(
                "border-slate-800 hover:bg-slate-900/60 align-top",
                warn && "bg-amber-950/20",
              )}
            >
              <TableCell className="max-w-sm">
                <div className="font-medium text-slate-100">{c.feature_claim}</div>
                {c.actual_status && (
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">
                    Reality: {c.actual_status}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-slate-300 text-sm max-w-[12rem]">
                <span className="line-clamp-2">{c.marketed_location ?? "—"}</span>
              </TableCell>
              <TableCell>
                <RealityPill reality={c.reality_status} />
              </TableCell>
              <TableCell className="text-slate-300 text-sm">
                {TRACKER_ACTION_NEEDED_LABELS[c.action_needed]}
              </TableCell>
              <TableCell>
                <PriorityPill priority={c.priority} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-slate-100"
                    onClick={() => onEdit(c)}
                    aria-label="Edit claim"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:text-rose-300"
                    onClick={() => onDelete(c)}
                    aria-label="Delete claim"
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

export default TrackerMarketingTable;
