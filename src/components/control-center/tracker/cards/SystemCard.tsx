import React from "react";
import { Pencil, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MarketablePill,
  PriorityPill,
  StatusPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import type { TrackerSystem } from "@/lib/control-center/trackerTypes";

interface Props {
  system: TrackerSystem;
  completion: number;
  openIssues: number;
  onEdit: (system: TrackerSystem) => void;
  onAddIssue: (system: TrackerSystem) => void;
}

const SystemCard: React.FC<Props> = ({ system, completion, openIssues, onEdit, onAddIssue }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium text-slate-100 truncate">{system.name}</div>
        <div className="text-xs text-slate-500">{system.category}</div>
      </div>
      <StatusPill status={system.status} />
    </div>

    {system.plain_english_summary && (
      <p className="text-sm text-slate-400 line-clamp-2">{system.plain_english_summary}</p>
    )}

    <div className="flex flex-wrap items-center gap-2">
      <PriorityPill priority={system.priority} />
      <MarketablePill marketable={system.marketable_status} />
      <span className="text-xs text-slate-400">{completion}% complete</span>
      {openIssues > 0 && (
        <span className="text-xs text-rose-300">
          {openIssues} open issue{openIssues === 1 ? "" : "s"}
        </span>
      )}
    </div>

    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
      <div
        className="h-full bg-emerald-500/80"
        style={{ width: `${completion}%` }}
        aria-hidden
      />
    </div>

    <div className="flex gap-2 pt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-1 border-slate-700 text-slate-200"
        onClick={() => onEdit(system)}
      >
        <Pencil className="h-3.5 w-3.5 mr-1.5" />
        Edit
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-1 border-slate-700 text-slate-200"
        onClick={() => onAddIssue(system)}
      >
        <AlertOctagon className="h-3.5 w-3.5 mr-1.5" />
        Add issue
      </Button>
    </div>
  </div>
);

export default SystemCard;
