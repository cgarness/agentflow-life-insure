import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadPerformanceDetails, type PerformanceSummary } from "@/lib/performanceSummary";
import { buildMyMissedCallsOrFilter } from "@/lib/missedCallScope";
import { fetchCallbackPage, type NormalizedCallbackRow } from "@/lib/dashboard-callbacks";
import { periodBoundsIso } from "@/lib/dashboard-period-bounds";

/** Detail types this feed loads (Client Milestones load through their own data layer). */
export type DetailFeedType = "callbacks" | "appointments" | "calls_today" | "policies_sold" | "missed_calls" | "premium_sold";

export const DETAIL_BATCH_SIZE = 20;

interface DetailFeedOptions {
  /** `null` while the modal is closed or showing a type this feed does not load. */
  type: DetailFeedType | null;
  isOpen: boolean;
  userId: string;
  /** Own records only; the opener's scope (plan rev 1, §2A). */
  isFiltered: boolean;
  timeRange?: "day" | "week" | "month" | "year";
  adminToggle: "team" | "my";
  performanceSnapshot?: PerformanceSummary | null;
  organizationId?: string | null;
}

/**
 * The Dashboard detail feed: request generations, the pagination lock, page size 20,
 * the scroll trigger and the error states. Moved unchanged from
 * `DashboardDetailModal.tsx` (plan §8); only the anniversaries branch left, replaced by
 * the Client Milestones data layer.
 */
