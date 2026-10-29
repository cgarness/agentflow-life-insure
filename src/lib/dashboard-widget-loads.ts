/**
 * Section loads of the Callbacks and Missed Calls widgets (Polish V2 plan §3.5–§3.7), kept out of
 * the components so they stay small. Each load runs under ONE cancellation and settles only after
 * every read it started has settled (AGENT_RULES #22 rev 1.3), so the section lane is never released
 * while a read is on the wire. Reads made after an earlier read of the same load returned re-check
 * that the tab is still visible and online (#23 rev 1.2).
 *
 * With clearances off, the callback reads are exactly the shared contract's page + total, and no
 * clearance is read.
 */
import {
  bucketCallback,
  type CallbackBucket,
  callbackWindow,
  fetchCallbackCounts,
  fetchCallbackPage,
  fetchCallbackTotal,
  type NormalizedCallbackRow,
} from "@/lib/dashboard-callbacks";
import { readOwnClearances } from "@/lib/dashboard-attention";
import { fetchMissedCallCounts, fetchMissedCallPage, type MissedCallItem, missedCallsSince } from "@/lib/dashboard-missed-calls";
import { EMPTY_PEOPLE, missedCallPeopleIds, type PeopleLookup, resolveCampaignNames, resolvePeople } from "@/lib/dashboard-people";
import { startOfLocalDayPlus } from "@/lib/local-calendar";
import { assertPageActive } from "@/lib/pageActivity";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";

/** Callback rows fetched per widget load. The displayed total comes from an exact count, not this. */
export const CALLBACK_WIDGET_PAGE_SIZE = 15;
/** Missed calls the widget shows; the detail view lists the last 24 hours. */
export const MISSED_CALL_PREVIEW = 5;

export interface AttentionWidgetScope {
  userId: string;
  organizationId: string | null;
  /** Own items only (the list rule). `false` = an Admin's Team view, where owner names are shown. */
  isFiltered: boolean;
  clearancesEnabled: boolean;
  signal: AbortSignal;
}

export const CALLBACK_BUCKETS: CallbackBucket[] = ["overdue", "dueToday", "dueSoon"];

export interface CallbackWidgetData {
  buckets: Record<CallbackBucket, NormalizedCallbackRow[]>;
  /** Header count per bucket: exact ("3"), a lower bound ("15+"), or `null` (not known: not shown). */
  bucketCounts: Record<CallbackBucket, string | null>;
  /** Exact active (not cleared) total. */
  totalCount: number;
  clearedCount: number;
  people: PeopleLookup;
  campaigns: ReadonlyMap<string, string>;
}

/**
 * Bucket header counts from the globally ordered page, with no extra query: rows are ordered by due
 * time, so when the page holds every active row all counts are exact; otherwise every bucket before
 * the last row's bucket is exact, the last row's bucket is a lower bound, and later ones are unknown.
 */
export function callbackBucketCounts(
  buckets: Record<CallbackBucket, NormalizedCallbackRow[]>,
  loaded: number,
  total: number,
): Record<CallbackBucket, string | null> {
  const counts = { overdue: null, dueToday: null, dueSoon: null } as Record<CallbackBucket, string | null>;
  if (loaded >= total) {
    for (const b of CALLBACK_BUCKETS) counts[b] = String(buckets[b].length);
    return counts;
  }
  const lastIndex = Math.max(...CALLBACK_BUCKETS.map((b, i) => (buckets[b].length > 0 ? i : -1)));
  CALLBACK_BUCKETS.forEach((b, i) => {
    if (i < lastIndex) counts[b] = String(buckets[b].length);
    else if (i === lastIndex) counts[b] = `${buckets[b].length}+`;
  });
  return counts;
}

