import React from "react";
import { BellRing, EyeOff, ExternalLink, Phone, Undo2 } from "lucide-react";
import type { Milestone } from "@/lib/dashboard-milestones";
import { REMIND_LATER_OPTIONS, type RemindLaterOption } from "@/lib/dashboard-milestones-data";
import { DashboardIconWell, DashboardListRow, DashboardStatusBadge, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions, type RowMenuItem } from "@/components/dashboard/ui/DashboardRowActions";
import { DashboardActionButton } from "@/components/dashboard/ui/DashboardActionButton";
import { DashboardPersonChip } from "@/components/dashboard/ui/DashboardPersonChip";
import { DASHBOARD_TONES, NEUTRAL_PILL, type DashboardStatusKey } from "@/components/dashboard/ui/dashboardTones";
import { MILESTONE_KINDS, milestoneDescription, milestoneStatusLabel } from "@/components/dashboard/milestones/milestoneCopy";

export interface MilestoneRowHandlers {
  onCall: (item: Milestone) => void;
  onView: (item: Milestone) => void;
  onDismiss: (item: Milestone) => void;
  onRemindLater: (item: Milestone, option: RemindLaterOption) => void;
  onRestore: (item: Milestone) => void;
}

const DISMISS_HINT = "Only hides this reminder for you. The client record isn't changed.";
const KIND_BADGE: Record<Milestone["kind"], DashboardStatusKey> = {
  client_birthday: "birthday", policy_anniversary: "anniversary", first_payment: "firstPayment",
};

/**
 * One Client Milestone. Call and Dismiss are always visible; Remind later and View contact live in
 * the row's accessible menu; a dismissed or snoozed one shows Undo. Dismiss / Remind later / Undo
 * appear only when reviews are live (G2) and never while viewing as another user. Dismiss is stored
 * as the existing "reviewed" state: an annual birthday or anniversary returns next year, a first
 * payment reminder stays dismissed.
 */
export const MilestoneRow: React.FC<{
  item: Milestone;
  reviewsEnabled: boolean;
  busy: boolean;
  handlers: MilestoneRowHandlers;
  /** The client's agent (an Admin's Team view); `undefined` = not shown. */
  agentName?: string;
}> = ({ item, reviewsEnabled, busy, handlers, agentName }) => {
  const kind = MILESTONE_KINDS[item.kind];
  const blocked = item.actionBlockedReason;
  const pending = item.status === "pending";
  const items: RowMenuItem[] = [];
  if (reviewsEnabled && pending) {
    items.push({
      id: "remind", label: "Remind later", icon: BellRing, disabled: !!blocked, hint: blocked ?? undefined,
      items: REMIND_LATER_OPTIONS.map((option) => ({
        id: option.id, label: option.label, onSelect: () => handlers.onRemindLater(item, option.id),
      })),
    });
  }
  items.push({ id: "view", label: "View contact", icon: ExternalLink, separated: items.length > 0, onSelect: () => handlers.onView(item) });

  const status = item.status === "reviewed"
    ? <DashboardStatusBadge status="dismissed" label={milestoneStatusLabel(item)} />
    : item.status === "snoozed" || item.followUp
      ? <DashboardStatusBadge status={item.followUp && pending ? "followUp" : "snoozed"} label={milestoneStatusLabel(item)} />
      : item.kind === "first_payment" && item.daysUntil < 0
        ? <DashboardStatusBadge status="needsReview" />
        : <DashboardStatusPill className={item.daysUntil <= 1 ? DASHBOARD_TONES.pink.pill : NEUTRAL_PILL}>{milestoneStatusLabel(item)}</DashboardStatusPill>;

  return (
    <DashboardListRow
      tone="pink"
      testId={`milestone-${item.kind}`}
      leading={<DashboardIconWell tone="pink" icon={kind.icon} label={kind.label} />}
      title={item.clientName}
      meta={milestoneDescription(item)}
      detail={agentName !== undefined ? <DashboardPersonChip role="Agent" name={agentName} className="mt-1" /> : undefined}
      status={<span className="flex flex-wrap items-center gap-1.5"><DashboardStatusBadge status={KIND_BADGE[item.kind]} label={kind.label} />{status}</span>}
      actions={
        <DashboardRowActions
          name={item.clientName}
          busy={busy}
          menuLabel={kind.label}
          primary={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <DashboardActionButton variant="call" icon={Phone} label={`Call ${item.clientName}`} rowFocus onClick={() => handlers.onCall(item)}>
                Call
              </DashboardActionButton>
              {reviewsEnabled && pending && (
                <DashboardActionButton variant="clear" icon={EyeOff} label={`Dismiss ${kind.label.toLowerCase()} for ${item.clientName}`}
                  busy={busy} blockedReason={blocked} hint={DISMISS_HINT} onClick={() => handlers.onDismiss(item)}>
                  Dismiss
                </DashboardActionButton>
              )}
              {reviewsEnabled && !pending && item.reviewId && (
                <DashboardActionButton variant="secondary" icon={Undo2} label={`Undo for ${item.clientName}`} busy={busy} hint="Show it again as pending."
                  onClick={() => handlers.onRestore(item)}>
                  Undo
                </DashboardActionButton>
              )}
            </div>
          }
          items={items}
        />
      }
    />
  );
};

