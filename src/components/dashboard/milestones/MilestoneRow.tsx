import React from "react";
import { BellRing, CheckCircle2, ExternalLink, Phone, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Milestone } from "@/lib/dashboard-milestones";
import { REMIND_LATER_OPTIONS, type RemindLaterOption } from "@/lib/dashboard-milestones-data";
import { DashboardIconWell, DashboardListRow, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions, type RowMenuItem } from "@/components/dashboard/ui/DashboardRowActions";
import { DASHBOARD_TONES, NEUTRAL_PILL } from "@/components/dashboard/ui/dashboardTones";
import { MILESTONE_KINDS, milestoneDescription, milestoneStatusLabel } from "@/components/dashboard/milestones/milestoneCopy";

export interface MilestoneRowHandlers {
  onCall: (item: Milestone) => void;
  onView: (item: Milestone) => void;
  onMarkReviewed: (item: Milestone) => void;
  onRemindLater: (item: Milestone, option: RemindLaterOption) => void;
  onRestore: (item: Milestone) => void;
}

const REVIEW_HINT = "Only hides this reminder for you. The client record isn't changed.";

/**
 * One Client Milestone. Call is always visible; View contact, Mark reviewed,
 * Remind later and Restore live in the row's accessible menu. Review actions appear
 * only when reviews are live (G2) and never while viewing as another user.
 */
export const MilestoneRow: React.FC<{
  item: Milestone;
  reviewsEnabled: boolean;
  busy: boolean;
  handlers: MilestoneRowHandlers;
}> = ({ item, reviewsEnabled, busy, handlers }) => {
  const kind = MILESTONE_KINDS[item.kind];
  const blocked = item.actionBlockedReason;
  const items: RowMenuItem[] = [
    { id: "view", label: "View contact", icon: ExternalLink, onSelect: () => handlers.onView(item) },
  ];
  if (reviewsEnabled && item.status === "pending") {
    items.push(
      {
        id: "review", label: "Mark reviewed", icon: CheckCircle2, separated: true, disabled: !!blocked,
        hint: blocked ?? REVIEW_HINT, onSelect: () => handlers.onMarkReviewed(item),
      },
      {
        id: "remind", label: "Remind later", icon: BellRing, disabled: !!blocked, hint: blocked ?? undefined,
        items: REMIND_LATER_OPTIONS.map((option) => ({
          id: option.id, label: option.label, onSelect: () => handlers.onRemindLater(item, option.id),
        })),
      },
    );
  }
  if (reviewsEnabled && item.status !== "pending" && item.reviewId) {
    items.push({
      id: "restore", label: "Undo", icon: Undo2, separated: true, hint: "Show it again as pending.",
      onSelect: () => handlers.onRestore(item),
    });
  }

  const statusClass =
    item.status === "pending" && (item.daysUntil <= 1 || item.followUp) ? DASHBOARD_TONES.pink.pill : NEUTRAL_PILL;

  return (
    <DashboardListRow
      tone="pink"
      testId={`milestone-${item.kind}`}
      leading={<DashboardIconWell tone="pink" icon={kind.icon} label={kind.label} />}
      title={item.clientName}
      meta={milestoneDescription(item)}
      status={<DashboardStatusPill className={statusClass}>{milestoneStatusLabel(item)}</DashboardStatusPill>}
      actions={
        <DashboardRowActions
          name={item.clientName}
          busy={busy}
          menuLabel={kind.label}
          primary={
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg"
              onClick={() => handlers.onCall(item)} aria-label={`Call ${item.clientName}`}>
              <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call
            </Button>
          }
          items={items}
        />
      }
    />
  );
};
