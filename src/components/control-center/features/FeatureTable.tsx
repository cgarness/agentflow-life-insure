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
import { FEATURE_PRIORITY_LABELS } from "@/lib/control-center/constants";
import type { ControlCenterFeature } from "@/lib/control-center/types";

interface Props {
  features: ControlCenterFeature[];
  onEdit: (feature: ControlCenterFeature) => void;
  onDelete: (feature: ControlCenterFeature) => void;
}

const FeatureTable: React.FC<Props> = ({ features, onEdit, onDelete }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="border-slate-800 hover:bg-transparent">
          <TableHead className="text-slate-400">Feature</TableHead>
          <TableHead className="text-slate-400">Category</TableHead>
          <TableHead className="text-slate-400">Status</TableHead>
          <TableHead className="text-slate-400">Priority</TableHead>
          <TableHead className="text-slate-400">Owner</TableHead>
          <TableHead className="text-slate-400 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {features.map((f) => (
          <TableRow key={f.id} className="border-slate-800 hover:bg-slate-900/60">
            <TableCell>
              <div className="flex flex-col">
                <span className="font-medium text-slate-100">{f.name}</span>
                <span className="text-xs text-slate-500 font-mono">{f.feature_key}</span>
              </div>
            </TableCell>
            <TableCell className="text-slate-300">{f.category}</TableCell>
            <TableCell>
              <StatusBadge status={f.status} />
            </TableCell>
            <TableCell className="text-slate-300">
              {FEATURE_PRIORITY_LABELS[f.priority]}
            </TableCell>
            <TableCell className="text-slate-400">{f.owner ?? "—"}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-slate-100"
                  onClick={() => onEdit(f)}
                  aria-label={`Edit ${f.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-rose-300"
                  onClick={() => onDelete(f)}
                  aria-label={`Delete ${f.name}`}
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

export default FeatureTable;
