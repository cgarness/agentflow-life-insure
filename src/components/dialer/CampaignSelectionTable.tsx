import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import CampaignSelectionRow from "./CampaignSelectionRow";
import CampaignSelectionRowDetails from "./CampaignSelectionRowDetails";
import {
  resolveLastDialedIso,
  type AssigneeProfileMap,
  type CampaignRecord,
  type CampaignStateCount,
} from "./campaignSelectionModel";
import type { CampaignPresenceMap } from "@/lib/supabase-dialer-presence";

export interface CampaignSelectionTableProps {
  /** Already sorted oldest-first by the orchestrator. */
  campaigns: CampaignRecord[];
  campaignStateStats: Record<string, CampaignStateCount[]>;
  campaignStatsLoading: boolean;
  campaignStatsError: boolean;
  campaignLastDialed: Record<string, string | null>;
  campaignEditPermissions?: Record<string, boolean>;
  presence?: CampaignPresenceMap;
  leadershipView: boolean;
  assigneeProfiles?: AssigneeProfileMap;
  nowMs: number;
  onSelectCampaign: (id: string) => void;
  onOpenSettings: (campaignId: string) => void;
  onPrefetchCampaign?: (id: string) => void;
}

/**
 * Semantic campaign table. Single-open accordion (ruling D4); expansion is purely
 * visual — session start stays exclusively on each row's Start Dialing button.
 */
export default function CampaignSelectionTable({
  campaigns,
  campaignStateStats,
  campaignStatsLoading,
  campaignStatsError,
  campaignLastDialed,
  campaignEditPermissions,
  presence,
  leadershipView,
  assigneeProfiles,
  nowMs,
  onSelectCampaign,
  onOpenSettings,
  onPrefetchCampaign,
}: CampaignSelectionTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const colCount = leadershipView ? 7 : 6;

  return (
    <TooltipProvider>
      <div className="w-full max-w-6xl rounded-lg border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Campaign</TableHead>
              <TableHead>Contacts</TableHead>
              <TableHead>Active Agents</TableHead>
              {leadershipView && <TableHead>Assigned</TableHead>}
              <TableHead>Last Dialed</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => {
              const states = campaignStateStats[campaign.id];
              const statsPending =
                !campaignStatsError && (campaignStatsLoading || states === undefined);
              const expanded = expandedId === campaign.id;
              const detailsId = `campaign-details-panel-${campaign.id}`;
              // Gear gating preserved: disabled only when we KNOW the user can't edit
              // (server is the source of truth; missing/undefined fails open).
              const canEditSettings = campaignEditPermissions?.[campaign.id] !== false;
              return (
                <React.Fragment key={campaign.id}>
                  <CampaignSelectionRow
                    campaign={campaign}
                    states={states}
                    statsPending={statsPending}
                    statsError={campaignStatsError}
                    lastDialedIso={resolveLastDialedIso(campaign.id, campaignLastDialed)}
                    presence={presence}
                    leadershipView={leadershipView}
                    assigneeProfiles={assigneeProfiles}
                    nowMs={nowMs}
                    expanded={expanded}
                    detailsId={detailsId}
                    onToggle={() => setExpandedId(expanded ? null : campaign.id)}
                    onSelectCampaign={onSelectCampaign}
                    onPrefetchCampaign={onPrefetchCampaign}
                  />
                  {expanded && (
                    <CampaignSelectionRowDetails
                      campaign={campaign}
                      detailsId={detailsId}
                      colSpan={colCount}
                      states={states}
                      presenceEntry={presence?.[campaign.id]}
                      presenceAvailable={presence !== undefined}
                      leadershipView={leadershipView}
                      assigneeProfiles={assigneeProfiles}
                      canEditSettings={canEditSettings}
                      onOpenSettings={onOpenSettings}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
