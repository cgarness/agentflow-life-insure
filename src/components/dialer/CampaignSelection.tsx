import React from "react";
import { Phone, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

const getCampaignTypeColor = (type: string) => {
  const t = (type || "").toUpperCase();
  if (t === "TEAM") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (t === "PERSONAL") return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  if (t.includes("POOL")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-muted text-muted-foreground border-border";
};

/* ─── Props ─── */

export interface CampaignSelectionProps {
  campaigns: any[];
  campaignsLoading: boolean;
  campaignStateStats: Record<string, { state: string; count: number }[]>;
  onSelectCampaign: (id: string) => void;
  onOpenSettings: (campaignId: string) => void;
}

/* ─── Component ─── */

export default function CampaignSelection({
  campaigns,
  campaignsLoading,
  campaignStateStats,
  onSelectCampaign,
  onOpenSettings,
}: CampaignSelectionProps) {
  return (
    <div className="flex flex-col min-h-full bg-background text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        {/* Header */}
        <div className="text-center mb-6 max-w-lg">
          <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-[10px] font-semibold px-2.5 py-0.5 rounded-full mb-3">
            <Phone className="w-3 h-3" />
            DIALER
          </div>
          <h1 className="text-xl font-bold text-foreground mb-0.5">Select a Campaign</h1>
          <p className="text-xs text-muted-foreground">
            Choose an active campaign to start dialing
          </p>
        </div>

        {campaignsLoading && (
          <div className="flex flex-wrap justify-center gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-36 w-44 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        )}

        {!campaignsLoading && campaigns.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground text-sm">No active campaigns</p>
          </div>
        )}

        {!campaignsLoading && campaigns.length > 0 && (
          <div className="flex w-full max-w-5xl flex-wrap justify-center gap-3">
            {campaigns.map((campaign: any) => {
              const states = campaignStateStats[campaign.id] || [];
              const totalContacts = states.reduce((sum, s) => sum + s.count, 0);

              return (
                <div
                  key={campaign.id}
                  className="flex w-44 flex-col rounded-lg border border-border bg-card p-3 shadow-sm"
                >
                  {/* Name & type */}
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

                  {/* Total contacts */}
                  <div className="flex items-baseline justify-center gap-1 border-y border-border/50 py-1.5 mb-2">
                    <span className="text-lg font-bold tabular-nums leading-none text-foreground">
                      {totalContacts.toLocaleString()}
                    </span>
                    <span className="text-[9px] uppercase tracking-wide font-semibold text-muted-foreground">
                      contacts
                    </span>
                  </div>

                  {/* States */}
                  <div className="mb-2 min-h-[2.25rem]">
                    {states.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-1">
                        {states.slice(0, 6).map((s: { state: string; count: number }) => (
                          <span
                            key={s.state}
                            className="inline-flex items-center text-[9px] px-1 py-0.5 rounded font-semibold bg-primary/10 text-primary border border-primary/20"
                          >
                            {s.state} ({s.count})
                          </span>
                        ))}
                        {states.length > 6 && (
                          <span className="text-[9px] text-muted-foreground">+{states.length - 6}</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-center text-[9px] text-muted-foreground italic">No leads</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-auto flex gap-1.5">
                    <button
                      type="button"
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}
