import React from "react";
import { ChevronDown } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import CampaignAvatarStack from "./CampaignAvatarStack";
import {
  assignedCellModel,
  campaignTypeBadgeClass,
  campaignTypeLabel,
  formatExactTimestamp,
  formatLastDialedRelative,
  presenceCellState,
  totalContacts,
  type AssigneeProfileMap,
  type CampaignRecord,
  type CampaignStateCount,
} from "./campaignSelectionModel";
import type { CampaignPresenceMap } from "@/lib/supabase-dialer-presence";

export interface CampaignSelectionRowProps {
  campaign: CampaignRecord;
  states: CampaignStateCount[] | undefined;
  statsPending: boolean;
  statsError: boolean;
  lastDialedIso: string | null;
  presence?: CampaignPresenceMap;
  leadershipView: boolean;
  assigneeProfiles?: AssigneeProfileMap;
  nowMs: number;
  expanded: boolean;
  detailsId: string;
  onToggle: () => void;
  onSelectCampaign: (id: string) => void;
  onPrefetchCampaign?: (id: string) => void;
}

/**
 * One collapsed campaign row. Clicking the row or the chevron only expands details —
 * ONLY the Start Dialing button may initiate campaign selection (and it never toggles).
 */
export default function CampaignSelectionRow({
  campaign,
  states,
  statsPending,
  statsError,
  lastDialedIso,
  presence,
  leadershipView,
  assigneeProfiles,
  nowMs,
  expanded,
  detailsId,
  onToggle,
  onSelectCampaign,
  onPrefetchCampaign,
}: CampaignSelectionRowProps) {
  const statsLoaded = states !== undefined;
  const contacts = totalContacts(states);
  const cellState = presenceCellState(presence, campaign.id);
  const assigned = leadershipView ? assignedCellModel(campaign, assigneeProfiles) : null;
  const relative = formatLastDialedRelative(lastDialedIso, nowMs);
  const exact = lastDialedIso ? formatExactTimestamp(lastDialedIso) : null;
  const description = (campaign.description ?? "").trim();

  return (
    <TableRow
      data-testid={`campaign-row-${campaign.id}`}
      onClick={onToggle}
      onMouseEnter={() => onPrefetchCampaign?.(campaign.id)}
      onFocus={() => onPrefetchCampaign?.(campaign.id)}
      className="cursor-pointer"
    >
      <TableCell className="py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground" title={campaign.name}>
              {campaign.name}
            </span>
            <span
              className={cn(
                "inline-block shrink-0 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider",
                campaignTypeBadgeClass(campaign.type),
              )}
            >
              {campaignTypeLabel(campaign.type)}
            </span>
          </div>
          {description && (
            <span className="max-w-xs truncate text-xs text-muted-foreground" title={description}>
              {description}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell data-testid="contacts-cell" className="py-3">
        {statsPending ? (
          <span className="text-xs italic text-muted-foreground">Loading counts…</span>
        ) : statsError && !statsLoaded ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="font-semibold tabular-nums text-foreground">
            {contacts.toLocaleString()}
          </span>
        )}
      </TableCell>

      <TableCell data-testid="active-agents-cell" className="py-3">
        {cellState.kind === "unavailable" && <span className="text-muted-foreground">—</span>}
        {cellState.kind === "zero" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />
            No active agents
          </span>
        )}
        {cellState.kind === "active" && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            {cellState.count} active
          </span>
        )}
      </TableCell>

      {leadershipView && (
        <TableCell data-testid="assigned-cell" className="py-3">
          {assigned?.kind === "open" && (
            <span className="text-sm text-muted-foreground">Open to agency</span>
          )}
          {assigned?.kind === "personal" && (
            <span className="text-sm text-foreground">
              {assigned.owner?.displayName ?? "Unknown"}
            </span>
          )}
          {assigned?.kind === "team" && <CampaignAvatarStack people={assigned.people} />}
          {assigned?.kind === "unknown" && <span className="text-muted-foreground">—</span>}
        </TableCell>
      )}

      <TableCell className="py-3">
        {exact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm text-foreground">{relative}</span>
            </TooltipTrigger>
            <TooltipContent>{exact}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-sm text-muted-foreground">{relative}</span>
        )}
        {exact && (
          <span data-testid="last-dialed-exact" className="sr-only">
            Last dialed {exact}
          </span>
        )}
      </TableCell>

      <TableCell className="py-3">
        <button
          type="button"
          onPointerDown={() => onPrefetchCampaign?.(campaign.id)}
          onClick={(e) => {
            e.stopPropagation();
            onSelectCampaign(campaign.id);
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start Dialing
        </button>
      </TableCell>

      <TableCell className="w-10 py-3 pr-4 text-right">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={expanded ? `Hide details for ${campaign.name}` : `Show details for ${campaign.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </TableCell>
    </TableRow>
  );
}
