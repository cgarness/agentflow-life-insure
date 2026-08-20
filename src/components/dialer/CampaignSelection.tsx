import React, { useMemo } from "react";
import { Phone, RefreshCw } from "lucide-react";
import CampaignSelectionTable from "./CampaignSelectionTable";
import { CampaignTableSkeleton } from "./DialerSkeletons";
import {
  headerPresence,
  sortCampaignsOldestFirst,
  type AssigneeProfileMap,
  type CampaignRecord,
  type CampaignStateCount,
} from "./campaignSelectionModel";
import type { CampaignPresenceMap } from "@/lib/supabase-dialer-presence";

/**
 * Dialer campaign-selection screen — the approved balanced expandable table
 * (implementation_plan.md, approved 2026-08-20). This component only orchestrates
 * states; rows/details live in CampaignSelectionTable / -Row / -RowDetails.
 *
 * Role behavior: `leadershipView` adds the Assigned column and expanded identity
 * details for Team Leader / Admin / Super Admin. It is presentation gating only —
 * the presence RPC independently withholds identity data from Agent callers, and
 * the campaign list itself stays filterCampaignsForDialing-scoped upstream.
 */
export interface CampaignSelectionProps {
  campaigns: CampaignRecord[];
  campaignsLoading: boolean;
  campaignStateStats: Record<string, CampaignStateCount[]>;
  /** campaign_id -> last MAX(calls.created_at) ISO (org-scoped get_campaign_last_dialed RPC). */
  campaignLastDialed: Record<string, string | null>;
  /** campaign_id -> may the current user edit its settings (UX gating only). */
  campaignEditPermissions?: Record<string, boolean>;
  campaignStatsLoading?: boolean;
  campaignStatsError?: boolean;
  /**
   * Per-campaign active-agent presence (get_dialer_campaign_presence). undefined =
   * unavailable (loading or failed) → rows render "—", never a fabricated zero.
   */
  presence?: CampaignPresenceMap;
  /** Team Leader / Admin / Super Admin view (Assigned column + expanded identities). */
  leadershipView?: boolean;
  /** Minimal same-org profile identities for the Assigned column (leadership only). */
  assigneeProfiles?: AssigneeProfileMap;
  /** Injectable clock for deterministic relative-time rendering in tests. */
  nowMs?: number;
  onRetryStats?: () => void;
  onRefreshCampaigns?: () => void;
  onSelectCampaign: (id: string) => void;
  onOpenSettings: (campaignId: string) => void;
  /** Warm the header-stat cache for a campaign on hover/focus so entering it paints instantly. */
  onPrefetchCampaign?: (id: string) => void;
}

export default function CampaignSelection({
  campaigns,
  campaignsLoading,
  campaignStateStats,
  campaignLastDialed,
  campaignEditPermissions,
  campaignStatsLoading = false,
  campaignStatsError = false,
  presence,
  leadershipView = false,
  assigneeProfiles,
  nowMs,
  onRetryStats,
  onRefreshCampaigns,
  onSelectCampaign,
  onOpenSettings,
  onPrefetchCampaign,
}: CampaignSelectionProps) {
  const sortedCampaigns = useMemo(() => sortCampaignsOldestFirst(campaigns), [campaigns]);
  const visibleIds = useMemo(() => sortedCampaigns.map((c) => c.id as string), [sortedCampaigns]);
  const header = headerPresence(presence, visibleIds);
  const resolvedNowMs = nowMs ?? Date.now();

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <div className="flex flex-1 flex-col items-start justify-start px-4 pb-8 pt-10">
        <div className="mb-8 max-w-lg">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
            <Phone className="h-3 w-3" />
            DIALER
          </div>
          <h1 className="mb-1 text-3xl font-extrabold text-foreground">Select a Campaign</h1>
          <p className="text-base text-muted-foreground">
            Choose an active campaign to start dialing.
          </p>
          {header.kind !== "unavailable" && (
            <div
              data-testid="presence-header"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <span
                className={
                  header.kind === "active"
                    ? "h-2 w-2 rounded-full bg-success"
                    : "h-2 w-2 rounded-full bg-muted-foreground/40"
                }
                aria-hidden="true"
              />
              {header.kind === "active"
                ? `${header.count} active agent${header.count === 1 ? "" : "s"}`
                : "No active agents"}
            </div>
          )}
          {!campaignsLoading && onRefreshCampaigns && (
            <div>
              <button
                type="button"
                onClick={onRefreshCampaigns}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh campaigns
              </button>
            </div>
          )}
        </div>

        {campaignStatsError && onRetryStats && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span>Could not load lead counts.</span>
            <button
              type="button"
              onClick={onRetryStats}
              className="font-semibold underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {campaignsLoading && <CampaignTableSkeleton columns={leadershipView ? 7 : 6} />}

        {!campaignsLoading && campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground">No active campaigns</p>
        )}

        {!campaignsLoading && sortedCampaigns.length > 0 && (
          <CampaignSelectionTable
            campaigns={sortedCampaigns}
            campaignStateStats={campaignStateStats}
            campaignStatsLoading={campaignStatsLoading}
            campaignStatsError={campaignStatsError}
            campaignLastDialed={campaignLastDialed}
            campaignEditPermissions={campaignEditPermissions}
            presence={presence}
            leadershipView={leadershipView}
            assigneeProfiles={assigneeProfiles}
            nowMs={resolvedNowMs}
            onSelectCampaign={onSelectCampaign}
            onOpenSettings={onOpenSettings}
            onPrefetchCampaign={onPrefetchCampaign}
          />
        )}
      </div>
    </div>
  );
}
