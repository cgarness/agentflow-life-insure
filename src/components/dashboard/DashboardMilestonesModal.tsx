import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { ANNIVERSARY_DETAIL_WINDOW_DAYS, BIRTHDAY_WINDOW_DAYS, type MilestoneStatus } from "@/lib/dashboard-milestones";
import { loadClientMilestones, type MilestoneLoad } from "@/lib/dashboard-milestones-data";
import { MILESTONE_CONFIG, type MilestoneConfig } from "@/lib/dashboard-milestones-config";
import { listScopeIsFiltered, listScopeNote } from "@/lib/dashboard-scope";
import { useMilestoneActions, useMilestoneContactHandlers } from "@/hooks/useMilestoneActions";
import { DashboardModalEmpty, DashboardModalError, DashboardModalLoading, DashboardModalShell } from "@/components/dashboard/ui/DashboardModalShell";
import { DashboardFilterChips, DashboardSearchInput } from "@/components/dashboard/ui/DashboardFilterChips";
import { DashboardList } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { MilestoneRow } from "@/components/dashboard/milestones/MilestoneRow";
import { MilestoneCategoryChips, type MilestoneCategoryFilter } from "@/components/dashboard/milestones/MilestoneCategoryChips";
import { milestoneCompletenessNote } from "@/components/dashboard/milestones/milestoneCopy";

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  role: string;
  adminToggle: "team" | "my";
  organizationId: string | null;
  config?: MilestoneConfig;
}

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; load: MilestoneLoad };

/**
 * Client Milestones detail (plan §6.4): birthdays 14 days, anniversaries 90 days,
 * first payments from 3 days before the Draft Date until reviewed. One complete load
 * (no pagination, as before); the widget's scope rule (opened from the widget, §2A).
 */
const DashboardMilestonesModal: React.FC<Props> = ({ open, onClose, userId, role, adminToggle, organizationId, config = MILESTONE_CONFIG }) => {
  const { isImpersonating } = useAuth();
  const isFiltered = listScopeIsFiltered(role, adminToggle);
  const [state, setState] = useState<State>({ status: "loading" });
  const [category, setCategory] = useState<MilestoneCategoryFilter>("all");
  const [status, setStatus] = useState<MilestoneStatus>("pending");
  const [search, setSearch] = useState("");
  const generation = useRef(0);

  const load = useCallback((keepRows: boolean) => {
    const mine = ++generation.current;
    const controller = new AbortController();
    if (!keepRows) setState({ status: "loading" });
    loadClientMilestones({ userId, organizationId, isFiltered }, config, ANNIVERSARY_DETAIL_WINDOW_DAYS, controller.signal)
      .then((result) => { if (mine === generation.current) setState({ status: "ready", load: result }); })
      .catch((err) => {
        console.error("[ClientMilestones] Failed to load milestone details:", err);
        if (mine === generation.current) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [userId, organizationId, isFiltered, config]);

  useEffect(() => {
    if (!open) return;
    setCategory("all"); setStatus("pending"); setSearch("");
    const cancel = load(false);
    return () => { generation.current += 1; cancel(); };
  }, [open, load]);

  const actions = useMilestoneActions(() => { load(true); });
  const contact = useMilestoneContactHandlers();
  const reviewsEnabled = config.reviewsEnabled && !isImpersonating;
  const handlers = { ...contact, onMarkReviewed: actions.markReviewed, onRemindLater: actions.remindLater, onRestore: actions.restore };

  const items = state.status === "ready" ? state.load.items : [];
  const byStatus = items.filter((item) => item.status === status);
  const query = search.trim().toLowerCase();
  const visible = byStatus.filter((item) =>
    (category === "all" || item.kind === category) && (!query || item.clientName.toLowerCase().includes(query)));
  const complete = state.status === "ready" ? state.load.complete : true;
  const completeness = state.status === "ready" ? milestoneCompletenessNote(state.load) : null;
  const firstPaymentsOn = config.firstPaymentStart !== null;

  return (
    <DashboardModalShell
      open={open}
      onClose={onClose}
      tone="pink"
      icon={Gift}
      title="Client Milestones"
      description={`Birthdays: next ${BIRTHDAY_WINDOW_DAYS} days · Anniversaries: next ${ANNIVERSARY_DETAIL_WINDOW_DAYS} days${firstPaymentsOn ? " · First payments: from 3 days before the Draft Date until reviewed" : ""}`}
      toolbar={
        <>
          <DashboardScopeNote text={listScopeNote(role, adminToggle, "client milestones")} />
          {completeness && (
            <p role="status" className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {completeness}
            </p>
          )}
          {state.status === "ready" && state.load.malformedPolicyClients > 0 && (
            <p className="text-xs text-muted-foreground">
              {state.load.malformedPolicyClients} {state.load.malformedPolicyClients === 1 ? "client has" : "clients have"} additional-policy data that couldn't be read.
            </p>
          )}
          {reviewsEnabled && (
            <DashboardFilterChips<MilestoneStatus> label="Milestone status" value={status} onChange={setStatus} chips={[
              { id: "pending", label: "Pending", count: items.filter((i) => i.status === "pending").length },
              { id: "snoozed", label: "Snoozed", count: items.filter((i) => i.status === "snoozed").length },
              { id: "reviewed", label: "Reviewed", count: items.filter((i) => i.status === "reviewed").length },
            ]} />
          )}
          <MilestoneCategoryChips items={byStatus} value={category} onChange={setCategory} complete={complete} firstPaymentsOn={firstPaymentsOn} />
          <DashboardSearchInput label="Search client milestones" value={search} onChange={setSearch} />
        </>
      }
      footer={
        <>
          <span className="text-xs text-muted-foreground">Showing {visible.length} of {byStatus.length}{complete ? "" : "+"}</span>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-lg">Close</Button>
        </>
      }
    >
      {state.status === "loading" ? (
        <DashboardModalLoading />
      ) : state.status === "failed" ? (
        <DashboardModalError onRetry={() => load(false)} />
      ) : visible.length > 0 ? (
        <DashboardList label="Client milestones">
          {visible.map((item) => (
            <MilestoneRow key={item.key} item={item} reviewsEnabled={reviewsEnabled} busy={actions.busyKeys.has(item.key)} handlers={handlers} />
          ))}
        </DashboardList>
      ) : (
        <DashboardModalEmpty
          message={byStatus.length === 0 ? (complete ? "No client milestones here" : "Nothing found in the clients read so far") : "No matches."}
          hint={status === "pending" && byStatus.length === 0 ? "Birthdays appear for clients with a date of birth on file." : undefined}
        />
      )}
    </DashboardModalShell>
  );
};

export default DashboardMilestonesModal;
