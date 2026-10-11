import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatTimeUntil } from "@/lib/queue-manager";

/**
 * QueueExhaustedNotice — Team/Open accurate "why is the queue empty" message.
 *
 * Distinguishes empty / exhausted / temporarily-ineligible / locked-by-others
 * using the org-scoped get_queue_metrics RPC (the only accurate source under
 * RLS — regular agents cannot see other agents' locks). Aggregate counts only.
 * Loading and a failed load (RPC error or no row) are their own states.
 */
interface QueueMetricsRow {
  total_leads: number;
  eligible_leads: number;
  locked_leads: number;
  active_agents: number;
  available_leads: number;
  retry_blocked_leads: number;
  callback_waiting_leads: number;
  next_eligible_at: string | null;
}

interface QueueExhaustedNoticeProps {
  campaignId: string;
  /** When true, the campaign restricts the queue to the agent's licensed states (Build 2b). */
  requireLicensedStateAccess?: boolean;
}

/**
 * Result owned by the campaign it was fetched for. A result whose campaignId is
 * not the current prop is ignored, so the notice reads "loading" until the
 * current campaign's own response arrives (never a previous campaign's row).
 */
type QueueMetricsResult =
  | { campaignId: string; status: "ready"; row: QueueMetricsRow }
  | { campaignId: string; status: "error" };

export default function QueueExhaustedNotice({ campaignId, requireLicensedStateAccess = false }: QueueExhaustedNoticeProps) {
  const [result, setResult] = useState<QueueMetricsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!campaignId) return;
    // RPC absent from generated types → narrow cast (sanctioned pattern).
    (supabase as any)
      .rpc("get_queue_metrics", { p_campaign_id: campaignId })
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (cancelled) return;
        if (error) {
          console.error("[QueueExhaustedNotice] get_queue_metrics error:", error);
          setResult({ campaignId, status: "error" });
          return;
        }
        const r = (Array.isArray(data) ? data[0] : data) as QueueMetricsRow | undefined;
        setResult(r ? { campaignId, status: "ready", row: r } : { campaignId, status: "error" });
      });
    return () => { cancelled = true; };
  }, [campaignId]);

  const current = result?.campaignId === campaignId ? result : null;
  const row = current?.status === "ready" ? current.row : null;

  let heading = "Checking queue…";
  let detail = "";

  if (current?.status === "error") {
    heading = "Couldn't load queue status.";
  } else if (row) {
    if (row.total_leads === 0) {
      heading = "This Campaign Has No Leads.";
    } else if (requireLicensedStateAccess) {
      // Licensed-state access is on (Build 2b): the queue is restricted to the
      // agent's licensed states. The campaign has leads, but none are claimable
      // for this agent — the most relevant explanation (get_queue_metrics does
      // not model licensing, so this takes precedence over its generic buckets).
      heading = "No leads in your licensed states for this campaign.";
      detail = "Add licenses in your profile or ask your admin.";
    } else if (row.eligible_leads === 0) {
      heading = "Campaign Complete.";
      detail = "Every lead in this campaign has been processed (called, removed, or marked DNC).";
    } else if (row.available_leads === 0 && row.locked_leads > 0) {
      heading = "All Available Leads Are Being Dialed.";
      const agents = row.active_agents;
      detail = `${row.locked_leads} lead${row.locked_leads !== 1 ? "s are" : " is"} locked by ${agents} active agent${agents !== 1 ? "s" : ""}.`;
    } else {
      heading = "No Eligible Leads Right Now.";
      const bits: string[] = [];
      if (row.retry_blocked_leads > 0) bits.push(`${row.retry_blocked_leads} waiting on retry`);
      if (row.callback_waiting_leads > 0) bits.push(`${row.callback_waiting_leads} upcoming callback${row.callback_waiting_leads !== 1 ? "s" : ""}`);
      detail = bits.length
        ? `${bits.join(", ")}.`
        : "Waiting on retry timing, callbacks, or suppression.";
    }
  }

  const nextEligible =
    row?.next_eligible_at && new Date(row.next_eligible_at) > new Date()
      ? row.next_eligible_at
      : null;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="bg-accent/30 p-8 rounded-full mb-6">
        <Users className="w-12 h-12 text-muted-foreground opacity-40" />
      </div>
      <h2 className="text-xl font-bold mb-2">{heading}</h2>
      {detail && <p className="text-sm text-muted-foreground max-w-md mb-2">{detail}</p>}
      {nextEligible && (
        <p className="text-sm font-semibold text-primary mb-4">
          Next eligible in {formatTimeUntil(nextEligible, new Date())}
        </p>
      )}
    </div>
  );
}
