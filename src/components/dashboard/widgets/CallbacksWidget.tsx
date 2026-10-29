import React, { useEffect } from "react";
import { AlertTriangle, Phone, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchQuickCall } from "@/lib/quick-call";
import type { NormalizedCallbackRow } from "@/lib/dashboard-callbacks";
import { ATTENTION_TYPE } from "@/lib/dashboard-callbacks";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { ATTENTION_CHANGED_EVENT } from "@/lib/dashboard-attention";
import { ATTENTION_CONFIG, type AttentionConfig } from "@/lib/dashboard-attention-config";
import { CALLBACK_BUCKETS, type CallbackWidgetData, loadCallbackWidget } from "@/lib/dashboard-widget-loads";
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
import { CallbackRow } from "@/components/dashboard/callbacks/CallbackRow";

interface CallbacksWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  /** Defaults to the signed-in profile's organization. */
  organizationId?: string | null;
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
  /** Opens the Callbacks detail view (decision D11), optionally on its Cleared view. */
  onOpenDetails?: (view?: "active" | "cleared") => void;
  /** Release switch; injectable for tests. */
  config?: AttentionConfig;
}

const GROUPS = [
  { bucket: "overdue", title: "Overdue", dot: "bg-red-500" },
  { bucket: "dueToday", title: "Due Today", dot: "bg-blue-500" },
  { bucket: "dueSoon", title: "Upcoming", dot: "bg-violet-500" },
] as const;

const CallbacksWidget: React.FC<CallbacksWidgetProps> = ({
  userId, role, adminToggle, organizationId, refreshSignal, refreshTracker, onOpenDetails, config = ATTENTION_CONFIG,
}) => {
  const navigate = useNavigate();
  const { profile, isImpersonating } = useAuth();
  const orgId = organizationId === undefined ? profile?.organization_id ?? null : organizationId;
  // Existing Personal/Team gate (the list rule, plan §2A). No hierarchy expansion here.
  const isFiltered = listScopeIsFiltered(role, adminToggle);
  // Clear is per viewer; under View As nothing is cleared and nothing is excluded.
  const clearable = config.clearancesEnabled && !isImpersonating;

  // One load at a time. Another user's or perspective's callbacks are never shown;
  // a failed refresh keeps this perspective's last complete page and says so.
  const section = useDashboardSection<CallbackWidgetData>({
    section: "callbacks",
    userId,
    scope: `${isFiltered}|${clearable}|${orgId ?? "no-org"}`,
    load: (signal) => loadCallbackWidget({ userId, organizationId: orgId, isFiltered, clearancesEnabled: clearable, signal }),
    refreshSignal,
    refreshTracker,
  });
  // A Clear / Undo stored from the detail view reloads this list too (through the section lane).
  const reload = section.reload;
  useEffect(() => {
    window.addEventListener(ATTENTION_CHANGED_EVENT, reload);
    return () => window.removeEventListener(ATTENTION_CHANGED_EVENT, reload);
  }, [reload]);
  const actions = useAttentionClearActions("callback", () => {});
  const data = section.data;
  const shown = data ? GROUPS.flatMap(({ bucket }) => data.buckets[bucket].slice(0, 5)) : [];
  const focus = useRowFocusRecovery(shown.map((r) => r.key).join("|"));
  const notice = <DashboardSectionNotice state={section} label="callbacks" className="mb-3" />;
  const scopeNote = <DashboardScopeNote text={listScopeNote(role, adminToggle, "callbacks")} />;

  const handleCall = (item: NormalizedCallbackRow) => {
    if (!item.canAct || !item.contactId || !item.contactType) {
      toast.error(item.blockedReason ?? "This callback cannot be dialed.");
      return;
    }
    const started = dispatchQuickCall({ contactId: item.contactId, name: item.contactName, phone: item.phone, type: item.contactType });
    // Never report a call that did not start.
    if (!started) toast.error(`No phone number on file for ${item.contactName}.`);
  };
  const handlers = {
    onCall: handleCall,
    onView: (row: NormalizedCallbackRow) => {
      const href = contactHref(row.contactId, row.contactType);
      if (href) navigate(href);
    },
    onClear: (row: NormalizedCallbackRow) => {
      focus.remember(shown.findIndex((r) => r.key === row.key));
      void actions.clear({ key: row.key, sourceType: ATTENTION_TYPE[row.source], sourceId: row.sourceRowId, occurrenceAt: row.dueAt, name: row.contactName });
    },
  };

  if (section.loading) return <DashboardRowSkeleton />;

  if (section.data === null && section.offline) {
    return <DashboardSectionUnavailable state={section} label="callbacks" />;
  }

  // Rendered before the empty state on purpose: after a failed request the widget must
  // never claim "No pending callbacks".
  if (!data) {
    return (
      <div role="status" aria-live="polite" className="text-center py-10 flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-500" aria-hidden="true" />
        </div>
        <p className="text-sm text-foreground font-semibold">Couldn't load callbacks</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">Something went wrong. Your callbacks may still be there.</p>
        <Button variant="outline" size="sm" onClick={() => section.reload()} className="rounded-xl">
          <RotateCw className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }

  const summary = (
    <DashboardAttentionSummary
      activeText={`${data.totalCount} pending ${data.totalCount === 1 ? "callback" : "callbacks"}`}
      hiddenCount={clearable ? data.clearedCount : 0}
      hiddenWord="cleared"
      toneText={DASHBOARD_TONES.blue.text}
      onOpenHidden={onOpenDetails && (() => onOpenDetails("cleared"))}
    />
  );
  const team = isFiltered ? null : { people: data.people, campaigns: data.campaigns };

  return (
    <div ref={focus.containerRef} className="space-y-4 outline-none">
      {CALLBACK_BUCKETS.every((b) => data.buckets[b].length === 0) ? (
        <DashboardEmptyState tone="blue" icon={Phone} title="No pending callbacks"
          notice={<>{notice}{scopeNote}{data.clearedCount > 0 && clearable && <div className="mb-3 w-full">{summary}</div>}</>} />
      ) : (
        <>
          {notice}
          {scopeNote}
          {data.people.unavailable && team && <p className="text-xs text-muted-foreground">Some agent names couldn't be loaded.</p>}
          {summary}
          {GROUPS.map(({ bucket, title, dot }) => {
            const items = data.buckets[bucket];
            if (items.length === 0) return null;
            return (
              <div key={bucket}>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
                  {title} ({data.bucketCounts[bucket] ?? items.length})
                </p>
                <DashboardList label={`${title} callbacks`}>
                  {items.slice(0, 5).map((item) => (
                    <CallbackRow key={item.key} row={item} bucket={bucket} compact team={team} clearable={clearable}
                      busy={actions.busyKeys.has(item.key)} handlers={handlers} />
                  ))}
                </DashboardList>
              </div>
            );
          })}
          {data.totalCount > 5 && onOpenDetails && (
            <Button variant="ghost" size="sm" onClick={() => onOpenDetails()}
              className="w-full rounded-xl text-xs font-semibold text-blue-700 hover:bg-blue-500/10 focus-visible:ring-blue-500/60 dark:text-blue-300">
              View All {data.totalCount} Callbacks
            </Button>
          )}
        </>
      )}
    </div>
  );
};

export default CallbacksWidget;
