import React from "react";
import { CheckCircle, PhoneForwarded, User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { dispatchQuickCall, type QuickCallContactType } from "@/lib/quick-call";
import { buildMyMissedCallsOrFilter } from "@/lib/missedCallScope";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { assertPageActive } from "@/lib/pageActivity";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";

interface MissedCallsWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
}

interface MissedCallItem {
  /** `calls` row id — used as a React key ONLY, never as a contact identity. */
  id: string;
  contactId: string | null;
  contactName: string;
  createdAt: string;
  phone: string;
  /** Real contact kind, resolved from the contact tables — never assumed. */
  contactType: QuickCallContactType | null;
  /** D13 label ("Missed in AgentFlow — forwarded to mobile", …). */
  outcomeLabel: string;
  voicemailId: string | null;
}

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/** The last 24 h of missed calls; throws on a query error (a failure is never "All caught up!"). */
async function loadMissedCalls(userId: string, isFiltered: boolean, signal: AbortSignal): Promise<MissedCallItem[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from("calls")
    .select("id, contact_id, contact_name, contact_phone, created_at, disposition_name, direction, is_missed, missed_reason, outcome, agent_id, answered_by_agent_id, voicemail_id")
    .eq("direction", "inbound")
    .eq("is_missed", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  if (isFiltered) {
    // D13 (§3.2): a missed row has no answering agent, so `agent_id = me` never matched. Scope
    // by the intended recipient / durable snapshot / legacy routed wave instead (UUID-validated).
    const scope = buildMyMissedCallsOrFilter(userId);
    if (!scope) return [];
    q = q.or(scope);
  }

  const { data, error } = await q.abortSignal(signal);
  if (error) throw error;
  // An empty result clears the list (a refresh must not leave calls that are gone).
  if (!data || data.length === 0) return [];

  // `calls.contact_type` is NULL on most real rows (AGENT_RULES §5), so it cannot
  // be trusted as the contact kind. Resolve it from the contact tables instead —
  // that is also what gives a client contact a dialable phone at all.
  const contactIds = data
    .map((c) => c.contact_id)
    .filter(Boolean) as string[];
  const contactMap: Record<string, { phone: string; type: QuickCallContactType }> = {};
  if (contactIds.length > 0) {
    // A follow-on read: a tab hidden or offline since the calls read sends nothing
    // more; the section loads again once the tab is visible and online.
    assertPageActive();
    const [{ data: leads, error: leadsError }, { data: clients, error: clientsError }] = await Promise.all([
      supabase.from("leads").select("id, phone").in("id", contactIds).abortSignal(signal),
      supabase.from("clients").select("id, phone").in("id", contactIds).abortSignal(signal),
    ]);
    // A failed lookup is a failure, never "no linked contact record" (AGENT_RULES #22).
    if (leadsError || clientsError) throw leadsError ?? clientsError;
    for (const lead of leads ?? []) {
      contactMap[lead.id] = { phone: lead.phone ?? "", type: "lead" };
    }
    for (const client of clients ?? []) {
      contactMap[client.id] = { phone: client.phone ?? "", type: "client" };
    }
  }

  return data.map((c) => {
    const resolved = c.contact_id ? contactMap[c.contact_id] : undefined;
    return {
      id: c.id,
      contactId: c.contact_id,
      contactName: c.contact_name || "Unknown",
      createdAt: c.created_at || "",
      // Fall back to the number the call itself recorded when the contact row
      // is gone — the missed call is still actionable.
      phone: resolved?.phone || c.contact_phone || "",
      contactType: resolved?.type ?? null,
      outcomeLabel: describeInboundCallOutcome(c).label,
      voicemailId: c.voicemail_id ?? null,
    };
  });
}

const MissedCallsWidget: React.FC<MissedCallsWidgetProps> = ({
  userId,
  role,
  adminToggle,
  refreshSignal,
  refreshTracker,
}) => {
  const isFiltered = role !== "Admin" || adminToggle === "my";
  // One load at a time; a failed refresh keeps this perspective's list and says so.
  const section = useDashboardSection<MissedCallItem[]>({
    section: "missed_calls",
    userId,
    scope: String(isFiltered),
    load: (signal) => loadMissedCalls(userId, isFiltered, signal),
    refreshSignal,
    refreshTracker,
  });
  const calls = section.data ?? [];
  const notice = <DashboardSectionNotice state={section} label="missed calls" className="mb-3" />;

  const handleCallBack = (e: React.MouseEvent, item: MissedCallItem) => {
    // Keep the action inside the button — it must not open the parent widget card.
    e.stopPropagation();

    if (!item.contactId || !item.contactType) {
      toast.error("This call has no linked contact record — open it in Contacts to call back.");
      return;
    }
    const started = dispatchQuickCall({
      contactId: item.contactId,
      name: item.contactName,
      phone: item.phone,
      type: item.contactType,
    });
    // Never report a call that did not start.
    if (!started) toast.error(`No phone number on file for ${item.contactName}.`);
  };

  if (section.loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted/20 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (section.data === null) return <DashboardSectionUnavailable state={section} label="missed calls" />;

  if (calls.length === 0) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        {notice}
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-500 opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">All caught up!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice}
      {calls.map((call, idx) => (
        <motion.div
          key={call.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.05 }}
          className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-transparent hover:border-red-500/20 hover:bg-red-500/5 transition-all group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center shrink-0">
              <PhoneForwarded className="w-5 h-5 text-red-500/50" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-foreground truncate group-hover:text-red-500 transition-colors">
                {call.contactName}
              </p>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <p className="text-[10px] font-medium text-muted-foreground">
                  {timeAgo(call.createdAt)}
                </p>
                <p className="text-[10px] font-medium text-red-500/80 truncate" data-testid="missed-call-outcome">
                  {call.outcomeLabel}
                </p>
              </div>
              {call.voicemailId && (
                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                  <VoicemailPlayer voicemailId={call.voicemailId} compact />
                </div>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => handleCallBack(e, call)}
            className="rounded-lg shadow-sm hover:bg-red-500 hover:text-white hover:border-red-500 transition-all px-4 h-9"
          >
            Call Back
          </Button>
        </motion.div>
      ))}
    </div>
  );
};

export default MissedCallsWidget;
