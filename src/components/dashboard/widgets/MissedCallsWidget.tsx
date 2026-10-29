import React from "react";
import { CheckCircle, ExternalLink, PhoneForwarded } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { dispatchQuickCall, type QuickCallContactType } from "@/lib/quick-call";
import { buildMyMissedCallsOrFilter } from "@/lib/missedCallScope";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { assertPageActive } from "@/lib/pageActivity";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { DashboardEmptyState, DashboardIconWell, DashboardList, DashboardListRow, DashboardRowSkeleton } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions } from "@/components/dashboard/ui/DashboardRowActions";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { DASHBOARD_TONES } from "@/components/dashboard/ui/dashboardTones";

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

/** The widget is a preview of the latest calls; the detail view lists the last 24 hours. */
const PREVIEW_LIMIT = 5;

const timeAgo = (dateStr: string) => {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
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
    .limit(PREVIEW_LIMIT);

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

const MissedCallsWidget: React.FC<MissedCallsWidgetProps> = ({ userId, role, adminToggle, refreshSignal, refreshTracker }) => {
  const navigate = useNavigate();
  const isFiltered = listScopeIsFiltered(role, adminToggle);
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
  const scopeNote = <DashboardScopeNote text={listScopeNote(role, adminToggle, "missed calls")} />;

  const handleCallBack = (item: MissedCallItem) => {
    if (!item.contactId || !item.contactType) {
      toast.error("This call has no linked contact record — open it in Contacts to call back.");
      return;
    }
    const started = dispatchQuickCall({ contactId: item.contactId, name: item.contactName, phone: item.phone, type: item.contactType });
    // Never report a call that did not start.
    if (!started) toast.error(`No phone number on file for ${item.contactName}.`);
  };

  if (section.loading) return <DashboardRowSkeleton />;

  if (section.data === null) return <DashboardSectionUnavailable state={section} label="missed calls" />;

  if (calls.length === 0) {
    return <DashboardEmptyState tone="green" icon={CheckCircle} title="All caught up!" notice={<>{notice}{scopeNote}</>} />;
  }

  return (
    <div className="space-y-3">
      {notice}
      {scopeNote}
      <DashboardList label="Missed calls">
        {calls.map((call) => {
          const href = contactHref(call.contactId, call.contactType);
          return (
            <DashboardListRow
              key={call.id}
              tone="red"
              leading={<DashboardIconWell tone="red" icon={PhoneForwarded} />}
              title={call.contactName}
              meta={timeAgo(call.createdAt)}
              detail={
                <>
                  <p className={`text-xs font-medium ${DASHBOARD_TONES.red.text}`} data-testid="missed-call-outcome">{call.outcomeLabel}</p>
                  {call.voicemailId && <div className="mt-1"><VoicemailPlayer voicemailId={call.voicemailId} compact /></div>}
                </>
              }
              actions={
                <DashboardRowActions
                  name={call.contactName}
                  primary={<Button type="button" variant="outline" size="sm" onClick={() => handleCallBack(call)}
                    className="h-9 rounded-lg px-3" aria-label={`Call back ${call.contactName}`}>Call Back</Button>}
                  items={[{
                    id: "view", label: "View contact", icon: ExternalLink, disabled: !href,
                    hint: href ? undefined : "No linked contact record is available",
                    onSelect: () => href && navigate(href),
                  }]}
                />
              }
            />
          );
        })}
      </DashboardList>
      {calls.length === PREVIEW_LIMIT && (
        <p className="text-xs text-muted-foreground">Latest {PREVIEW_LIMIT} missed calls. Open details for the last 24 hours.</p>
      )}
    </div>
  );
};

export default MissedCallsWidget;
