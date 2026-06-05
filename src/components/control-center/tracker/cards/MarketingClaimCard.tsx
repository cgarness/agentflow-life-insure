import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  PriorityPill,
  RealityPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import { TRACKER_ACTION_NEEDED_LABELS } from "@/lib/control-center/trackerTypes";
import type { TrackerMarketingClaim } from "@/lib/control-center/trackerTypes";

interface Props {
  claim: TrackerMarketingClaim;
  onEdit: (claim: TrackerMarketingClaim) => void;
  onDelete: (claim: TrackerMarketingClaim) => void;
}

const MarketingClaimCard: React.FC<Props> = ({ claim, onEdit, onDelete }) => {
  const warn = claim.reality_status !== "accurate";
  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3",
        warn ? "border-amber-800/70 bg-amber-950/20" : "border-slate-800 bg-slate-900/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-slate-100">{claim.feature_claim}</div>
          {claim.marketed_location && (
            <div className="text-xs text-slate-500 truncate">{claim.marketed_location}</div>
          )}
        </div>
        <RealityPill reality={claim.reality_status} />
      </div>

      {claim.actual_status && (
        <p className="text-sm text-slate-400 line-clamp-2">
          <span className="text-slate-500">Reality:</span> {claim.actual_status}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <PriorityPill priority={claim.priority} />
        <span className="text-xs text-slate-300">
          {TRACKER_ACTION_NEEDED_LABELS[claim.action_needed]}
        </span>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 border-slate-700 text-slate-200"
          onClick={() => onEdit(claim)}
        >
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-400 hover:text-rose-300"
          onClick={() => onDelete(claim)}
          aria-label={`Delete claim`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default MarketingClaimCard;
