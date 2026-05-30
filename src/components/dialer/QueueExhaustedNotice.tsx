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
}

export default function QueueExhaustedNotice({ campaignId }: QueueExhaustedNoticeProps) {
  const [row, setRow] = useState<QueueMetricsRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!campaignId) return;
    // RPC absent from generated types → narrow cast (sanctioned pattern).
    (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .rpc("get_queue_metrics", { p_campaign_id: campaignId })
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (cancelled) return;
        if (error) {
          console.error("[QueueExhaustedNotice] get_queue_metrics error:", error);
          setLoaded(true);
          return;
        }
        const r = (Array.isArray(data) ? data[0] : data) as QueueMetricsRow | undefined;
        setRow(r ?? null);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [campaignId]);

  let heading = "No Available Contacts In Queue.";
  let detail =
    "Your queue is empty or all contacts have been processed. Additional leads will appear here when assigned or eligible for retry.";

  if (loaded && row) {
    if (row.total_leads === 0) {
      heading = "This Campaign Has No Leads.";
      detail = "Import or assign leads to this campaign to start dialing.";
    } else if (row.eligible_leads === 0) {
      heading = "Campaign Complete.";
      detail = "Every lead in this campaign has been processed (called, removed, or marked DNC).";
    } else if (row.available_leads === 0 && row.locked_leads > 0) {
      heading = "All Available Leads Are Being Dialed.";
      const agents = row.active_agents;
      detail = `${row.locked_leads} lead${row.locked_leads !== 1 ? "s are" : " is"} currently locked by ${agents} active agent${agents !== 1 ? "s" : ""}. One may free up shortly.`;
    } else {
      heading = "No Eligible Leads Right Now.";
      const bits: string[] = [];
      if (row.retry_blocked_leads > 0) bits.push(`${row.retry_blocked_leads} waiting on retry`);
      if (row.callback_waiting_leads > 0) bits.push(`${row.callback_waiting_leads} upcoming callback${row.callback_waiting_leads !== 1 ? "s" : ""}`);
      detail = bits.length
        ? `Leads exist but aren't callable yet (${bits.join(", ")}).`
        : "Leads exist but aren't callable yet (retry timing, callbacks, or suppression).";
    }
  }

  const nextEligible =
    loaded && row?.next_eligible_at && new Date(row.next_eligible_at) > new Date()
      ? row.next_eligible_at
      : null;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="bg-accent/30 p-8 rounded-full mb-6">
        <Users className="w-12 h-12 text-muted-foreground opacity-40" />
      </div>
      <h2 className="text-xl font-bold mb-2">{heading}</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-2">{detail}</p>
      {nextEligible && (
        <p className="text-sm font-semibold text-primary mb-4">
          Next eligible in {formatTimeUntil(nextEligible, new Date())}
        </p>
      )}
    </div>
  );
}
