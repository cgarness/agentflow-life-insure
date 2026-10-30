import React from "react";
import { CalendarClock } from "lucide-react";
import {
  bucketCallback,
  CALLBACK_LOOKAHEAD_DAYS,
  CALLBACK_LOOKBACK_DAYS,
  type CallbackBucket,
  type NormalizedCallbackRow,
} from "@/lib/dashboard-callbacks";
import { startOfLocalDayPlus } from "@/lib/local-calendar";
import type { AttentionFeed, AttentionView } from "@/hooks/useAttentionDetailFeed";
import { AttentionModalLayout } from "@/components/dashboard/attention/AttentionModalLayout";
import { CallbackRow, type CallbackRowHandlers } from "@/components/dashboard/callbacks/CallbackRow";

interface Props {
  open: boolean;
  onClose: () => void;
  feed: AttentionFeed<NormalizedCallbackRow>;
  /** Clear / Undo and the Cleared view are available. */
  clearable: boolean;
  busyKeys: ReadonlySet<string>;
  handlers: CallbackRowHandlers;
  /** Owner chips and campaign names (an Admin's Team view). */
  team: boolean;
  /** Whose callbacks these are, when the perspective suggests otherwise (plan §2A). */
  scopeNote?: string | null;
  onViewChange: (view: AttentionView) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  listRef?: React.Ref<HTMLDivElement>;
}

/**
 * Callbacks detail view: the shared callback contract's rows (both sources), paged 20 at a time
 * with the exact active total, and — when Clear is on — the viewer's Cleared callbacks with Undo.
 * Presentation only: the parent's feed owns every read.
 */
export default function DashboardCallbacksModal({ feed, clearable, busyKeys, handlers, team, scopeNote = null, ...rest }: Props) {
  const now = new Date();
  const todayEnd = startOfLocalDayPlus(now, 1);
  const bucketOf = (row: NormalizedCallbackRow): CallbackBucket => bucketCallback(row, now, todayEnd);
  return (
    <AttentionModalLayout<NormalizedCallbackRow>
      {...rest}
      tone="blue"
      icon={CalendarClock}
      title="Callbacks"
      description={`Past ${CALLBACK_LOOKBACK_DAYS} days through the next ${CALLBACK_LOOKAHEAD_DAYS} days`}
      noun="callbacks"
      nounOne="callback"
      feed={feed}
      scopeNote={scopeNote}
      clearable={clearable}
      clearedNote="Cleared callbacks are hidden from your Dashboard only. They stay scheduled, with the same due time and owner."
      filters={(rows) => {
        const count = (bucket: CallbackBucket) => rows.filter((row) => bucketOf(row) === bucket).length;
        return {
          chips: [
            { id: "all", label: "All", count: rows.length },
            { id: "overdue", label: "Overdue", count: count("overdue") },
            { id: "dueToday", label: "Today", count: count("dueToday") },
            { id: "dueSoon", label: "Upcoming", count: count("dueSoon") },
          ],
          test: (filter, row) => filter === "all" || bucketOf(row) === filter,
        };
      }}
      matches={(row, query) => [row.contactName, row.phone, row.note ?? ""].some((value) => value.toLowerCase().includes(query))}
      keyOf={(row) => row.key}
      renderRow={(row) => (
        <CallbackRow row={row} bucket={bucketOf(row)} team={team ? feed.team : null} clearable={clearable}
          busy={busyKeys.has(row.key)} handlers={handlers} />
      )}
    />
  );
}
