/**
 * The Callbacks and Missed Calls detail views' reads (Polish V2 plan §3.5.5, §3.7), as feed sources
 * for `useAttentionDetailFeed`. They use the SAME contracts as the widgets (`dashboard-callbacks`,
 * `dashboard-missed-calls`), so a widget and its detail view describe one set; only page size
 * differs. Each load fixes its window once (when it reads the clearances), and every read of that
 * load — and the pages loaded after it — use that same window.
 */
import {
  callbackWindow,
  fetchCallbackCounts,
  fetchCallbackPage,
  fetchClearedCallbacks,
  type NormalizedCallbackRow,
} from "@/lib/dashboard-callbacks";
import { readOwnClearances } from "@/lib/dashboard-attention";
import {
  fetchClearedMissedCalls,
  fetchMissedCallCounts,
  fetchMissedCallPage,
  type MissedCallItem,
  missedCallsSince,
} from "@/lib/dashboard-missed-calls";
import { missedCallPeopleIds, resolveCampaignNames, resolvePeople } from "@/lib/dashboard-people";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";
import { type AttentionFeedSource, EMPTY_TEAM_CONTEXT } from "@/hooks/useAttentionDetailFeed";

export interface AttentionSourceScope {
  userId: string;
  organizationId: string | null;
  isFiltered: boolean;
  /** Clear is on and the viewer is not viewing as someone else. */
  clearable: boolean;
}

export function callbackFeedSource(scope: AttentionSourceScope): AttentionFeedSource<NormalizedCallbackRow> {
  let reference = new Date();
  const base = () => ({ isFiltered: scope.isFiltered, userId: scope.userId, reference });
  return {
    readExclusions: async (signal) => {
      reference = new Date();
      if (!scope.clearable) return undefined;
      const { startIso, endIso } = callbackWindow(base());
      return readOwnClearances({
        userId: scope.userId, organizationId: scope.organizationId,
        sourceTypes: ["campaign_callback", "appointment_callback"], fromIso: startIso, toIso: endIso, signal,
      });
    },
    page: (offset, pageSize, exclusions, signal) => fetchCallbackPage({ ...base(), offset, pageSize, exclusions, signal }),
    counts: (exclusions, signal) => fetchCallbackCounts({ ...base(), exclusions, signal }),
    cleared: (exclusions, signal) => fetchClearedCallbacks({ ...base(), exclusions, signal }),
    team: scope.isFiltered
      ? null
      : async (rows, signal) => {
          const cancel = linkedAbort(signal);
          try {
            const [people, campaigns] = await settleAll(
              [
                resolvePeople(scope.organizationId, rows.map((r) => r.ownerId), cancel.signal),
                resolveCampaignNames(scope.organizationId, rows.map((r) => r.campaignId), cancel.signal),
              ] as const,
              cancel.abort,
            );
            return { people, campaigns };
          } finally {
            cancel.dispose();
          }
        },
    keyOf: (row) => row.key,
  };
}

export function missedCallFeedSource(scope: AttentionSourceScope): AttentionFeedSource<MissedCallItem> {
  let since = missedCallsSince();
  const base = () => ({ userId: scope.userId, organizationId: scope.organizationId, isFiltered: scope.isFiltered, since });
  return {
    readExclusions: async (signal) => {
      since = missedCallsSince();
      if (!scope.clearable) return undefined;
      return readOwnClearances({
        userId: scope.userId, organizationId: scope.organizationId, sourceTypes: ["missed_call"], fromIso: since, signal,
      });
    },
    page: (offset, pageSize, exclusions, signal) => fetchMissedCallPage({ ...base(), offset, pageSize, exclusions, signal }),
    counts: (exclusions, signal) => fetchMissedCallCounts({ ...base(), exclusions, signal }),
    cleared: (exclusions, signal) => fetchClearedMissedCalls({ ...base(), exclusions, signal }),
    team: scope.isFiltered
      ? null
      : async (rows, signal) => ({
          ...EMPTY_TEAM_CONTEXT,
          people: await resolvePeople(scope.organizationId, rows.flatMap(missedCallPeopleIds), signal),
        }),
    keyOf: (row) => row.key,
  };
}
