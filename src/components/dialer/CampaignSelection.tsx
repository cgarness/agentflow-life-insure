import React, { useMemo } from "react";
import { Phone, RefreshCw, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

const getCampaignTypeColor = (type: string) => {
  const t = (type || "").toUpperCase();
  if (t === "TEAM") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (t === "PERSONAL") return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  if (t.includes("POOL")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-muted text-muted-foreground border-border";
};

const formatCampaignDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// TODO: last_dialed_at column not yet present on campaigns table
const formatLastDialed = (campaign: { last_dialed_at?: string | null }): string => {
  const iso = campaign.last_dialed_at;
  if (!iso) return "Never";
  return formatCampaignDate(iso);
};

const sortCampaignsOldestFirst = <T extends { created_at?: string | null }>(items: T[]): T[] =>
  items.slice().sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });

/* ─── Props ─── */

export interface CampaignSelectionProps {
  campaigns: any[];
  campaignsLoading: boolean;
  campaignStateStats: Record<string, { state: string; count: number }[]>;
  campaignStatsLoading?: boolean;
  campaignStatsError?: boolean;
  onRetryStats?: () => void;
  onRefreshCampaigns?: () => void;
  onSelectCampaign: (id: string) => void;
  onOpenSettings: (campaignId: string) => void;
  /** Warm the header-stat cache for a campaign on hover/focus so entering it paints instantly. */
  onPrefetchCampaign?: (id: string) => void;
}

interface CampaignCardProps {
  campaign: any;
  states: { state: string; count: number }[] | undefined;
  statsPending: boolean;
  statsError: boolean;
  onSelectCampaign: (id: string) => void;
  onOpenSettings: (campaignId: string) => void;
  onPrefetchCampaign?: (id: string) => void;
}

function CampaignCard({
  campaign,
  states,
  statsPending,
  statsError,
  onSelectCampaign,
  onOpenSettings,
  onPrefetchCampaign,
}: CampaignCardProps) {
  const loadedStates = states ?? [];
  const totalContacts = loadedStates.reduce((sum, s) => sum + s.count, 0);
  const statsLoaded = states !== undefined;

  return (
    <div
      className="flex w-44 flex-col rounded-lg border border-border bg-card p-3 shadow-sm"
      onMouseEnter={() => onPrefetchCampaign?.(campaign.id)}
      onFocus={() => onPrefetchCampaign?.(campaign.id)}
    >
      <div className="mb-2 text-center">
        <h3 className="text-sm font-bold text-foreground truncate leading-tight" title={campaign.name}>
          {campaign.name}
        </h3>
        <span
          className={cn(
            "mt-1 inline-block text-[9px] uppercase tracking-wider font-bold px-1.5 py-px rounded-full border",
            getCampaignTypeColor(campaign.type),
          )}
        >
          {campaign.type}
        </span>
      </div>

      <div className="flex items-baseline justify-center gap-1 border-y border-border/50 py-1.5 mb-2 min-h-[1.75rem]">
        {statsPending ? (
          <span className="text-[10px] text-muted-foreground italic">Loading counts…</span>
        ) : statsError && !statsLoaded ? (
          <span className="text-[10px] text-muted-foreground">—</span>
        ) : (
          <>
            <span className="text-lg font-bold tabular-nums leading-none text-foreground">
              {totalContacts.toLocaleString()}
            </span>
            <span className="text-[9px] uppercase tracking-wide font-semibold text-muted-foreground">
              contacts
            </span>
          </>
        )}
      </div>

      <div className="mb-2 min-h-[2.25rem]">
        {statsPending ? (
          <p className="text-center text-[9px] text-muted-foreground italic">Loading counts…</p>
        ) : statsError && !statsLoaded ? null : loadedStates.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-1">
            {loadedStates.slice(0, 6).map((s) => (
              <span
                key={s.state}
                className="inline-flex items-center text-[9px] px-1 py-0.5 rounded font-semibold bg-primary/10 text-primary border border-primary/20"
              >
                {s.state} ({s.count})
              </span>
            ))}
            {loadedStates.length > 6 && (
              <span className="text-[9px] text-muted-foreground">+{loadedStates.length - 6}</span>
            )}
          </div>
        ) : (
          <p className="text-center text-[9px] text-muted-foreground italic">No leads</p>
        )}
      </div>

      <div className="mb-2 space-y-0.5 text-center text-[11px] text-muted-foreground">
        <p>Created: {formatCampaignDate(campaign.created_at)}</p>
        <p>Last dialed: {formatLastDialed(campaign)}</p>
      </div>

      <div className="mt-auto flex gap-1.5">
        <button
          type="button"
          onPointerDown={() => onPrefetchCampaign?.(campaign.id)}
          onClick={() => onSelectCampaign(campaign.id)}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-primary text-primary-foreground text-[9px] font-bold uppercase tracking-wide hover:bg-primary/90 transition-colors"
        >
          Start
        </button>
        <button
          type="button"
          onClick={() => onOpenSettings(campaign.id)}
          className="shrink-0 p-1.5 rounded-md bg-accent text-foreground hover:bg-accent/80 transition-colors"
          aria-label={`Settings for ${campaign.name}`}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Component ─── */

export default function CampaignSelection({
  campaigns,
  campaignsLoading,
  campaignStateStats,
  campaignStatsLoading = false,
  campaignStatsError = false,
  onRetryStats,
  onRefreshCampaigns,
  onSelectCampaign,
  onOpenSettings,
  onPrefetchCampaign,
}: CampaignSelectionProps) {
  const sortedCampaigns = useMemo(() => sortCampaignsOldestFirst(campaigns), [campaigns]);

  return (
    <div className="flex flex-col min-h-full bg-background text-foreground">
      <div className="flex flex-1 flex-col items-start justify-start px-4 pt-10 pb-8">
        <div className="mb-10 max-w-lg">
          <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-[10px] font-semibold px-2.5 py-0.5 rounded-full mb-3">
            <Phone className="w-3 h-3" />
            DIALER
          </div>
          <h1 className="text-3xl font-extrabold text-foreground mb-1">Select a Campaign</h1>
          <p className="text-base text-muted-foreground">Choose an active campaign to start dialing</p>
          {!campaignsLoading && onRefreshCampaigns && (
            <button
              type="button"
              onClick={onRefreshCampaigns}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh campaigns
            </button>
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

        {campaignsLoading && (
          <div className="flex flex-wrap gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 w-44 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        )}

        {!campaignsLoading && campaigns.length === 0 && (
          <p className="text-muted-foreground text-sm">No active campaigns</p>
        )}

        {!campaignsLoading && sortedCampaigns.length > 0 && (
          <div className="flex w-full max-w-5xl flex-wrap gap-3">
            {sortedCampaigns.map((campaign) => {
              const states = campaignStateStats[campaign.id];
              const statsPending =
                !campaignStatsError &&
                (campaignStatsLoading || states === undefined);
              return (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  states={states}
                  statsPending={statsPending}
                  statsError={campaignStatsError}
                  onSelectCampaign={onSelectCampaign}
                  onOpenSettings={onOpenSettings}
                  onPrefetchCampaign={onPrefetchCampaign}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
