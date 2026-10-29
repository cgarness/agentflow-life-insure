import React from "react";
import { CalendarDays, ExternalLink, Phone, ShieldCheck, TrendingUp, UserRound } from "lucide-react";
import { personLabel, type PeopleLookup } from "@/lib/dashboard-people";
import { DashboardIconWell, DashboardListRow, DashboardStatusBadge, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions } from "@/components/dashboard/ui/DashboardRowActions";
import { DashboardActionButton } from "@/components/dashboard/ui/DashboardActionButton";
import { DashboardPersonChip } from "@/components/dashboard/ui/DashboardPersonChip";
import { NEUTRAL_PILL, type DashboardStatusKey, type DashboardTone } from "@/components/dashboard/ui/dashboardTones";

import { recordText, type RecordType } from "@/components/dashboard/dashboardRecordText";

const ICONS: Record<RecordType, React.ElementType> = {
  calls_today: Phone, appointments: CalendarDays, policies_sold: ShieldCheck, premium_sold: TrendingUp,
};

/** Appointment statuses with their shared badge (plan §4.1); anything else is a neutral pill. */
const APPOINTMENT_STATUS: Record<string, DashboardStatusKey> = {
  Scheduled: "scheduled", Confirmed: "confirmed", Completed: "completed", "No Show": "noShow", Cancelled: "cancelled",
};

/** A call's own telephony status, display only (never a "contacted" judgement). */
const callStatusText = (status: unknown) => (typeof status === "string" && status.trim() ? status.trim().replace(/-/g, " ") : null);

export const DashboardRecordRow: React.FC<{
  type: RecordType;
  tone: DashboardTone;
  item: any;
  canOpen: boolean;
  onView: (item: any) => void;
  onCall: (item: any) => void;
  /** Writing-agent names (policies / premium in a Team view); `null` = not shown. */
  people?: PeopleLookup | null;
}> = ({ type, tone, item, canOpen, onView, onCall, people = null }) => {
  const { title, meta } = recordText(type, item);
  const isCall = type === "calls_today";
  const appointmentStatus = type === "appointments" && item.status ? APPOINTMENT_STATUS[item.status] : undefined;
  const status =
    type === "appointments" && item.status ? (
      appointmentStatus ? <DashboardStatusBadge status={appointmentStatus} label={item.status} /> : <DashboardStatusPill className={NEUTRAL_PILL}>{item.status}</DashboardStatusPill>
    ) : isCall && callStatusText(item.status) ? (
      <DashboardStatusPill className={NEUTRAL_PILL}>{callStatusText(item.status)}</DashboardStatusPill>
    ) : null;

  const viewLabel = type === "appointments" ? "Open in Calendar" : type === "policies_sold" || type === "premium_sold" ? "View client" : "View contact";
  const blocked = canOpen ? null : item.__blockedReason ?? "No linked contact record is available";
  const primary = isCall ? (
    <DashboardActionButton variant="call" icon={Phone} label={`Call ${title}`} rowFocus blockedReason={blocked}
      onClick={() => onCall(item)}>
      Call
    </DashboardActionButton>
  ) : (
    <DashboardActionButton variant="secondary" icon={ExternalLink} label={`${viewLabel}: ${title}`} rowFocus
      blockedReason={type === "appointments" ? null : blocked} onClick={() => onView(item)}>
      {type === "appointments" ? "Calendar" : "View"}
    </DashboardActionButton>
  );

  return (
    <DashboardListRow
      tone={tone}
      leading={<DashboardIconWell tone={tone} icon={isCall || type === "appointments" ? ICONS[type] : UserRound} />}
      title={title}
      meta={meta}
      status={status}
      detail={people && item.agent_id ? <DashboardPersonChip role="Writing agent" name={personLabel(people, item.agent_id)} className="mt-1" /> : undefined}
      actions={
        <DashboardRowActions
          name={title}
          primary={primary}
          items={isCall ? [{
            id: "view", label: "View contact", icon: ExternalLink, disabled: !canOpen,
            hint: canOpen ? undefined : blocked ?? undefined,
            onSelect: () => onView(item),
          }] : []}
        />
      }
    />
  );
};