/** One complete callback widget load; throws on any failed read (never a partial page or count). */
export async function loadCallbackWidget(scope: AttentionWidgetScope): Promise<CallbackWidgetData> {
  // Page, total and every follow-on read share one cancellation: either failing cancels the rest,
  // and the load settles only once every read has.
  const cancel = linkedAbort(scope.signal);
  try {
    const reference = new Date();
    const base = { isFiltered: scope.isFiltered, userId: scope.userId, reference, signal: cancel.signal };
    const { startIso, endIso } = callbackWindow(base);
    const exclusions = scope.clearancesEnabled
      ? await readOwnClearances({
          userId: scope.userId, organizationId: scope.organizationId,
          sourceTypes: ["campaign_callback", "appointment_callback"], fromIso: startIso, toIso: endIso, signal: cancel.signal,
        })
      : undefined;
    if (exclusions) assertPageActive();
    const opts = { ...base, exclusions };
    // Rows and total come from the SAME shared contract, so "View All N" can never describe a
    // different set from the rows on screen — cleared callbacks are excluded from both.
    const [rows, counts] = await settleAll(
      [
        fetchCallbackPage({ ...opts, pageSize: CALLBACK_WIDGET_PAGE_SIZE }),
        exclusions ? fetchCallbackCounts(opts) : fetchCallbackTotal(opts).then((active) => ({ active, cleared: 0 })),
      ] as const,
      cancel.abort,
    );

    // Calendar-constructed local midnight — DST-safe across 2026-03-08 / 2026-11-01.
    const now = new Date();
    const todayEndExclusive = startOfLocalDayPlus(now, 1);
    const buckets: Record<CallbackBucket, NormalizedCallbackRow[]> = { overdue: [], dueToday: [], dueSoon: [] };
    for (const row of rows) buckets[bucketCallback(row, now, todayEndExclusive)].push(row);

    // Team context (an Admin's Team view only): owner and campaign names, presentation only.
    const [people, campaigns] = scope.isFiltered || rows.length === 0
      ? [EMPTY_PEOPLE, new Map<string, string>()]
      : await settleAll(
          [
            resolvePeople(scope.organizationId, rows.map((r) => r.ownerId), cancel.signal),
            resolveCampaignNames(scope.organizationId, rows.map((r) => r.campaignId), cancel.signal),
          ] as const,
          cancel.abort,
        );
    return {
      buckets,
      bucketCounts: callbackBucketCounts(buckets, rows.length, counts.active),
      totalCount: counts.active,
      clearedCount: counts.cleared,
      people,
      campaigns,
    };
  } finally {
    cancel.dispose();
  }
}

export interface MissedCallWidgetData {
  items: MissedCallItem[];
  /** Exact active (not cleared) missed calls in the last 24 hours. */
  totalCount: number;
  clearedCount: number;
  people: PeopleLookup;
}

/** The newest missed calls (24 h) with the exact active total; throws on any failed read. */
export async function loadMissedCallWidget(scope: AttentionWidgetScope): Promise<MissedCallWidgetData> {
  const cancel = linkedAbort(scope.signal);
  try {
    const since = missedCallsSince();
    const base = { userId: scope.userId, organizationId: scope.organizationId, isFiltered: scope.isFiltered, since, signal: cancel.signal };
    const exclusions = scope.clearancesEnabled
      ? await readOwnClearances({ userId: scope.userId, organizationId: scope.organizationId, sourceTypes: ["missed_call"], fromIso: since, signal: cancel.signal })
      : undefined;
    if (exclusions) assertPageActive();
    // One row more than shown: when the active list fits, its length IS the exact total (no count).
    const fetched = await fetchMissedCallPage({ ...base, exclusions, pageSize: MISSED_CALL_PREVIEW + 1 });
    const items = fetched.slice(0, MISSED_CALL_PREVIEW);
    let totalCount = fetched.length;
    let clearedCount = 0;
    if (fetched.length > MISSED_CALL_PREVIEW || (exclusions && !exclusions.isEmpty)) {
      assertPageActive();
      const counts = await fetchMissedCallCounts({ ...base, exclusions });
      totalCount = fetched.length > MISSED_CALL_PREVIEW ? counts.active : fetched.length;
      clearedCount = counts.cleared;
    }
    const people = scope.isFiltered || items.length === 0
      ? EMPTY_PEOPLE
      : await resolvePeople(scope.organizationId, items.flatMap(missedCallPeopleIds), cancel.signal);
    return { items, totalCount, clearedCount, people };
  } finally {
    cancel.dispose();
  }
}
