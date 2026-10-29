import React, { useEffect, useState } from "react";
import { AlertTriangle, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { localCalendarDate } from "@/lib/calendar-date";
import { ANNIVERSARY_WIDGET_WINDOW_DAYS } from "@/lib/dashboard-milestones";
import { loadClientMilestones, type MilestoneLoad } from "@/lib/dashboard-milestones-data";
import { MILESTONE_CONFIG, type MilestoneConfig } from "@/lib/dashboard-milestones-config";
import { EMPTY_PEOPLE, personLabel, type PeopleLookup, resolvePeople } from "@/lib/dashboard-people";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { MILESTONES_CHANGED_EVENT, useMilestoneActions, useMilestoneContactHandlers } from "@/hooks/useMilestoneActions";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";
import { DashboardEmptyState, DashboardList, DashboardRowSkeleton } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { MilestoneRow, type MilestoneRowHandlers } from "@/components/dashboard/milestones/MilestoneRow";
import { MilestoneCategoryChips, type MilestoneCategoryFilter } from "@/components/dashboard/milestones/MilestoneCategoryChips";
import { milestoneCompletenessNote } from "@/components/dashboard/milestones/milestoneCopy";
import { DashboardAttentionSummary } from "@/components/dashboard/ui/DashboardAttentionSummary";
import { DASHBOARD_TONES } from "@/components/dashboard/ui/dashboardTones";

interface ClientMilestonesWidgetProps {
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  organizationId: string | null;
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
  /** Opens the detail view, optionally on its Dismissed history. */
  onOpenDetails?: (view?: "active" | "cleared") => void;
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
  const section = useDashboardSection<MilestoneLoad & { people: PeopleLookup }>({
    section: "anniversaries",
    userId,
    // A missing organization still loads, and fails closed in the loader (never an endless skeleton).
    scope: `${organizationId ?? "no-org"}|${isFiltered}|${today}|${config.reviewsEnabled}`,
    load: async (signal) => {
      const result = await loadClientMilestones({ userId, organizationId, isFiltered }, config, ANNIVERSARY_WIDGET_WINDOW_DAYS, signal);
      // Team view: each client's agent, presentation only (a failed lookup says "Name unavailable").
      const people = isFiltered ? EMPTY_PEOPLE : await resolvePeople(organizationId, result.items.map((i) => i.assignedAgentId), signal);
      return { ...result, people };
    },
    refreshSignal,
    refreshTracker,
  });
  // A review stored from the detail view reloads this list too (through the section lane).
  const reload = section.reload;
  useEffect(() => {
    window.addEventListener(MILESTONES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MILESTONES_CHANGED_EVENT, reload);
  }, [reload]);
  const actions = useMilestoneActions(() => {});
  const contact = useMilestoneContactHandlers();
  const reviewsEnabled = config.reviewsEnabled && !isImpersonating;
  const handlers: MilestoneRowHandlers = {
    ...contact,
    onDismiss: actions.dismiss,
    onRemindLater: actions.remindLater,
    onRestore: actions.restore,
  };

  const notice = <DashboardSectionNotice state={section} label="client milestones" className="mb-3" />;
  const scopeNote = <DashboardScopeNote text={listScopeNote(role, adminToggle, "client milestones")} />;

  if (section.loading) return <DashboardRowSkeleton />;
  if (section.data === null) return <DashboardSectionUnavailable state={section} label="client milestones" />;

  const load = section.data;
  const pending = load.items.filter((item) => item.status === "pending");
  const dismissed = load.items.filter((item) => item.status === "reviewed").length;
  const agentName = (item: (typeof pending)[number]) => (isFiltered ? undefined : personLabel(load.people, item.assignedAgentId));
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
          <Button variant="ghost" size="sm" onClick={() => onOpenDetails(dismissed > 0 && reviewsEnabled ? "cleared" : undefined)}
            className="rounded-xl text-xs font-semibold text-pink-700 hover:bg-pink-500/10 focus-visible:ring-pink-500/60 dark:text-pink-300">
            {dismissed > 0 && reviewsEnabled ? `View ${dismissed} dismissed` : "View all milestones"}
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
      <DashboardAttentionSummary
        activeText={`${pending.length}${load.complete ? "" : "+"} pending ${pending.length === 1 ? "milestone" : "milestones"}`}
        hiddenCount={reviewsEnabled ? dismissed : 0}
        hiddenWord="dismissed"
        toneText={DASHBOARD_TONES.pink.text}
        onOpenHidden={onOpenDetails && (() => onOpenDetails("cleared"))}
      />
      <MilestoneCategoryChips items={pending} value={filter} onChange={setFilter} complete={load.complete}
        firstPaymentsOn={config.firstPaymentStart !== null} />
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {load.complete ? "Nothing in this category right now." : "Nothing found in the clients read so far."}
        </p>
      ) : (
        <DashboardList label="Upcoming client milestones">
          {shown.slice(0, WIDGET_ROWS).map((item) => (
            <MilestoneRow key={item.key} item={item} reviewsEnabled={reviewsEnabled} busy={actions.busyKeys.has(item.key)} handlers={handlers}
              agentName={agentName(item)} />
          ))}
        </DashboardList>
      )}
      {onOpenDetails && (
        <Button variant="ghost" size="sm" onClick={() => onOpenDetails()}
          className="w-full rounded-xl text-xs font-semibold text-pink-700 hover:bg-pink-500/10 focus-visible:ring-pink-500/60 dark:text-pink-300">
          {shown.length > WIDGET_ROWS ? `View all ${shown.length} milestones` : "View all milestones"}
        </Button>
      )}
    </div>
  );
};

export default ClientMilestonesWidget;
