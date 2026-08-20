import React from "react";
import { Settings } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { CAMPAIGN_SETTINGS_COPY } from "./campaignSettingsSchema";
import CampaignAvatarStack from "./CampaignAvatarStack";
import {
  assignedCellModel,
  formatCampaignDate,
  formatCallingWindow,
  maxAttemptsLabel,
  retryIntervalLabel,
  ringTimeoutLabel,
  type AssigneeProfileMap,
  type CampaignRecord,
  type CampaignStateCount,
} from "./campaignSelectionModel";
import type { CampaignPresenceEntry } from "@/lib/supabase-dialer-presence";

interface CampaignSelectionRowDetailsProps {
  campaign: CampaignRecord;
  detailsId: string;
  colSpan: number;
  states: CampaignStateCount[] | undefined;
  presenceEntry: CampaignPresenceEntry | undefined;
  presenceAvailable: boolean;
  leadershipView: boolean;
  assigneeProfiles?: AssigneeProfileMap;
  canEditSettings: boolean;
  onOpenSettings: (campaignId: string) => void;
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}

/** Expanded second row — existing campaign data only; opening it never starts a session. */
export default function CampaignSelectionRowDetails({
  campaign,
  detailsId,
  colSpan,
  states,
  presenceEntry,
  presenceAvailable,
  leadershipView,
  assigneeProfiles,
  canEditSettings,
  onOpenSettings,
}: CampaignSelectionRowDetailsProps) {
  const loadedStates = states ?? [];
  const assigned = assignedCellModel(campaign, assigneeProfiles);

  return (
    <TableRow
      id={detailsId}
      data-testid={`campaign-details-${campaign.id}`}
      className="bg-muted/30 hover:bg-muted/30"
    >
      <TableCell colSpan={colSpan} className="p-4">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
              Contact states
            </p>
            {loadedStates.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {loadedStates.map((s) => (
                  <span
                    key={s.state}
                    className="inline-flex items-center rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                  >
                    {s.state} ({s.count})
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No leads</p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <DetailItem label="Created" value={formatCampaignDate(campaign.created_at)} />
            <DetailItem
              label="Calling window"
              value={formatCallingWindow(campaign.calling_hours_start, campaign.calling_hours_end)}
            />
            <DetailItem label="Ring timeout" value={ringTimeoutLabel(campaign.ring_timeout_seconds)} />
            <DetailItem label="Max attempts" value={maxAttemptsLabel(campaign.max_attempts)} />
            <DetailItem label="Retry interval" value={retryIntervalLabel(campaign)} />
          </dl>

          {leadershipView && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                  Assigned
                </p>
                {assigned.kind === "open" && (
                  <p className="text-sm text-muted-foreground">Open to agency</p>
                )}
                {assigned.kind === "personal" && (
                  <p className="text-sm text-foreground">
                    {assigned.owner?.displayName ?? "Unknown"}
                  </p>
                )}
                {assigned.kind === "team" &&
                  (assigned.people.length > 0 ? (
                    <ul className="space-y-1">
                      {assigned.people.map((p) => (
                        <li key={p.id} className="text-sm text-foreground">
                          {p.displayName ?? "Unknown"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  ))}
                {assigned.kind === "unknown" && <p className="text-sm text-muted-foreground">—</p>}
              </div>
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                  Active agents
                </p>
                {!presenceAvailable || !presenceEntry ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : presenceEntry.activeAgents.length > 0 ? (
                  <ul className="space-y-1">
                    {presenceEntry.activeAgents.map((a) => (
                      <li key={a.agentId} className="flex items-center gap-1.5 text-sm text-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                        {a.displayName ?? "Unknown"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No active agents</p>
                )}
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings(campaign.id);
              }}
              disabled={!canEditSettings}
              title={canEditSettings ? undefined : CAMPAIGN_SETTINGS_COPY.noPermission}
              aria-label={canEditSettings ? "Campaign Settings" : CAMPAIGN_SETTINGS_COPY.noPermission}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
            >
              <Settings className="h-3.5 w-3.5" />
              Campaign Settings
            </button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
