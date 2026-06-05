import React from "react";
import { Pencil, AlertOctagon, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MarketablePill,
  PriorityPill,
  StatusPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import type { TrackerItem } from "@/lib/control-center/trackerTypes";

interface Props {
  item: TrackerItem;
  systemName: string;
  onEdit: (item: TrackerItem) => void;
  onAddIssue: (item: TrackerItem) => void;
}

const ItemCard: React.FC<Props> = ({ item, systemName, onEdit, onAddIssue }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium text-slate-100 truncate">{item.title}</div>
        <div className="text-xs text-slate-500 truncate">{systemName}</div>
      </div>
      <StatusPill status={item.status} />
    </div>

    {item.description && (
      <p className="text-sm text-slate-400 line-clamp-2">{item.description}</p>
    )}

    <div className="flex flex-wrap items-center gap-2">
      <PriorityPill priority={item.priority} />
      <MarketablePill marketable={item.marketable_status} />
      {item.production_critical && (
        <span className="inline-flex items-center gap-1 text-xs text-rose-300">
          <ShieldAlert className="h-3.5 w-3.5" />
          Production critical
        </span>
      )}
    </div>

    {item.next_action && (
      <p className="text-xs text-slate-400">
        <span className="text-slate-500">Next:</span> {item.next_action}
      </p>
    )}

    <div className="flex gap-2 pt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-1 border-slate-700 text-slate-200"
        onClick={() => onEdit(item)}
      >
        <Pencil className="h-3.5 w-3.5 mr-1.5" />
        Edit
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="flex-1 border-slate-700 text-slate-200"
        onClick={() => onAddIssue(item)}
      >
        <AlertOctagon className="h-3.5 w-3.5 mr-1.5" />
        Add issue
      </Button>
    </div>
  </div>
);

export default ItemCard;