export function useDashboardDetailFeed({
  type, isOpen, userId, isFiltered, timeRange, adminToggle, performanceSnapshot, organizationId,
}: DetailFeedOptions) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  /** Initial-load failure — distinct from loading and from a valid empty result. */
  const [loadError, setLoadError] = useState(false);
  /** Pagination failure — rows already loaded stay, but we say more failed to load. */
  const [pageError, setPageError] = useState(false);
  /**
   * Request generation. Incremented by every NEW initial request and by effect cleanup,
   * so an older in-flight request can be recognised as stale and forbidden from writing
   * state. Pagination inherits the current generation without incrementing it, so a page
   * result belongs to the initial load it was requested under.
   */
  const requestGenerationRef = useRef(0);
  /**
   * Pagination in-flight lock, keyed by the generation that owns it.
   *
   * React state is NOT a synchronous lock: two scroll events in the same tick can both
   * observe `isFetchingNextPage === false` before a rerender, and both fire the same next
   * page. `isFetchingNextPage` remains the rendered UI state, but this ref is the actual
   * concurrency guard. `null` means no pagination request is in flight.
   */
  const paginationLockRef = useRef<{ generation: number; page: number } | null>(null);
  const performanceAsOf = useRef<string | null>(null);
  const [performanceSubtitle, setPerformanceSubtitle] = useState<string | null>(null);

  const fetchData = useCallback(async (pageNum: number, isInitial: boolean = false) => {
    if (!type || !userId || userId === "") return;

    if (isInitial) {
      // A new initial request invalidates every older request, initial or paginated, and
      // releases any pagination lock held by the previous generation.
      requestGenerationRef.current += 1;
      paginationLockRef.current = null;
    }

    const generation = requestGenerationRef.current;
    /** True once a newer request (or cleanup) has taken over. */
    const isStale = () => requestGenerationRef.current !== generation;

    if (isInitial) {
      // Clear the previous error whenever a new initial request begins.
      setLoadError(false);
      setPageError(false);
      setLoading(true);
      setData([]);
      performanceAsOf.current = performanceSnapshot?.end_at ?? new Date().toISOString();
      setPerformanceSubtitle(null);
    } else {
      // Ref-based serialization: at most one pagination request per generation.
      if (paginationLockRef.current !== null) return;
      paginationLockRef.current = { generation, page: pageNum };
      setPageError(false);
      setIsFetchingNextPage(true);
    }

    /** Only the request that acquired the lock, in the owning generation, may release it. */
    const releasePaginationLock = () => {
      const lock = paginationLockRef.current;
      if (!isInitial && lock && lock.generation === generation && lock.page === pageNum) {
        paginationLockRef.current = null;
      }
    };

    try {
      // Half-open [start, end) from the SHARED bounds module, so the tests assert the
      // shipped logic rather than a copy. Calendar-constructed, so boundaries stay at
      // local midnight across DST.
      //
      // NOTE: still BROWSER-local. Agency-timezone derivation is Build 2, not claimed here.
      const { startIso: startStr, endIso: endStr } = periodBoundsIso(
        new Date(),
        timeRange || "month",
      );
      const from = pageNum * DETAIL_BATCH_SIZE;
      const to = (pageNum + 1) * DETAIL_BATCH_SIZE - 1;

      let resultData: any[] = [];
      /** True once a non-callback query actually ran — preserves the old `if (query)` scoping. */
      let queryRan = false;

      if (["calls_today", "policies_sold", "premium_sold", "appointments"].includes(type)) {
        const detail = await loadPerformanceDetails(type, timeRange || "month", isFiltered ? "own" : "team",
          isFiltered ? userId : null, performanceAsOf.current!, from);
        if (isStale()) return;
        if (organizationId && detail.organization_id !== organizationId) throw new Error("Organization changed");
        setPerformanceSubtitle(detail.scope);
        const rows = detail.rows.map(row => ({ ...row, __idIsContact: false }));
        setHasMore(rows.length === DETAIL_BATCH_SIZE);
        if (isInitial) setData(rows); else setData(previous => [...previous, ...rows]);
        return;
      }

      // Callbacks: one shared contract with CallbacksWidget (dual-source, bounded,
      // globally ordered, per-source ownership). Paged globally after the merge.
      if (type === "callbacks") {
        const rows = await fetchCallbackPage({
          isFiltered,
          userId,
          pageSize: DETAIL_BATCH_SIZE,
          offset: pageNum * DETAIL_BATCH_SIZE,
        });
        if (isStale()) return;
        const mapped = rows.map((row: NormalizedCallbackRow) => ({
          __callback: true,
          // Dedicated RENDER identity, kept separate from contact identity. `row.key` is
          // source-qualified ("campaign:<id>" / "appointment:<id>"), so two callbacks for
          // the SAME contact still get distinct React keys. Using `contactId` here — as
          // this code previously did via the shared `id` field — collided them.
          __rowKey: row.key,
          __idIsContact: row.contactId !== null,
          __contactType: row.contactType,
          __canAct: row.canAct,
          __canOpen: Boolean(row.contactId && row.contactType),
          __blockedReason: row.blockedReason,
          id: row.contactId ?? row.key,   // never the source row id as a contact identity
          contact_id: row.contactId,
          contact_type: row.contactType,
          contact_name: row.contactName,
          phone: row.phone,
          start_time: row.dueAt,
          notes: row.note,
          type: row.source === "campaign" ? "Campaign callback" : "Callback",
        }));
        if (mapped.length < DETAIL_BATCH_SIZE) setHasMore(false);
        if (isInitial) setData(mapped);
        else setData((prev) => [...prev, ...mapped]);
        return;
      }

      let query: any;
      switch (type) {
        case "missed_calls": {
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          query = supabase.from("calls").select("id, contact_name, contact_id, contact_type, contact_phone, created_at, disposition_name, direction, is_missed, missed_reason, outcome, agent_id, answered_by_agent_id, voicemail_id").eq("direction", "inbound").eq("is_missed", true).gte("created_at", since24h).order("created_at", { ascending: false }).order("id", { ascending: false });
          if (isFiltered) {
            // D13 (§3.2): scope by intended recipient / snapshot / routed wave — `agent_id = me` never matches a missed row.
            const scope = buildMyMissedCallsOrFilter(userId);
            if (!scope) { query = null; break; }
            query = query.or(scope);
          }
          break;
        }
      }

      if (query) {
        const { data: result, error } = await query.range(from, to);
        if (error) throw error;
        resultData = result || [];
        queryRan = true;
      }

      if (isStale()) return;

      // hasMore is written ONLY past this point, so no asynchronous success path can
      // mutate it after losing request-generation ownership.
      if (queryRan && resultData.length < DETAIL_BATCH_SIZE) setHasMore(false);
      if (isInitial) {
        setData(resultData);
      } else {
        setData(prev => [...prev, ...resultData]);
      }
    } catch (err) {
      // A returned query error is a FAILURE, not a valid empty result. An initial failure
      // must render the failure state, never the valid-empty state. A
      // pagination failure keeps the rows already on screen but says more failed to load.
      // Raw Supabase detail goes to the console only.
      console.error("Error loading detail modal feed:", err);
      // A stale request must never write a failure over a newer result.
      if (isStale()) return;
      if (isInitial) {
        setData([]);
        setLoadError(true);
      } else {
        setPageError(true);
        setHasMore(false);
      }
    } finally {
      // The lock release is owner-scoped, so a stale request cannot free a newer one's lock.
      releasePaginationLock();
      // A stale finally must NOT clear loading state that belongs to a newer request.
      if (!isStale()) {
        if (isInitial) setLoading(false);
        setIsFetchingNextPage(false);
      }
    }
  }, [type, userId, isFiltered, timeRange, performanceSnapshot, organizationId]);

  useEffect(() => {
    if (isOpen && type) {
      setPage(0);
      setHasMore(true);
      fetchData(0, true);
    }
    // Invalidate any in-flight work when the modal closes or when type / range / scope
    // changes, so a resolution from the previous view cannot write state into this one.
    return () => {
      requestGenerationRef.current += 1;
      paginationLockRef.current = null;
    };
  }, [isOpen, type, timeRange, adminToggle, fetchData]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const nearBottom = scrollHeight - scrollTop <= clientHeight * 1.5;
    // `paginationLockRef` is the actual concurrency guard: two scroll events in the same
    // tick both observe the stale `isFetchingNextPage === false`, so state alone cannot
    // serialize them. `fetchData` re-checks the lock before acquiring it.
    if (nearBottom && hasMore && !loading && paginationLockRef.current === null) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchData(nextPage);
    }
  };

  const retry = () => {
    setPage(0);
    setHasMore(true);
    void fetchData(0, true);
  };

  const loadMore = () => {
    if (loading || isFetchingNextPage || paginationLockRef.current !== null) return;
    if (!pageError && !hasMore) return;
    const nextPage = pageError ? page : page + 1;
    if (!pageError) setPage(nextPage);
    void fetchData(nextPage);
  };

  return {
    data,
    loading: loading && page === 0,
    loadError,
    pageError,
    hasMore,
    isFetchingNextPage,
    performanceSubtitle,
    handleScroll,
    retry,
    loadMore,
  };
}
