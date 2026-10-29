import React, { useEffect } from "react";
import { CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchQuickCall } from "@/lib/quick-call";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { ATTENTION_CHANGED_EVENT } from "@/lib/dashboard-attention";
import { ATTENTION_CONFIG, type AttentionConfig } from "@/lib/dashboard-attention-config";
import type { MissedCallItem } from "@/lib/dashboard-missed-calls";
import { loadMissedCallWidget, MISSED_CALL_PREVIEW, type MissedCallWidgetData } from "@/lib/dashboard-widget-loads";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { useAttentionClearActions } from "@/hooks/useAttentionClearActions";
import { useRowFocusRecovery } from "@/hooks/useRowFocusRecovery";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";
import { DashboardEmptyState, DashboardList, DashboardRowSkeleton } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { DashboardAttentionSummary } from "@/components/dashboard/ui/DashboardAttentionSummary";
import { DASHBOARD_TONES } from "@/components/dashboard/ui/dashboardTones";
import { MissedCallRow } from "@/components/dashboard/missed-calls/MissedCallRow";

interface MissedCallsWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  /** Defaults to the signed-in profile's organization. */
  organizationId?: string | null;
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
  /** Opens the Missed Calls detail view, optionally on its Cleared view. */
  onOpenDetails?: (view?: "active" | "cleared") => void;
  /** Release switch; injectable for tests. */
  config?: AttentionConfig;
}

const MissedCallsWidget: React.FC<MissedCallsWidgetProps> = ({
  userId, role, adminToggle, organizationId, refreshSignal, refreshTracker, onOpenDetails, config = ATTENTION_CONFIG,
}) => {
  const navigate = useNavigate();
  const { profile, isImpersonating } = useAuth();
  const orgId = organizationId === undefined ? profile?.organization_id ?? null : organizationId;
  const isFiltered = listScopeIsFiltered(role, adminToggle);
  // Clear is per viewer; under View As nothing is cleared and nothing is excluded.
  const clearable = config.clearancesEnabled && !isImpersonating;
  // One load at a time; a failed refresh keeps this perspective's list and says so.
  const section = useDashboardSection<MissedCallWidgetData>({
    section: "missed_calls",
    userId,
    scope: `${isFiltered}|${clearable}|${orgId ?? "no-org"}`,
    load: (signal) => loadMissedCallWidget({ userId, organizationId: orgId, isFiltered, clearancesEnabled: clearable, signal }),
    refreshSignal,
    refreshTracker,
  });
  // A Clear / Undo stored from the detail view reloads this list too (through the section lane).
  const reload = section.reload;
  useEffect(() => {
    window.addEventListener(ATTENTION_CHANGED_EVENT, reload);
    return () => window.removeEventListener(ATTENTION_CHANGED_EVENT, reload);
  }, [reload]);
  const actions = useAttentionClearActions("missed call", () => {});
  const data = section.data;
  const calls = data?.items ?? [];
  const focus = useRowFocusRecovery(calls.map((c) => c.key).join("|"));
  const notice = <DashboardSectionNotice state={section} label="missed calls" className="mb-3" />;
  const scopeNote = <DashboardScopeNote text={listScopeNote(role, adminToggle, "missed calls")} />;

  const handlers = {
    onCallBack: (item: MissedCallItem) => {
      if (!item.contactId || !item.contactType) {
        toast.error("This call has no linked contact record — open it in Contacts to call back.");
        return;
      }
      const started = dispatchQuickCall({ contactId: item.contactId, name: item.contactName, phone: item.phone, type: item.contactType });
      // Never report a call that did not start.
      if (!started) toast.error(`No phone number on file for ${item.contactName}.`);
    },
    onView: (item: MissedCallItem) => {
      const href = contactHref(item.contactId, item.contactType);
      if (href) navigate(href);
    },
    onClear: (item: MissedCallItem) => {
      focus.remember(calls.findIndex((c) => c.key === item.key));
      const name = item.contactName !== "Unknown" ? item.contactName : item.phone || "Unknown caller";
      void actions.clear({ key: item.key, sourceType: "missed_call", sourceId: item.id, occurrenceAt: item.createdAt, name });
    },
  };

  if (section.loading) return <DashboardRowSkeleton />;

  if (!data) return <DashboardSectionUnavailable state={section} label="missed calls" />;

  const summary = (
    <DashboardAttentionSummary
      activeText={`${data.totalCount} missed ${data.totalCount === 1 ? "call" : "calls"} in the last 24 hours`}
      hiddenCount={clearable ? data.clearedCount : 0}
      hiddenWord="cleared"
      toneText={DASHBOARD_TONES.red.text}
      onOpenHidden={onOpenDetails && (() => onOpenDetails("cleared"))}
    />
  );
  const people = isFiltered ? null : data.people;

  return (
    <div ref={focus.containerRef} className="space-y-3 outline-none">
      {calls.length === 0 ? (
        <DashboardEmptyState tone="green" icon={CheckCircle} title="All caught up!"
          notice={<>{notice}{scopeNote}{data.clearedCount > 0 && clearable && <div className="mb-3 w-full">{summary}</div>}</>} />
      ) : (
        <>
          {notice}
          {scopeNote}
          {people?.unavailable && <p className="text-xs text-muted-foreground">Some agent names couldn't be loaded.</p>}
          {summary}
          <DashboardList label="Missed calls">
            {calls.map((call) => (
              <MissedCallRow key={call.key} item={call} people={people} clearable={clearable}
                busy={actions.busyKeys.has(call.key)} handlers={handlers} />
            ))}
          </DashboardList>
          {data.totalCount > MISSED_CALL_PREVIEW && onOpenDetails && (
            <Button variant="ghost" size="sm" onClick={() => onOpenDetails()}
              className="w-full rounded-xl text-xs font-semibold text-red-700 hover:bg-red-500/10 focus-visible:ring-red-500/60 dark:text-red-300">
              View All {data.totalCount} Missed Calls
            </Button>
          )}
        </>
      )}
    </div>
  );
};

export default MissedCallsWidget;
