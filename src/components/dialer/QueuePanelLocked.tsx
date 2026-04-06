import React, { useEffect, useState, useCallback } from "react";
import { Lock, Users, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueueCounts {
  total: number;
  locked: number;
  agentsActive: number;
  available: number;
}

interface ManagerFilters {
  status: string;
  state: string;
  lead_source: string;
  max_attempts: string;
  min_score: string;
  max_score: string;
}

const managerFiltersSchema = z.object({
  status: z.string(),
  state: z.string(),
  lead_source: z.string(),
  max_attempts: z.string(),
  min_score: z.string(),
  max_score: z.string(),
});

const POLL_INTERVAL_MS = 15_000;

// ─── Props ───────────────────────────────────────────────────────────────────

interface QueuePanelLockedProps {
  campaignId: string;
  organizationId: string | null;
  /** 'manager' or 'owner' can see/edit the Campaign Filters section. */
  userRole: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * QueuePanelLocked — Team / Open Pool queue view.
 *
 * Renders a count card, metric pills, and a lock notice instead of a lead list.
 * Counts are fetched via direct Supabase queries (no Realtime), polled every 15s.
 * Manager/Owner sees a collapsed Campaign Filters section to set queue_filters
 * on the campaign record.
 */
export default function QueuePanelLocked({
  campaignId,
  organizationId,
  userRole,
}: QueuePanelLockedProps) {
  const [counts, setCounts] = useState<QueueCounts>({
    total: 0,
    locked: 0,
    agentsActive: 0,
    available: 0,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ManagerFilters>({
    status: "",
    state: "",
    lead_source: "",
    max_attempts: "",
    min_score: "",
    max_score: "",
  });
  const [saving, setSaving] = useState(false);

  const isManager = userRole === "manager" || userRole === "owner" ||
    userRole === "Admin" || userRole === "Team Leader";

  const fetchCounts = useCallback(async () => {
    if (!campaignId || !organizationId) return;

    const [totalRes, lockRes] = await Promise.all([
      supabase
        .from("campaign_leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("organization_id", organizationId)
        .not("status", "in", '("DNC","Completed","Removed")'),

      supabase
        .from("dialer_lead_locks")
        .select("agent_id")
        .eq("campaign_id", campaignId)
        .gt("expires_at", new Date().toISOString()),
    ]);

    const total = totalRes.count ?? 0;
    const lockRows = lockRes.data ?? [];
    const locked = lockRows.length;
    const agentsActive = new Set(lockRows.map((r) => r.agent_id)).size;
    const available = Math.max(0, total - locked);

    setCounts({ total, locked, agentsActive, available });
  }, [campaignId, organizationId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  // Load existing manager filters when panel opens
  useEffect(() => {
    if (!filtersOpen || !campaignId) return;
    supabase
      .from("campaigns")
      .select("queue_filters")
      .eq("id", campaignId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.queue_filters && typeof data.queue_filters === "object") {
          const qf = data.queue_filters as Record<string, string>;
          setFilters({
            status: qf.status ?? "",
            state: qf.state ?? "",
            lead_source: qf.lead_source ?? "",
            max_attempts: qf.max_attempts ?? "",
            min_score: qf.min_score ?? "",
            max_score: qf.max_score ?? "",
          });
        }
      });
  }, [filtersOpen, campaignId]);

  const handleSaveFilters = async () => {
    const parsed = managerFiltersSchema.safeParse(filters);
    if (!parsed.success) return;
    setSaving(true);
    // Strip empty strings so the RPC treats absent keys as "no filter"
    const payload = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== "")
    );
    await supabase
      .from("campaigns")
      .update({ queue_filters: payload })
      .eq("id", campaignId);
    setSaving(false);
    setFiltersOpen(false);
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Count card */}
      <div className="bg-card border border-border rounded-xl p-5 text-center">
        <div className="text-6xl font-black text-foreground font-mono leading-none">
          {counts.available}
        </div>
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-2">
          Leads in Queue
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {counts.agentsActive} agent{counts.agentsActive !== 1 ? "s" : ""} dialing · Manager
          filters active
        </div>
      </div>

      {/* Metric pills */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Locked", value: counts.locked, icon: <Lock className="w-3 h-3" /> },
          {
            label: "Active Agents",
            value: counts.agentsActive,
            icon: <Users className="w-3 h-3" />,
          },
          {
            label: "Available",
            value: counts.available,
            icon: <Radio className="w-3 h-3" />,
          },
        ].map((m) => (
          <div
            key={m.label}
            className="bg-muted/30 border border-border rounded-lg px-2 py-2 text-center flex flex-col items-center gap-1"
          >
            <div className="text-muted-foreground">{m.icon}</div>
            <div className="text-lg font-black text-foreground font-mono">{m.value}</div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
              {m.label}
            </div>
          </div>
        ))}
      </div>

      {/* Lock notice */}
      <div className="px-3 py-3 bg-muted/20 border border-border/50 rounded-lg">
        <p className="text-[10px] text-muted-foreground leading-relaxed text-center">
          Queue order is managed by your campaign admin.
          <br />
          Leads are assigned automatically as you dial.
        </p>
      </div>

      {/* Manager filters — collapsed by default */}
      {isManager && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            <span>Campaign Filters</span>
            <span>{filtersOpen ? "▲" : "▼"}</span>
          </button>
          {filtersOpen && (
            <div className="p-3 border-t border-border space-y-3">
              <p className="text-[9px] text-muted-foreground">
                These filters apply to all agents in this campaign.
              </p>
              {(
                [
                  { key: "status", label: "Status" },
                  { key: "state", label: "State (2-letter)" },
                  { key: "lead_source", label: "Lead Source" },
                  { key: "max_attempts", label: "Max Attempts" },
                  { key: "min_score", label: "Min Score" },
                  { key: "max_score", label: "Max Score" },
                ] as const
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold block mb-0.5">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={filters[key]}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, [key]: e.target.value }))
                    }
                    placeholder="Any"
                    className="w-full px-2 py-1 text-xs bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              ))}
              <button
                onClick={handleSaveFilters}
                disabled={saving}
                className="w-full py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 transition-opacity"
              >
                {saving ? "Saving…" : "Save Filters"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
