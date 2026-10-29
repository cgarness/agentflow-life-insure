import React, { useState } from "react";
import { AlertTriangle, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { localCalendarDate } from "@/lib/calendar-date";
import { ANNIVERSARY_WIDGET_WINDOW_DAYS } from "@/lib/dashboard-milestones";
import { loadClientMilestones, type MilestoneLoad } from "@/lib/dashboard-milestones-data";
import { MILESTONE_CONFIG, type MilestoneConfig } from "@/lib/dashboard-milestones-config";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { useMilestoneActions, useMilestoneContactHandlers } from "@/hooks/useMilestoneActions";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";
import { DashboardEmptyState, DashboardList, DashboardRowSkeleton } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { MilestoneRow, type MilestoneRowHandlers } from "@/components/dashboard/milestones/MilestoneRow";
import { MilestoneCategoryChips, type MilestoneCategoryFilter } from "@/components/dashboard/milestones/MilestoneCategoryChips";
import { milestoneCompletenessNote } from "@/components/dashboard/milestones/milestoneCopy";

interface ClientMilestonesWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  organizationId: string | null;
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
  onOpenDetails?: () => void;
  /** Release switches; injectable for tests. */
  config?: MilestoneConfig;
}

/** Pending milestones shown on the Dashboard; the detail view lists the rest. */
const WIDGET_ROWS = 6;

const ClientMilestonesWidget: React.FC<ClientMilestonesWidgetProps> = ({
  userId, role, adminToggle, organizationId, refreshSignal, refreshTracker, onOpenDetails, config = MILESTONE_CONFIG,
}) => {
  const { isImpersonating } = useAuth();
  const isFiltered = listScopeIsFiltered(role, adminToggle);
  const [filter, setFilter] = useState<MilestoneCategoryFilter>("all");
  // Today is part of the scope, so a load after midnight never keeps yesterday's windows.
  const today = localCalendarDate(new Date());
  // One load at a time; a failed refresh keeps this perspective's milestones and says so.
  const section = useDashboardSection<MilestoneLoad>({
    section: "anniversaries",
    userId,
    // A missing organization still loads, and fails closed in the loader (never an endless skeleton).
    scope: `${organizationId ?? "no-org"}|${isFiltered}|${today}|${config.reviewsEnabled}`,
    load: (signal) => loadClientMilestones({ userId, organizationId, isFiltered }, config, ANNIVERSARY_WIDGET_WINDOW_DAYS, signal),
    refreshSignal,
    refreshTracker,
  });
  const actions = useMilestoneActions(section.reload);
  const contact = useMilestoneContactHandlers();
  const reviewsEnabled = config.reviewsEnabled && !isImpersonating;
  const handlers: MilestoneRowHandlers = {
    ...contact,
    onMarkReviewed: actions.markReviewed,
    onRemindLater: actions.remindLater,
    onRestore: actions.restore,
  };

  const notice = <DashboardSectionNotice state={section} label="client milestones" className="mb-3" />;
  const scopeNote = <DashboardScopeNote text={listScopeNote(role, adminToggle, "client milestones")} />;

  if (section.loading) return <DashboardRowSkeleton />;
  if (section.data === null) return <DashboardSectionUnavailable state={section} label="client milestones" />;

  const load = section.data;
  const pending = load.items.filter((item) => item.status === "pending");
  const shown = pending.filter((item) => filter === "all" || item.kind === filter);
  const completeness = milestoneCompletenessNote(load);
  const dataNotes = (
    <>
      {completeness && (
        <p role="status" className="mb-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {completeness}
        </p>
      )}
      {load.malformedPolicyClients > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {load.malformedPolicyClients} {load.malformedPolicyClients === 1 ? "client has" : "clients have"} additional-policy data that couldn't be read.
        </p>
      )}
    </>
  );

  // The empty state only after a complete read: an incomplete one never claims "none".
  if (pending.length === 0 && load.complete) {
    return (
      <DashboardEmptyState
        tone="pink"
        icon={Gift}
        title="No upcoming client milestones"
        hint="Birthdays appear for clients with a date of birth on file."
        notice={<>{notice}{scopeNote}{dataNotes}</>}
        action={onOpenDetails && (
          <Button variant="ghost" size="sm" onClick={onOpenDetails} className="rounded-xl text-xs font-semibold text-pink-700 dark:text-pink-400">
            View all milestones
          </Button>
        )}
      />
    );
  }

  return (
    <div className="space-y-3">
      {notice}
      {scopeNote}
      {dataNotes}
      <MilestoneCategoryChips items={pending} value={filter} onChange={setFilter} complete={load.complete}
        firstPaymentsOn={config.firstPaymentStart !== null} />
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {load.complete ? "Nothing in this category right now." : "Nothing found in the clients read so far."}
        </p>
      ) : (
        <DashboardList label="Upcoming client milestones">
          {shown.slice(0, WIDGET_ROWS).map((item) => (
            <MilestoneRow key={item.key} item={item} reviewsEnabled={reviewsEnabled} busy={actions.busyKeys.has(item.key)} handlers={handlers} />
          ))}
        </DashboardList>
      )}
      {onOpenDetails && (
        <Button variant="ghost" size="sm" onClick={onOpenDetails}
          className="w-full rounded-xl text-xs font-bold uppercase tracking-widest text-pink-700 hover:bg-pink-500/5 dark:text-pink-400">
          {shown.length > WIDGET_ROWS ? `View all ${shown.length} milestones` : "View all milestones"}
        </Button>
      )}
    </div>
  );
};

export default ClientMilestonesWidget;
