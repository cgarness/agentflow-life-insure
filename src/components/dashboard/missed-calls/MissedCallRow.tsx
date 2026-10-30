import React from "react";
import { ExternalLink, EyeOff, Phone, PhoneForwarded, Undo2 } from "lucide-react";
import type { MissedCallItem } from "@/lib/dashboard-missed-calls";
import { contactHref } from "@/lib/dashboard-contact-identity";
import { describeMissedCallRecipients, personLabel, type PeopleLookup } from "@/lib/dashboard-people";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { unbreakable } from "@/components/dashboard/dashboardRecordText";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { DashboardIconWell, DashboardListRow, DashboardStatusBadge } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions } from "@/components/dashboard/ui/DashboardRowActions";
import { DashboardActionButton } from "@/components/dashboard/ui/DashboardActionButton";
import { DashboardPersonChip } from "@/components/dashboard/ui/DashboardPersonChip";
import { DASHBOARD_TONES } from "@/components/dashboard/ui/dashboardTones";

export interface MissedCallRowHandlers {
  onCallBack: (item: MissedCallItem) => void;
  onView: (item: MissedCallItem) => void;
  onClear?: (item: MissedCallItem) => void;
  onUndo?: (item: MissedCallItem) => void;
}

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The short badge: Missed, Voicemail, or Answered on mobile (after an AgentFlow miss, D13). */
function badgeFor(item: MissedCallItem) {
  if (item.clearance) return <DashboardStatusBadge status="cleared" label={`Cleared ${clock(item.clearance.clearedAt)}`} />;
  if (item.outcome.answeredOnMobile) return <DashboardStatusBadge status="answeredOnMobile" />;
  if (item.voicemailId) return <DashboardStatusBadge status="voicemail" />;
  return <DashboardStatusBadge status="missed" />;
}

/**
 * One missed inbound call, in the widget or the detail view. Call back needs a resolved
 * contact; Clear works for every call by its call id (an Unknown caller too) and only hides it from
 * the viewer's own Dashboard — the call, its voicemail and its reporting are never changed.
 */
export const MissedCallRow: React.FC<{
  item: MissedCallItem;
  /** Recipient names (an Admin's Team view). */
  people?: PeopleLookup | null;
  clearable: boolean;
  busy: boolean;
  handlers: MissedCallRowHandlers;
}> = ({ item, people = null, clearable, busy, handlers }) => {
  const known = item.contactName && item.contactName !== "Unknown";
  // An unlinked caller is titled by the number the call recorded.
  const title = known ? item.contactName : item.phone || "Unknown caller";
  const href = contactHref(item.contactId, item.contactType);
  const callBlocked = item.contactId && item.contactType ? null : "This call has no linked contact record — open it in Contacts to call back.";
  const meta = [timeAgo(item.createdAt), known && item.phone ? unbreakable(formatPhoneNumber(item.phone)) : known ? "" : "Unknown caller"]
    .filter(Boolean)
    .join(" · ");

  return (
    <DashboardListRow
      tone="red"
      testId="missed-call-row"
      leading={<DashboardIconWell tone="red" icon={PhoneForwarded} />}
      title={title}
      meta={meta}
      status={badgeFor(item)}
      detail={
        <>
          <p className={`text-xs font-medium ${DASHBOARD_TONES.red.text}`} data-testid="missed-call-outcome">{item.outcome.label}</p>
          {people && <p className="text-xs text-muted-foreground" data-testid="missed-call-recipients">{describeMissedCallRecipients(item, people)}</p>}
          {people && item.answered_by_agent_id && (
            <DashboardPersonChip role="Answered on mobile by" name={personLabel(people, item.answered_by_agent_id)} />
          )}
          {/* Playback needs only the voicemail id — an unlinked caller can still be listened to. */}
          {item.voicemailId && <div className="mt-1"><VoicemailPlayer voicemailId={item.voicemailId} compact /></div>}
        </>
      }
      actions={
        <DashboardRowActions
          name={title}
          busy={busy}
          primary={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <DashboardActionButton variant="call" icon={Phone} label={`Call back ${title}`} rowFocus
                blockedReason={callBlocked} onClick={() => handlers.onCallBack(item)}>
                Call back
              </DashboardActionButton>
              {clearable && !item.clearance && handlers.onClear && (
                <DashboardActionButton variant="clear" icon={EyeOff} label={`Clear missed call from ${title}`} busy={busy}
                  hint="Hides this missed call from your Dashboard only. The call, voicemail and reports aren't changed."
                  onClick={() => handlers.onClear?.(item)}>
                  Clear
                </DashboardActionButton>
              )}
              {clearable && item.clearance && handlers.onUndo && (
                <DashboardActionButton variant="secondary" icon={Undo2} label={`Undo clear for ${title}`} busy={busy}
                  onClick={() => handlers.onUndo?.(item)}>
                  Undo
                </DashboardActionButton>
              )}
            </div>
          }
          items={[{
            id: "view", label: "View contact", icon: ExternalLink, disabled: !href,
            hint: href ? undefined : "No linked contact record is available", onSelect: () => handlers.onView(item),
          }]}
        />
      }
    />
  );
};
