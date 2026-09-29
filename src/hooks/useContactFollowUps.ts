import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/tasksApi";
import type { ContactType } from "@/lib/dashboard-contact-identity";
import {
  buildContactFollowUps,
  summarizeFollowUps,
  type ContactFollowUp,
  type FollowUpSummary,
  type FollowUpTaskRow,
} from "@/lib/contactFollowUps";
import { fetchContactFollowUpRows } from "@/lib/contactFollowUpsQueries";

export const FOLLOW_UPS_REFETCH_INTERVAL_MS = 2 * 60 * 1000;
const NOW_TICK_MS = 60 * 1000;

export type FollowUpsState = "loading" | "error" | "ready";

export interface UseContactFollowUpsResult {
  state: FollowUpsState;
  items: ContactFollowUp[];
  summary: FollowUpSummary;
  /** A background refresh failed while earlier data is still shown. */
  refreshFailed: boolean;
  refetch: () => void;
}

/**
 * The Follow-ups card's data. Two queries:
 *  - `["contact-followups", org, type, id]`: appointments + campaign callbacks (own key, retry 1,
 *    2-minute refetch while the tab is visible);
 *  - `["tasks", id]`: the Tasks tab's OWN query (same key, queryFn and options), so its existing
 *    invalidations refresh the card. Nothing divergent is ever set on that shared key.
 *
 * Fails safely: with no data yet, an error from EITHER query is an error state — never a partial
 * list. A failed background refetch keeps the data already shown and flags it.
 */
export function useContactFollowUps(args: {
  contactId: string;
  contactType: ContactType;
  organizationId: string | null | undefined;
  refreshKey?: number;
}): UseContactFollowUpsResult {
  const { contactId, contactType, organizationId, refreshKey = 0 } = args;
  const enabled = !!contactId && !!organizationId;

  const queryClient = useQueryClient();
  const rowsKey = useMemo(
    () => ["contact-followups", organizationId, contactType, contactId] as const,
    [organizationId, contactType, contactId],
  );
  const rowsQuery = useQuery({
    queryKey: rowsKey,
    queryFn: ({ signal }) =>
      fetchContactFollowUpRows({ contactId, contactType, organizationId: organizationId as string, signal }),
    enabled,
    retry: 1,
    refetchInterval: FOLLOW_UPS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Identical to TasksPanel's query — shares its cache entry and invalidations.
  const tasksQuery = useQuery({
    queryKey: ["tasks", contactId],
    queryFn: () => tasksApi.getTasks(contactId, organizationId as string),
    enabled,
  });

  // After this page's own writes (Schedule), refetch both without dropping what is on screen.
  const lastRefreshKey = useRef(refreshKey);
  const { refetch: refetchRows } = rowsQuery;
  const { refetch: refetchTasks } = tasksQuery;
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    if (!enabled) return;
    void (async () => {
      // With no data yet, a refetch would join the first request, which started before the write.
      if (queryClient.getQueryData(rowsKey) === undefined) {
        await queryClient.cancelQueries({ queryKey: rowsKey, exact: true });
      }
      await refetchRows();
    })();
    void refetchTasks();
  }, [refreshKey, enabled, queryClient, rowsKey, refetchRows, refetchTasks]);

  // Overdue / in-progress flags follow the clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const hasData = rowsQuery.data !== undefined && tasksQuery.data !== undefined;
  const items = useMemo(() => {
    if (!hasData) return [];
    return buildContactFollowUps({
      contact: { id: contactId, type: contactType },
      appointments: rowsQuery.data!.appointments,
      campaign: rowsQuery.data!.campaign,
      tasks: (tasksQuery.data ?? []) as FollowUpTaskRow[],
      now,
    });
  }, [hasData, contactId, contactType, rowsQuery.data, tasksQuery.data, now]);

  const summary = useMemo(
    () => summarizeFollowUps(items, rowsQuery.data?.truncated ?? false),
    [items, rowsQuery.data?.truncated],
  );

  const anyError = rowsQuery.isError || tasksQuery.isError;
  const state: FollowUpsState = hasData ? "ready" : anyError ? "error" : "loading";

  return {
    state,
    items,
    summary,
    refreshFailed: hasData && anyError,
    refetch: () => {
      void refetchRows();
      void refetchTasks();
    },
  };
}
