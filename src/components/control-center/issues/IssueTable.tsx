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
import { ISSUE_SOURCE_LABELS } from "@/lib/control-center/constants";
import type { ControlCenterFeature, ControlCenterIssue } from "@/lib/control-center/types";

interface Props {
  issues: ControlCenterIssue[];
  features: ControlCenterFeature[];
  onEdit: (issue: ControlCenterIssue) => void;
  onDelete: (issue: ControlCenterIssue) => void;
}

const IssueTable: React.FC<Props> = ({ issues, features, onEdit, onDelete }) => {
  const featureNameById = new Map(features.map((f) => [f.id, f.name] as const));
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">Issue</TableHead>
            <TableHead className="text-slate-400">Severity</TableHead>
            <TableHead className="text-slate-400">Status</TableHead>
            <TableHead className="text-slate-400">Source</TableHead>
            <TableHead className="text-slate-400">Feature</TableHead>
            <TableHead className="text-slate-400 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((i) => (
            <TableRow key={i.id} className="border-slate-800 hover:bg-slate-900/60 align-top">
              <TableCell className="max-w-md">
                <div className="font-medium text-slate-100">{i.title}</div>
                {i.description && (
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">{i.description}</div>
                )}
              </TableCell>
              <TableCell>
                <SeverityBadge severity={i.severity} />
              </TableCell>
              <TableCell>
                <StatusBadge status={i.status} />
              </TableCell>
              <TableCell className="text-slate-300">
                {ISSUE_SOURCE_LABELS[i.source]}
              </TableCell>
              <TableCell className="text-slate-400">
                {i.feature_id ? featureNameById.get(i.feature_id) ?? "—" : "—"}
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default IssueTable;
