import React from "react";
import { Loader2, Users, ListFilter, SortAsc, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import QueuePanelLocked from "./QueuePanelLocked";
import { getLeadTier, formatTimeUntil, type CampaignLead } from "@/lib/queue-manager";

// ─── Types ───────────────────────────────────────────────────────────────────

type QueueSortKey =
  | "smart"
  | "default"
  | "age_oldest"
  | "attempts_fewest"
  | "timezone"
  | "score_high"
  | "name_az";

type QueuePreviewField =
  | "age"
  | "state"
  | "score"
  | "source"
  | "attempts"
  | "status"
  | "best_time"
  | "health";

interface QueuePanelProps {
  campaignType: string;
  campaignId: string;
  organizationId: string | null;
  userRole: string;
  // ── Personal-only props (ignored for Team/Open) ──
  displayQueue: { lead: Record<string, unknown>; originalIndex: number }[];
  leadQueue: Record<string, unknown>[];
  currentLeadIndex: number;
  onSelectLead: (index: number) => void;
  queueSort: QueueSortKey;
  setQueueSort: (v: QueueSortKey) => void;
  showQueueFilters: boolean;
  setShowQueueFilters: (v: boolean) => void;
  loadingLeads: boolean;
  hasMoreLeads: boolean;
  currentOffset: number;
  fetchLeadsBatch: (campaignId: string, offset: number) => void;
  onClearFilters: () => void;
  filterSummary: string;
  leadCallStats: Record<string, { calls_today: number; total_calls: number; last_disposition: string | null }>;
}

const DISPOSITION_COLORS: Record<string, string> = {
  "New": "#3B82F6",
  "No Answer": "#6B7280",
  "Left Voicemail": "#14B8A6",
  "Not Available": "#EAB308",
  "Interested": "#22C55E",
  "Not Interested": "#EF4444",
  "DNC": "#EF4444",
  "Call Back": "#6366F1",
  "Appointment Set": "#A855F7",
  "Wrong Number": "#F97316"
};

const getBadgeStyle = (disp: string | null) => {
  if (!disp) return {};
  const color = DISPOSITION_COLORS[disp] || "#6B7280";
  return { backgroundColor: `${color}1A`, color: color, borderColor: `${color}4D` };
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * QueuePanel — campaign-type-aware queue panel.
 *
 * Personal → full lead list with sort/filter/preview controls (unchanged behaviour).
 * Team / Open Pool → QueuePanelLocked (count card, metric pills, lock notice).
 *
 * Filter and sort controls are hidden for agents on Team/Open.
 */
export default function QueuePanel({
  campaignType,
  campaignId,
  organizationId,
  userRole,
  displayQueue,
  leadQueue,
  currentLeadIndex,
  onSelectLead,
  queueSort,
  setQueueSort,
  showQueueFilters,
  setShowQueueFilters,
  loadingLeads,
  hasMoreLeads,
  currentOffset,
  fetchLeadsBatch,
  onClearFilters,
  filterSummary,
  leadCallStats,
}: QueuePanelProps) {
  const type = campaignType.toUpperCase();
  const isLocked = type === "TEAM" || type.includes("OPEN");

  // ── Team / Open Pool ──────────────────────────────────────────────────────
  if (isLocked) {
    return (
      <QueuePanelLocked
        campaignId={campaignId}
        organizationId={organizationId}
        userRole={userRole}
      />
    );
  }

  // ── Personal — full queue list ────────────────────────────────────────────
  const SORT_OPTIONS: { value: QueueSortKey; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "age_oldest", label: "Oldest First" },
    { value: "attempts_fewest", label: "Fewest Calls" },
    { value: "timezone", label: "By Timezone" },
    { value: "score_high", label: "Highest Score" },
    { value: "name_az", label: "Name A→Z" },
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap">
        <select
          value={queueSort}
          onChange={(e) => setQueueSort(e.target.value as QueueSortKey)}
          className="text-[9px] font-bold uppercase tracking-widest bg-card border border-border rounded px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setShowQueueFilters(!showQueueFilters);
          }}
          className={cn(
            "p-1 rounded transition-colors",
            showQueueFilters
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
          title="Filters"
        >
          <ListFilter className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() =>
            setQueueSort("default" as QueueSortKey)
          }
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Reset Sort"
        >
          <SortAsc className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter summary */}
      {filterSummary && (
        <div className="text-[9px] text-muted-foreground font-medium px-1">
          {filterSummary}
        </div>
      )}

      {/* Queue list */}
      {leadQueue.length === 0 ? (
        <div className="text-center py-8">
          <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
          <p className="text-sm text-muted-foreground">Queue is empty</p>
        </div>
      ) : displayQueue.length === 0 ? (
        <div className="text-center py-6">
          <ListFilter className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-20" />
          <p className="text-xs text-muted-foreground">No leads match filters</p>
          <button
            onClick={onClearFilters}
            className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground hover:text-destructive mt-2"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        displayQueue.map(({ lead, originalIndex }) => {
          const isCurrent = originalIndex === currentLeadIndex;
          const isPast = originalIndex < currentLeadIndex;
          const now = new Date();
          const tier = getLeadTier(lead as CampaignLead, now);
          const isPending = tier === 4 && !isCurrent && !isPast;
          const leadIdStr = String(lead.lead_id || lead.id || "");
          const stats = leadCallStats[leadIdStr] || { calls_today: 0, total_calls: 0, last_disposition: null };

          return (
            <div
              key={String(lead.id)}
              onClick={() => onSelectLead(originalIndex)}
              className={cn(
                "p-3 rounded-lg border flex items-center gap-3 cursor-pointer transition-all",
                isCurrent
                  ? "bg-primary/10 border-primary ring-1 ring-primary/20"
                  : isPast
                  ? "opacity-50 grayscale bg-muted/30 border-transparent"
                  : isPending
                  ? "opacity-50 bg-muted/20 border-border/50"
                  : "bg-card hover:bg-accent/50 border-border"
              )}
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  isCurrent
                    ? "bg-primary animate-pulse"
                    : isPast
                    ? "bg-muted"
                    : "bg-muted-foreground/30"
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-foreground truncate uppercase tracking-tight">
                  {String(lead.first_name || "")} {String(lead.last_name || "")}
                </div>
                <div className="text-[10px] text-muted-foreground truncate font-medium">
                  {String(lead.phone || "")}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {/* Exact Contact Stats */}
                  <span className="text-[10px] text-muted-foreground/90 font-medium">
                    Calls Today: <strong className="text-foreground">{stats.calls_today}</strong>
                  </span>
                  <span className="text-[10px] text-muted-foreground/90 font-medium">
                    Total Calls: <strong className="text-foreground">{stats.total_calls}</strong>
                  </span>
                  {stats.last_disposition && (
                    <span 
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm border shrink-0"
                      style={getBadgeStyle(stats.last_disposition)}
                    >
                      {stats.last_disposition}
                    </span>
                  )}

                  {/* ── Tier Badges ── */}
                  {!isCurrent && !isPast && tier === 1 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 shrink-0">
                      Callback Due
                    </span>
                  )}
                  {!isCurrent && !isPast && tier === 3 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 shrink-0">
                      Ready
                    </span>
                  )}
                  {(!isCurrent) && (() => {
                    const ts = String(lead.retry_eligible_at || lead.callback_due_at || "");
                    const isFuture = ts && new Date(ts) > now;
                    if (!isFuture) return null;
                    
                    const label = lead.callback_due_at
                      ? `Callback in ${formatTimeUntil(ts, now)}`
                      : `Retry in ${formatTimeUntil(ts, now)}`;
                      
                    return (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground shrink-0">
                        {label}
                      </span>
                    );
                  })()}
                </div>
              </div>
              {isCurrent && (
                <div className="text-[9px] font-black uppercase text-primary tracking-widest shrink-0">
                  Now
                </div>
              )}
            </div>
          );
        })
      )}

      {loadingLeads && (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        </div>
      )}

      {hasMoreLeads && !loadingLeads && leadQueue.length > 0 && (
        <button
          onClick={() => fetchLeadsBatch(campaignId, currentOffset)}
          className="text-[10px] text-muted-foreground hover:text-primary py-2 uppercase tracking-widest font-bold"
        >
          Load More
        </button>
      )}
    </div>
  );
}
