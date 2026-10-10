import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";
import type { ColumnId } from "@/lib/campaigns-table/columns";
import type { CampaignMetrics, CampaignRow, DuplicateEligibility } from "@/lib/campaigns-table/model";
import type { LoadStatus } from "@/hooks/useCampaignsTableData";
import {
  AgentsCell, LastDialedValue, LeadProgress, MetricValue, StatusPill, TagChips, TypeBadge, type LastDialedView,
} from "./CampaignCells";
import CampaignRowActions from "./CampaignRowActions";
import CampaignRowDetails from "./CampaignRowDetails";

export interface CampaignRowRenderProps {
  row: CampaignRow;
  metrics: CampaignMetrics;
  columns: ColumnId[];
  expanded: boolean;
  onToggle: () => void;
  duplicate: DuplicateEligibility;
  orgLocked: boolean;
  lastDialed: LastDialedView;
  assignees: { status: LoadStatus; map: AssigneeProfileMap } | null;
  nowMs: number;
  formatDate: (date: string | null | undefined) => string;
  onOpen: (id: string) => void;
  /** `returnFocusTo` is the control focus returns to when the dialog closes. */
  onDuplicate: (row: CampaignRow, returnFocusTo: HTMLElement | null) => void;
}

/** Opaque cell background with the row hover drawn as a layered tint (keeps the sticky column clean). */
const CELL = "border-b border-border/50 bg-card px-3 py-2.5 align-middle transition-colors group-hover:bg-[linear-gradient(hsl(var(--muted)_/_0.35),hsl(var(--muted)_/_0.35))]";

function columnCell(id: ColumnId, p: CampaignRowRenderProps): React.ReactNode {
  switch (id) {
    case "status": return <StatusPill status={p.row.status} />;
    case "progress": return <LeadProgress metrics={p.metrics} />;
    case "agents": return <AgentsCell row={p.row} assignees={p.assignees} />;
    case "converted": return <MetricValue metric={p.metrics.converted} className="font-medium" />;
    case "contacted": return <MetricValue metric={p.metrics.contacted} />;
    case "created": return <span className="whitespace-nowrap text-sm text-muted-foreground">{p.row.created_at ? p.formatDate(p.row.created_at) : "—"}</span>;
    case "tags": return <TagChips tags={p.row.tags} />;
    case "last_dialed": return <LastDialedValue id={p.row.id} lastDialed={p.lastDialed} nowMs={p.nowMs} />;
  }
}

export default function CampaignTableRow(p: CampaignRowRenderProps) {
  const { row, expanded, onToggle, columns } = p;
  const detailsId = `campaign-details-panel-${row.id}`;
  return (
    <>
      <TableRow data-testid={`campaign-row-${row.id}`} className="group border-0 hover:bg-transparent">
        <TableCell className={cn(CELL, "w-10 pl-3 pr-0")}>
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${row.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight aria-hidden="true" className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-90")} />
          </button>
        </TableCell>
        <TableCell className={cn(CELL, "w-full min-w-[13rem] max-w-0")}>
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/campaigns/${row.id}`} title={row.name}
              className="min-w-0 max-w-[22rem] truncate rounded text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {row.name}
            </Link>
            <TypeBadge type={row.type} />
          </div>
        </TableCell>
        {columns.map((id) => (
          <TableCell key={id} className={cn(CELL, (id === "converted" || id === "contacted") && "text-right")}>
            {columnCell(id, p)}
          </TableCell>
        ))}
        <TableCell className={cn(CELL, "sticky right-0 z-10 w-32 shadow-[-1px_0_0_hsl(var(--border)_/_0.6)]")}>
          <CampaignRowActions row={row} duplicate={p.duplicate} orgLocked={p.orgLocked} onOpen={p.onOpen} onDuplicate={p.onDuplicate} />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="border-0 hover:bg-transparent">
          <TableCell colSpan={columns.length + 3} className="border-b border-border/50 bg-muted/20 p-0">
            <div className="sticky left-0 w-[100cqw] px-6 py-4">
              <CampaignRowDetails id={detailsId} row={row} metrics={p.metrics} lastDialed={p.lastDialed}
                assignees={p.assignees} nowMs={p.nowMs} formatDate={p.formatDate} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
