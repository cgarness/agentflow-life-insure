import React from "react";
import { EyeOff, ExternalLink, Phone, Undo2, UserRound } from "lucide-react";
import type { CallbackBucket, NormalizedCallbackRow } from "@/lib/dashboard-callbacks";
import { personLabel, type PeopleLookup } from "@/lib/dashboard-people";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { unbreakable } from "@/components/dashboard/dashboardRecordText";
import { DashboardListRow, DashboardStatusBadge } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardRowActions } from "@/components/dashboard/ui/DashboardRowActions";
import { DashboardActionButton } from "@/components/dashboard/ui/DashboardActionButton";
import { DashboardPersonChip } from "@/components/dashboard/ui/DashboardPersonChip";
import type { DashboardStatusKey } from "@/components/dashboard/ui/dashboardTones";

const BUCKET_STATUS: Record<CallbackBucket, DashboardStatusKey> = { overdue: "overdue", dueToday: "dueToday", dueSoon: "upcoming" };

export interface CallbackRowHandlers {
  onCall: (row: NormalizedCallbackRow) => void;
  onView: (row: NormalizedCallbackRow) => void;
  onClear?: (row: NormalizedCallbackRow) => void;
  onUndo?: (row: NormalizedCallbackRow) => void;
}

const when = (iso: string, withDate: boolean) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date unavailable";
  return withDate
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/**
 * One callback, in the widget (`compact`) or the detail view. Call is the primary action; Clear
 * hides this occurrence from the viewer's own Dashboard (never "completed" — the callback stays
 * scheduled), and a cleared row offers Undo. View contact needs a resolved contact identity.
 */
export const CallbackRow: React.FC<{
  row: NormalizedCallbackRow;
  bucket: CallbackBucket;
  compact?: boolean;
  /** Owner chip and campaign names (an Admin's Team view). */
  team?: { people: PeopleLookup; campaigns: ReadonlyMap<string, string> } | null;
  /** Clear / Undo are available (clearances on, not View As). */
  clearable: boolean;
  busy: boolean;
  handlers: CallbackRowHandlers;
}> = ({ row, bucket, compact = false, team = null, clearable, busy, handlers }) => {
  const name = row.contactName || "Unknown contact";
  const campaign = row.campaignId ? team?.campaigns.get(row.campaignId) : undefined;
  const source = row.source === "campaign" ? (campaign ? `Campaign · ${campaign}` : "Campaign") : "Follow-up";
  const phone = row.phone ? unbreakable(formatPhoneNumber(row.phone)) : "";
  const cleared = row.clearance ?? null;
  const viewBlocked = row.contactId && row.contactType ? null : row.blockedReason ?? "No linked contact record is available";
  const meta = [when(row.dueAt, !compact), source, phone].filter(Boolean).join(" · ");

  const status = cleared ? (
    <DashboardStatusBadge status="cleared" label={`Cleared ${when(cleared.clearedAt, true)}`} />
  ) : (
    <DashboardStatusBadge status={BUCKET_STATUS[bucket]} />
  );

  return (
    <DashboardListRow
      tone="blue"
      testId="callback-row"
      leading={
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-xs font-semibold text-blue-700 dark:text-blue-300">
          {name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || <UserRound className="h-4 w-4" />}
        </span>
      }
      title={name}
      meta={meta}
      detail={
        <>
          {row.note && <p className="line-clamp-2 text-xs text-muted-foreground">{row.note}</p>}
          {team && <DashboardPersonChip role="Owner" name={personLabel(team.people, row.ownerId)} className="mt-1" />}
        </>
      }
      status={status}
      actions={
        <DashboardRowActions
          name={name}
          busy={busy}
          primary={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <DashboardActionButton variant="call" icon={Phone} label={`Call ${name}`} rowFocus
                blockedReason={row.canAct ? null : row.blockedReason ?? "This callback cannot be dialed."} onClick={() => handlers.onCall(row)}>
                Call
              </DashboardActionButton>
              {clearable && !cleared && handlers.onClear && (
                <DashboardActionButton variant="clear" icon={EyeOff} label={`Clear callback for ${name}`} busy={busy}
                  hint="Hides this callback from your Dashboard only. It stays scheduled and its due time doesn't change."
                  onClick={() => handlers.onClear?.(row)}>
                  Clear
                </DashboardActionButton>
              )}
              {clearable && cleared && handlers.onUndo && (
                <DashboardActionButton variant="secondary" icon={Undo2} label={`Undo clear for ${name}`} busy={busy}
                  onClick={() => handlers.onUndo?.(row)}>
                  Undo
                </DashboardActionButton>
              )}
              {!compact && (
                <DashboardActionButton variant="secondary" icon={ExternalLink} label={`View ${name}`}
                  blockedReason={viewBlocked} onClick={() => handlers.onView(row)}>
                  View
                </DashboardActionButton>
              )}
            </div>
          }
          items={compact ? [{
            id: "view", label: "View contact", icon: ExternalLink, disabled: !!viewBlocked,
            hint: viewBlocked ?? undefined, onSelect: () => handlers.onView(row),
          }] : []}
        />
      }
    />
  );
};
