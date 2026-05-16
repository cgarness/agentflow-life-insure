import React from "react";
import { Phone, Settings, Users } from "lucide-react";
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
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        {/* Header */}
        <div className="text-center mb-10 max-w-lg">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full mb-4">
            <Phone className="w-3.5 h-3.5" />
            DIALER
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Select a Campaign</h1>
          <p className="text-sm text-muted-foreground">
            Choose an active campaign to start dialing
          </p>
        </div>

        {campaignsLoading && (
          <div className="flex w-full max-w-5xl flex-col gap-4">
            <div className="h-48 w-full max-w-sm mx-auto bg-muted animate-pulse rounded-xl" />
            <div className="h-48 w-full max-w-sm mx-auto bg-muted animate-pulse rounded-xl" />
            <div className="h-48 w-full max-w-sm mx-auto bg-muted animate-pulse rounded-xl" />
          </div>
        )}

        {!campaignsLoading && campaigns.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">No active campaigns</p>
          </div>
        )}

        {!campaignsLoading && campaigns.length > 0 && (
          <div className="flex w-full max-w-6xl flex-wrap justify-center gap-6">
            {campaigns.map((campaign: any) => {
              const states = campaignStateStats[campaign.id] || [];
              const totalContacts = states.reduce((sum, s) => sum + s.count, 0);

              return (
                <div
                  key={campaign.id}
                  className="flex w-full max-w-[20rem] flex-col rounded-xl border border-border bg-card p-5 shadow-sm"
                >
                  {/* Campaign Name & Type */}
                  <div className="flex flex-col items-center gap-1.5 pb-3">
                    <h3 className="font-bold text-lg text-foreground text-center line-clamp-2 leading-tight">
                      {campaign.name}
                    </h3>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-widest font-black px-2.5 py-0.5 rounded-full border",
                        getCampaignTypeColor(campaign.type),
                      )}
                    >
                      {campaign.type}
                    </span>
                  </div>

                  {/* Total contacts */}
                  <div className="flex flex-col items-center gap-0.5 border-y border-border/60 py-3 mb-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-[10px] uppercase tracking-widest font-black">Total contacts</span>
                    </div>
                    <span className="text-3xl font-bold tabular-nums text-foreground">
                      {totalContacts.toLocaleString()}
                    </span>
                  </div>

                  {/* States */}
                  <div className="flex flex-1 flex-col gap-2 min-h-[4.5rem]">
                    <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground text-center">
                      States
                    </p>
                    {states.length > 0 ? (
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {states.slice(0, 8).map((s: { state: string; count: number }) => (
                          <span
                            key={s.state}
                            className="inline-flex items-center justify-center text-[10px] px-2 py-1 rounded-md font-bold bg-primary/10 text-primary border border-primary/20"
                          >
                            {s.state} ({s.count.toLocaleString()})
                          </span>
                        ))}
                        {states.length > 8 && (
                          <span className="text-[10px] text-muted-foreground self-center">
                            +{states.length - 8} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="py-2 text-center text-[10px] text-muted-foreground italic">
                        No leads assigned
                      </p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-4 flex gap-2 pt-3 border-t border-border/50">
                    <button
                      type="button"
                      onClick={() => onSelectCampaign(campaign.id)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-all shadow-sm"
                    >
                      Start Dialing
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSettings(campaign.id)}
                      className="px-4 py-2.5 rounded-lg bg-accent text-foreground text-xs font-bold uppercase tracking-widest hover:bg-accent/80 flex items-center gap-1.5 transition-all"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Settings
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
