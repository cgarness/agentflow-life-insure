import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignRow } from "@/lib/campaigns-table/model";
import { LeadProgress, StatusPill, TypeBadge } from "./CampaignCells";
import CampaignRowActions from "./CampaignRowActions";
import CampaignRowDetails from "./CampaignRowDetails";
import type { CampaignRowRenderProps } from "./CampaignTableRow";

interface Props extends Omit<CampaignRowRenderProps, "row" | "metrics" | "expanded" | "onToggle" | "duplicate" | "columns"> {
  rows: CampaignRow[];
  metricsById: Record<string, CampaignRowRenderProps["metrics"]>;
  duplicateFor: (row: CampaignRow) => CampaignRowRenderProps["duplicate"];
  expandedId: string | null;
  onToggle: (id: string) => void;
}

/**
 * Stacked rows below xl: name, type, status, lead progress and actions always visible; the
 * chevron reveals the same detail grid the desktop table uses. No horizontal scrolling.
 */
export default function CampaignStackedList({ rows, metricsById, duplicateFor, expandedId, onToggle, ...rest }: Props) {
  return (
    <ul aria-label="Campaigns" className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      {rows.map((row) => {
        const expanded = expandedId === row.id;
        const detailsId = `campaign-details-stacked-${row.id}`;
        const metrics = metricsById[row.id];
        return (
          <li key={row.id} data-testid={`campaign-row-${row.id}`} className={cn("px-4 py-3", expanded && "bg-muted/20")}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link to={`/campaigns/${row.id}`} title={row.name}
                  className="min-w-0 max-w-full truncate rounded text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {row.name}
                </Link>
                <TypeBadge type={row.type} />
              </div>
              <StatusPill status={row.status} />
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <LeadProgress metrics={metrics} compact />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <CampaignRowActions row={row} duplicate={duplicateFor(row)} orgLocked={rest.orgLocked}
                  onOpen={rest.onOpen} onDuplicate={rest.onDuplicate} touch />
                <button type="button" onClick={() => onToggle(row.id)} aria-expanded={expanded}
                  aria-controls={expanded ? detailsId : undefined}
                  aria-label={`${expanded ? "Hide" : "Show"} details for ${row.name}`}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-180")} />
                </button>
              </div>
            </div>
            {expanded && (
              <div className="mt-3 border-t border-border/50 pt-3">
                <CampaignRowDetails id={detailsId} row={row} metrics={metrics} lastDialed={rest.lastDialed}
                  assignees={rest.assignees} nowMs={rest.nowMs} formatDate={rest.formatDate} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
