import React from "react";
import { AlertTriangle, ExternalLink, Phone, RotateCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { dispatchQuickCall } from "@/lib/quick-call";
import {
  type CallbackBucket,
  type NormalizedCallbackRow,
  bucketCallback,
  fetchCallbackPage,
  fetchCallbackTotal,
} from "@/lib/dashboard-callbacks";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { startOfLocalDayPlus } from "@/lib/local-calendar";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";
import { DashboardEmptyState, DashboardIconWell, DashboardList, DashboardListRow, DashboardRowSkeleton } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions } from "@/components/dashboard/ui/DashboardRowActions";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";

interface CallbacksWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
  /** Opens the Callbacks detail view (decision D11). */
  onOpenDetails?: () => void;
}

/** Rows fetched per render. The displayed total comes from an exact count, not this. */
const PAGE_SIZE = 15;

type CallbackBuckets = Record<CallbackBucket, NormalizedCallbackRow[]> & { totalCount: number };

/** One complete page + exact total from the shared contract; throws on any failure. */
async function loadCallbacks(userId: string, isFiltered: boolean, signal: AbortSignal): Promise<CallbackBuckets> {
  // Page and total share one cancellation: either failing cancels the other, and the
  // load settles only once every read of both has — so the section's lane is never
  // released while callback reads are still on the wire.
  const cancel = linkedAbort(signal);
  try {
    // Rows and total come from the SAME shared contract, so the "View All N" label
    // can never describe a different set from the rows on screen.
    const scope = { isFiltered, userId, signal: cancel.signal };
    const [rows, total] = await settleAll(
      [fetchCallbackPage({ ...scope, pageSize: PAGE_SIZE }), fetchCallbackTotal(scope)] as const,
      cancel.abort,
    );

    // Calendar-constructed local midnight — DST-safe across 2026-03-08 / 2026-11-01.
    const now = new Date();
    const todayEndExclusive = startOfLocalDayPlus(now, 1);

    const buckets: CallbackBuckets = { overdue: [], dueToday: [], dueSoon: [], totalCount: total };
    for (const row of rows) buckets[bucketCallback(row, now, todayEndExclusive)].push(row);
    return buckets;
  } catch (err) {
    // A returned query error is a FAILURE, not "no callbacks" (never a partial page).
    // Note the deliberate asymmetry: a SUCCESSFUL empty result never reaches here, so
    // a stale JWT role claim that makes campaign_leads RLS return zero rows still
    // reports "none found" (AGENT_RULES #19/#22), not an error.
    console.error("[CallbacksWidget] Failed to load callbacks:", err);
    throw err;
  } finally {
    cancel.dispose();
  }
}

const GROUPS: { bucket: CallbackBucket; title: string; dot: string }[] = [
  { bucket: "overdue", title: "Overdue", dot: "bg-red-500" },
  { bucket: "dueToday", title: "Due Today", dot: "bg-emerald-500" },
  { bucket: "dueSoon", title: "Due Soon", dot: "bg-blue-500" },
];

const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const CallbacksWidget: React.FC<CallbacksWidgetProps> = ({ userId, role, adminToggle, refreshSignal, refreshTracker, onOpenDetails }) => {
  const navigate = useNavigate();

  // Existing Personal/Team gate (the list rule, plan §2A). No hierarchy expansion here.
  const isFiltered = listScopeIsFiltered(role, adminToggle);

  // One load at a time. Another user's or perspective's callbacks are never shown;
  // a failed refresh keeps this perspective's last complete page and says so.
  const section = useDashboardSection<CallbackBuckets>({
    section: "callbacks",
    userId,
    scope: String(isFiltered),
    load: (signal) => loadCallbacks(userId, isFiltered, signal),
    refreshSignal,
    refreshTracker,
  });
  const totalCount = section.data?.totalCount ?? 0;
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

  if (section.loading) return <DashboardRowSkeleton />;

  if (section.data === null && section.offline) {
    return <DashboardSectionUnavailable state={section} label="callbacks" />;
  }

  // Rendered before the empty state on purpose: after a failed request the widget must
  // never claim "No pending callbacks".
  if (section.data === null) {
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

  const data = section.data;
  if (GROUPS.every(({ bucket }) => data[bucket].length === 0)) {
    return <DashboardEmptyState tone="blue" icon={Phone} title="No pending callbacks" notice={<>{notice}{scopeNote}</>} />;
  }

  return (
    <div className="space-y-4">
      {notice}
      {scopeNote}
      {GROUPS.map(({ bucket, title, dot }) => {
        const items = data[bucket];
        if (items.length === 0) return null;
        return (
          <div key={bucket}>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
              {title} ({items.length})
            </p>
            <DashboardList label={`${title} callbacks`}>
              {items.slice(0, 5).map((item) => {
                const href = contactHref(item.contactId, item.contactType);
                return (
                  <DashboardListRow
                    key={item.key}
                    tone="blue"
                    leading={<DashboardIconWell tone="blue" icon={UserRound} />}
                    title={item.contactName}
                    meta={`${formatTime(item.dueAt)} · ${item.source === "campaign" ? "Campaign" : "Follow-up"}${item.note ? ` · ${item.note}` : ""}`}
                    actions={
                      <DashboardRowActions
                        name={item.contactName}
                        primary={
                          <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg"
                            onClick={() => handleCall(item)} disabled={!item.canAct}
                            title={item.blockedReason ?? undefined} aria-label={`Call ${item.contactName}`}>
                            <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call
                          </Button>
                        }
                        items={[{
                          id: "view", label: "View contact", icon: ExternalLink, disabled: !href,
                          hint: href ? undefined : item.blockedReason ?? "No linked contact record is available",
                          onSelect: () => href && navigate(href),
                        }]}
                      />
                    }
                  />
                );
              })}
            </DashboardList>
          </div>
        );
      })}
      {totalCount > 5 && onOpenDetails && (
        <Button variant="ghost" size="sm" onClick={onOpenDetails}
          className="w-full text-blue-600 dark:text-blue-400 hover:bg-blue-500/5 rounded-xl text-xs font-bold uppercase tracking-widest">
          View All {totalCount} Callbacks
        </Button>
      )}
    </div>
  );
};

export default CallbacksWidget;
