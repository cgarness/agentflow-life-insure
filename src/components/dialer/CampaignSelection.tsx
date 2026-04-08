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
  onToggleLocalPresence: (campaignId: string, newValue: boolean) => void;
}

/* ─── Component ─── */

export default function CampaignSelection({
  campaigns,
  campaignsLoading,
  campaignStateStats,
  onSelectCampaign,
  onOpenSettings,
  onToggleLocalPresence,
}: CampaignSelectionProps) {
  return (
    <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full mb-4">
          <Phone className="w-3.5 h-3.5" />
          DIALER
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Select a Campaign</h1>
        <p className="text-sm text-muted-foreground">
          Choose an active campaign to start dialing
        </p>
      </div>

      <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {campaignsLoading && (
          <div className="flex flex-col gap-4 col-span-full">
            <div className="h-20 w-full bg-muted animate-pulse rounded-xl" />
            <div className="h-20 w-full bg-muted animate-pulse rounded-xl" />
            <div className="h-20 w-full bg-muted animate-pulse rounded-xl" />
          </div>
        )}
        {!campaignsLoading && campaigns.length === 0 && (
          <div className="flex items-center justify-center py-12 col-span-full">
            <p className="text-muted-foreground text-sm">No active campaigns</p>
          </div>
        )}
        {!campaignsLoading &&
          campaigns.map((campaign: any) => {
            const states = campaignStateStats[campaign.id] || [];

            return (
              <div
                key={campaign.id}
                className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3"
              >
                {/* Campaign Name & Type - Centered */}
                <div className="flex flex-col items-center gap-1.5 py-2">
                  <h3 className="font-bold text-lg text-foreground text-center line-clamp-1">{campaign.name}</h3>
                  <span className={cn(
                    "text-[10px] uppercase tracking-widest font-black px-2.5 py-0.5 rounded-full border",
                    getCampaignTypeColor(campaign.type)
                  )}>
                    {campaign.type}
                  </span>
                </div>

                {/* States - Only those in the campaign */}
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground text-center">States</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {states.slice(0, 8).map((s: { state: string; count: number }) => (
                      <span
                        key={s.state}
                        className="flex items-center justify-center text-[10px] px-1 py-1 rounded-md font-bold transition-all bg-primary/10 text-primary border border-primary/20"
                      >
                        {s.state} ({s.count})
                      </span>
                    ))}
                    {states.length === 0 && (
                      <div className="col-span-full py-2 text-center text-[10px] text-muted-foreground italic">
                        No leads assigned
                      </div>
                    )}
                  </div>
                </div>

                {/* Local Presence toggle */}
                <div className="mt-auto flex items-center justify-between px-1 pt-3 border-t border-border/50">
                  <span className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Local Presence</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={campaign.local_presence_enabled !== false}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLocalPresence(campaign.id, !(campaign.local_presence_enabled !== false));
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      campaign.local_presence_enabled !== false ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      campaign.local_presence_enabled !== false ? "translate-x-4" : "translate-x-1"
                    }`} />
                  </button>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => onSelectCampaign(campaign.id)}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-all shadow-sm"
                  >
                    Start Dialing
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSettings(campaign.id)}
                    className="px-4 py-2 rounded-lg bg-accent text-foreground text-xs font-bold uppercase tracking-widest hover:bg-accent/80 flex items-center gap-1.5 transition-all"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Settings
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
