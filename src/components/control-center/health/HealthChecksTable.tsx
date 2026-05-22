import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StatusBadge from "@/components/control-center/StatusBadge";
import SeverityBadge from "@/components/control-center/SeverityBadge";
import { HEALTH_CHECK_TYPE_LABELS } from "@/lib/control-center/constants";
import type { ControlCenterHealthCheck } from "@/lib/control-center/types";

interface Props {
  checks: ControlCenterHealthCheck[];
  onEdit: (check: ControlCenterHealthCheck) => void;
  onDelete: (check: ControlCenterHealthCheck) => void;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "Never";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

const HealthChecksTable: React.FC<Props> = ({ checks, onEdit, onDelete }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="border-slate-800 hover:bg-transparent">
          <TableHead className="text-slate-400">Check</TableHead>
          <TableHead className="text-slate-400">Category</TableHead>
          <TableHead className="text-slate-400">Type</TableHead>
          <TableHead className="text-slate-400">Status</TableHead>
          <TableHead className="text-slate-400">Severity</TableHead>
          <TableHead className="text-slate-400">Last run</TableHead>
          <TableHead className="text-slate-400 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {checks.map((c) => (
          <TableRow key={c.id} className="border-slate-800 hover:bg-slate-900/60">
            <TableCell>
              <div className="font-medium text-slate-100">{c.name}</div>
              <div className="text-xs text-slate-500 font-mono">{c.check_key}</div>
              {!c.is_enabled && (
                <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  Disabled
                </div>
              )}
            </TableCell>
            <TableCell className="text-slate-300">{c.category}</TableCell>
            <TableCell className="text-slate-300">
              {HEALTH_CHECK_TYPE_LABELS[c.check_type]}
            </TableCell>
            <TableCell>
              <StatusBadge status={c.status} />
            </TableCell>
            <TableCell>
              <SeverityBadge severity={c.severity} />
            </TableCell>
            <TableCell className="text-slate-400 text-xs">{formatTimestamp(c.last_run_at)}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-slate-100"
                  onClick={() => onEdit(c)}
                  aria-label={`Edit ${c.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-rose-300"
                  onClick={() => onDelete(c)}
                  aria-label={`Delete ${c.name}`}
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

export default HealthChecksTable;
