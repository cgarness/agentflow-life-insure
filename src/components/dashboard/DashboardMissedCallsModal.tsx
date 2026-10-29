import React from "react";
import { PhoneMissed } from "lucide-react";
import type { MissedCallItem } from "@/lib/dashboard-missed-calls";
import type { AttentionFeed, AttentionView } from "@/hooks/useAttentionDetailFeed";
import { AttentionModalLayout } from "@/components/dashboard/attention/AttentionModalLayout";
import { MissedCallRow, type MissedCallRowHandlers } from "@/components/dashboard/missed-calls/MissedCallRow";

interface Props {
  open: boolean;
  onClose: () => void;
  feed: AttentionFeed<MissedCallItem>;
  /** Clear / Undo and the Cleared view are available. */
  clearable: boolean;
  busyKeys: ReadonlySet<string>;
  handlers: MissedCallRowHandlers;
  /** Recipient names (an Admin's Team view). */
  team: boolean;
  scopeNote?: string | null;
  onViewChange: (view: AttentionView) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  listRef?: React.Ref<HTMLDivElement>;
}

const TESTS: Record<string, (row: MissedCallItem) => boolean> = {
  voicemail: (row) => !!row.voicemailId,
  linked: (row) => !!row.contactId,
  unlinked: (row) => !row.contactId,
};

/**
 * Missed Calls detail view: the shared missed-call contract's last 24 hours, paged 20 at a time with
 * the exact active total, and — when Clear is on — the viewer's Cleared calls with Undo. Clearing
 * never changes the call, its voicemail or any report. Presentation only.
 */
export default function DashboardMissedCallsModal({ feed, clearable, busyKeys, handlers, team, scopeNote = null, ...rest }: Props) {
  return (
    <AttentionModalLayout<MissedCallItem>
      {...rest}
      tone="red"
      icon={PhoneMissed}
      title="Missed Calls (Recent)"
      description="Last 24 hours"
      noun="missed calls"
      nounOne="missed call"
      feed={feed}
      scopeNote={scopeNote}
      clearable={clearable}
      clearedNote="Cleared missed calls are hidden from your Dashboard only. The call, its voicemail and reports are unchanged."
      filters={(rows) => ({
        chips: [
          { id: "all", label: "All", count: rows.length },
          { id: "voicemail", label: "Voicemail", count: rows.filter(TESTS.voicemail).length },
          { id: "linked", label: "Linked contact", count: rows.filter(TESTS.linked).length },
          { id: "unlinked", label: "No contact", count: rows.filter(TESTS.unlinked).length },
        ],
        test: (filter, row) => filter === "all" || TESTS[filter](row),
      })}
      matches={(row, query) => [row.contactName, row.phone, row.outcome.label].some((value) => value.toLowerCase().includes(query))}
      keyOf={(row) => row.key}
      renderRow={(row) => (
        <MissedCallRow item={row} people={team ? feed.team.people : null} clearable={clearable}
          busy={busyKeys.has(row.key)} handlers={handlers} />
      )}
    />
  );
}
