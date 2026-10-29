import React from "react";
import { CalendarDays, ExternalLink, Phone, PhoneMissed, ShieldCheck, TrendingUp, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { DashboardIconWell, DashboardListRow, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions } from "@/components/dashboard/ui/DashboardRowActions";
import { DASHBOARD_TONES, NEUTRAL_PILL, type DashboardTone } from "@/components/dashboard/ui/dashboardTones";

import { recordText, type RecordType } from "@/components/dashboard/dashboardRecordText";

const ICONS: Record<RecordType, React.ElementType> = {
  calls_today: Phone, appointments: CalendarDays, policies_sold: ShieldCheck, premium_sold: TrendingUp, missed_calls: PhoneMissed,
};

export const DashboardRecordRow: React.FC<{
  type: RecordType;
  tone: DashboardTone;
  item: any;
  canOpen: boolean;
  onView: (item: any) => void;
  onCall: (event: React.MouseEvent, item: any) => void;
}> = ({ type, tone, item, canOpen, onView, onCall }) => {
  const { title, meta } = recordText(type, item);
  const isCall = type === "calls_today" || type === "missed_calls";
  const status =
    type === "missed_calls" ? (
      <DashboardStatusPill className={DASHBOARD_TONES.red.pill}>{describeInboundCallOutcome(item).label}</DashboardStatusPill>
    ) : type === "appointments" && item.status ? (
      <DashboardStatusPill className={item.status === "Scheduled" ? DASHBOARD_TONES.purple.pill : NEUTRAL_PILL}>{item.status}</DashboardStatusPill>
    ) : null;

  const viewLabel = type === "appointments" ? "Open in Calendar" : type === "policies_sold" || type === "premium_sold" ? "View client" : "View contact";
  const primary = isCall ? (
    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg" disabled={!canOpen}
      onClick={(event) => onCall(event, item)} aria-label={`${type === "missed_calls" ? "Call back" : "Call"} ${title}`}>
      <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {type === "missed_calls" ? "Call back" : "Call"}
    </Button>
  ) : (
    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg"
      disabled={type !== "appointments" && !canOpen} onClick={() => onView(item)} aria-label={`${viewLabel}: ${title}`}>
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> {type === "appointments" ? "Calendar" : "View"}
    </Button>
  );

  return (
    <DashboardListRow
      tone={tone}
      leading={<DashboardIconWell tone={tone} icon={isCall || type === "appointments" ? ICONS[type] : UserRound} />}
      title={title}
      meta={meta}
      status={status}
      detail={type === "missed_calls" && typeof item.voicemail_id === "string" && item.voicemail_id ? (
        // Inbound Calling v2 (corrective pass, defect 7): playback needs only the voicemail id — an
        // unlinked caller (no contact row) can still be listened to here.
        <div className="mt-1"><VoicemailPlayer voicemailId={item.voicemail_id} compact /></div>
      ) : undefined}
      actions={
        <DashboardRowActions
          name={title}
          primary={primary}
          items={isCall ? [{
            id: "view", label: "View contact", icon: ExternalLink, disabled: !canOpen,
            hint: canOpen ? undefined : item.__blockedReason ?? "No linked contact record is available",
            onSelect: () => onView(item),
          }] : []}
        />
      }
    />
  );
};
