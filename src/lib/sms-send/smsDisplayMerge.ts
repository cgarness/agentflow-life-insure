import {
  buildSmsItem,
  type ConversationItem,
  type SmsConversationItem,
} from "@/components/contacts/conversation-history/conversationTypes";
import type { CanonicalSmsRow } from "./smsSendResult";
import type { PendingSmsRecord, PendingSmsState } from "./pendingSmsStore";

/**
 * Pure merges of pending sends into a surface's saved history.
 *
 * A pending send is matched to a saved row ONLY by the receipt's `message_id`. Saved rows are never
 * hidden or inferred from body, phone, time, actor or a snapshot of loaded IDs: a row that arrives
 * from another tab, a refresh or pagination before this send's receipt simply shows, and the pending
 * item stays beside it until the receipt names it.
 */

export interface PendingSmsView {
  localId: string;
  state: PendingSmsState;
  slow: boolean;
  message: string | null;
  reconcile: PendingSmsRecord["reconcile"];
}

export interface Merged<T> {
  items: T[];
  /** Records whose saved row the surface's own list now contains. */
  observed: string[];
}

export function pendingView(r: PendingSmsRecord): PendingSmsView {
  return { localId: r.localId, state: r.state, slow: r.slow, message: r.message, reconcile: r.reconcile };
}

function rowTime(row: CanonicalSmsRow): number {
  const t = new Date(row.sent_at || row.created_at || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Stable insertion into an ascending list: equal times keep list order, extras go after them. */
function insertByTime<T>(list: T[], extra: T[], time: (item: T) => number): T[] {
  if (!extra.length) return list;
  const out = [...list];
  for (const item of [...extra].sort((a, b) => time(a) - time(b))) {
    let i = out.length;
    while (i > 0 && time(out[i - 1]) > time(item)) i -= 1;
    out.splice(i, 0, item);
  }
  return out;
}

type ThreadRow = Record<string, unknown>;

/** The saved row in `getConversationThread`'s shape. */
export function canonicalThreadRow(row: CanonicalSmsRow): ThreadRow {
  return { ...row, type: "sms", _ts: rowTime(row), description: row.body };
}

/**
 * Conversations thread. When the list and the targeted read both hold the saved row, the row from
 * the read that STARTED later wins (`listReadSeq` vs the canonical read's sequence).
 */
export function mergeThreadRows(
  rows: ThreadRow[],
  listReadSeq: number,
  records: readonly PendingSmsRecord[],
): Merged<ThreadRow> {
  const index = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row.type === "sms" && typeof row.id === "string") index.set(row.id, i);
  });
  let base = rows;
  const overlays: ThreadRow[] = [];
  const overlaid = new Set<string>();
  const pending: ThreadRow[] = [];
  const observed: string[] = [];
  for (const r of records) {
    const at = r.receipt ? index.get(r.receipt.messageId) : undefined;
    if (at !== undefined) {
      observed.push(r.localId);
      if (r.canonical && r.canonical.readSeq > listReadSeq) {
        if (base === rows) base = [...rows];
        base[at] = canonicalThreadRow(r.canonical.row);
      }
      continue;
    }
    // One saved row is shown once, whichever record carries it.
    if (r.receipt && overlaid.has(r.receipt.messageId)) continue;
    if (r.canonical) {
      overlays.push(canonicalThreadRow(r.canonical.row));
      overlaid.add(r.canonical.row.id);
    } else if (!r.hidden) {
      pending.push({
        id: `pending:${r.localId}`,
        type: "pending_sms",
        direction: "outbound",
        body: r.snapshot.body,
        _ts: r.createdAt,
        pending: pendingView(r),
      });
    }
  }
  const items = insertByTime(base, overlays, (row) => Number(row._ts) || 0);
  return { items: pending.length ? [...items, ...pending] : items, observed };
}

/**
 * Contact record timeline (ascending). The history feed carries no read sequence, so a feed row
 * that holds the receipt's `message_id` wins; outbound `messages` rows are not modified after insert
 * by any current path, so both reads carry the same content.
 */
export function mergeTimelineItems(
  items: ConversationItem[],
  records: readonly PendingSmsRecord[],
): Merged<ConversationItem> {
  const saved = new Set<string>();
  for (const item of items) if (item.kind === "sms") saved.add(item.id);
  const overlays: ConversationItem[] = [];
  const overlaid = new Set<string>();
  const pending: SmsConversationItem[] = [];
  const observed: string[] = [];
  for (const r of records) {
    if (r.receipt && saved.has(r.receipt.messageId)) {
      observed.push(r.localId);
      continue;
    }
    // One saved row is shown once, whichever record carries it.
    if (r.receipt && overlaid.has(r.receipt.messageId)) continue;
    if (r.canonical) {
      overlays.push(buildSmsItem(r.canonical.row));
      overlaid.add(r.canonical.row.id);
    } else if (!r.hidden) {
      pending.push({
        kind: "sms",
        key: `pending:${r.localId}`,
        id: `pending:${r.localId}`,
        timestampMs: r.createdAt,
        timestampKnown: true,
        outbound: true,
        body: r.snapshot.body,
        // The server resolves the sender (agency fallback included); it is shown once saved.
        fromNumber: null,
        toNumber: r.snapshot.to,
        status: null,
        pending: pendingView(r),
      });
    }
  }
  const merged = insertByTime(items, overlays, (item) => item.timestampMs);
  return { items: pending.length ? [...merged, ...pending] : merged, observed };
}
