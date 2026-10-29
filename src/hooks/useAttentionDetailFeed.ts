import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AttentionExclusions } from "@/lib/dashboard-attention";
import { EMPTY_PEOPLE, type PeopleLookup } from "@/lib/dashboard-people";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";

/** Team-mode labels for the rows on screen (presentation only). */
export interface TeamContext {
  people: PeopleLookup;
  campaigns: ReadonlyMap<string, string>;
}
export const EMPTY_TEAM_CONTEXT: TeamContext = { people: EMPTY_PEOPLE, campaigns: new Map() };

export const ATTENTION_BATCH_SIZE = 20;
export type AttentionView = "active" | "cleared";

/** One attention list (Callbacks or Missed Calls) as the detail view reads it. */
export interface AttentionFeedSource<T> {
  /** The viewer's clearances for this load's window; `undefined` when Clear is off. */
  readExclusions: (signal: AbortSignal) => Promise<AttentionExclusions | undefined>;
  page: (offset: number, pageSize: number, exclusions: AttentionExclusions | undefined, signal: AbortSignal) => Promise<T[]>;
  counts: (exclusions: AttentionExclusions | undefined, signal: AbortSignal) => Promise<{ active: number; cleared: number }>;
  cleared: (exclusions: AttentionExclusions | undefined, signal: AbortSignal) => Promise<T[]>;
  /** Team-mode names for these rows (presentation only), or `null` when not shown. */
  team: ((rows: T[], signal: AbortSignal) => Promise<TeamContext>) | null;
  keyOf: (row: T) => string;
}

export interface AttentionFeed<T> {
  status: "loading" | "failed" | "ready";
  rows: T[];
  /** Exact active total; `hasMore` is `rows.length < active`. */
  active: number;
  cleared: number;
  clearedRows: T[];
  clearedStatus: "idle" | "loading" | "failed" | "ready";
  team: TeamContext;
  view: AttentionView;
  hasMore: boolean;
  pageError: boolean;
  loadingMore: boolean;
  /** A Clear / Undo refresh is running over the rows on screen. */
  refreshing: boolean;
  /** The last refresh failed; the rows on screen are from before it. */
  refreshError: boolean;
}

const mergeTeam = (a: TeamContext, b: TeamContext): TeamContext => ({
  people: { names: new Map([...a.people.names, ...b.people.names]), unavailable: a.people.unavailable || b.people.unavailable },
  campaigns: new Map([...a.campaigns, ...b.campaigns]),
});

/**
 * The Callbacks / Missed Calls detail feed (plan §3.5.5, §3.7): request generations (an older
 * answer never writes over a newer one), one pagination request at a time, paging by the number of
 * ACTIVE rows loaded (de-duplicated by key), exact totals, an Active / Cleared view, and a refresh
 * in place after a Clear or Undo that keeps the rows on screen until the server's answer replaces
 * them. Every read of a load runs under one cancellation and the load settles only after all of them.
 */
export function useAttentionDetailFeed<T>(open: boolean, scopeKey: string, source: AttentionFeedSource<T>, initialView: AttentionView) {
  const empty: AttentionFeed<T> = {
    status: "loading", rows: [], active: 0, cleared: 0, clearedRows: [], clearedStatus: "idle", team: EMPTY_TEAM_CONTEXT,
    view: initialView, hasMore: false, pageError: false, loadingMore: false, refreshing: false, refreshError: false,
  };
  const [feed, setFeed] = useState<AttentionFeed<T>>(empty);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const exclusions = useRef<AttentionExclusions | undefined>(undefined);
  const pageLock = useRef(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const feedRef = useRef(feed);
  feedRef.current = feed;

  const load = useCallback(async (mode: "initial" | "refresh", view: AttentionView) => {
    const mine = ++generation.current;
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    pageLock.current = false;
    const src = sourceRef.current;
    const keep = mode === "refresh" ? feedRef.current.rows.length : 0;
    setFeed((f) => (mode === "initial" ? { ...empty, view } : { ...f, refreshing: true, refreshError: false }));
    const cancel = linkedAbort(ctl.signal);
    try {
      const ex = await src.readExclusions(cancel.signal);
      const [rows, counts, clearedRows] = await settleAll(
        [
          src.page(0, Math.max(keep, ATTENTION_BATCH_SIZE), ex, cancel.signal),
          src.counts(ex, cancel.signal),
          view === "cleared" ? src.cleared(ex, cancel.signal) : Promise.resolve(null),
        ] as const,
        cancel.abort,
      );
      const team = src.team ? await src.team([...rows, ...(clearedRows ?? [])], cancel.signal) : EMPTY_TEAM_CONTEXT;
      if (mine !== generation.current) return;
      exclusions.current = ex;
      setFeed((f) => ({
        ...f, status: "ready", rows, active: counts.active, cleared: counts.cleared, team, view,
        clearedRows: clearedRows ?? [], clearedStatus: clearedRows ? "ready" : "idle",
        hasMore: rows.length < counts.active, refreshing: false, refreshError: false, pageError: false,
      }));
    } catch (err) {
      console.error("[DashboardAttention] Failed to load the detail view:", err);
      if (mine !== generation.current) return;
      // A failed refresh keeps the rows on screen; a failed first load is a failure, never empty.
      setFeed((f) => (mode === "refresh" && f.status === "ready"
        ? { ...f, refreshing: false, refreshError: true, clearedStatus: view === "cleared" ? "failed" : f.clearedStatus }
        : { ...f, status: "failed", refreshing: false }));
    } finally {
      cancel.dispose();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    void load("initial", initialView);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [open, scopeKey, initialView, load]);

  const loadMore = useCallback(async () => {
    const f = feedRef.current;
    if (pageLock.current || f.status !== "ready" || f.refreshing || (!f.hasMore && !f.pageError)) return;
    pageLock.current = true;
    const mine = generation.current;
    const ctl = controller.current ?? new AbortController();
    setFeed((s) => ({ ...s, loadingMore: true, pageError: false }));
    try {
      const src = sourceRef.current;
      const more = await src.page(f.rows.length, ATTENTION_BATCH_SIZE, exclusions.current, ctl.signal);
      const team = src.team && more.length ? await src.team(more, ctl.signal) : EMPTY_TEAM_CONTEXT;
      if (mine !== generation.current) return;
      setFeed((s) => {
        const seen = new Set(s.rows.map(src.keyOf));
        const rows = [...s.rows, ...more.filter((r) => !seen.has(src.keyOf(r)))];
        // A short page means the list is complete even if the total moved meanwhile.
        return { ...s, rows, team: mergeTeam(s.team, team), loadingMore: false,
          hasMore: more.length === ATTENTION_BATCH_SIZE && rows.length < s.active };
      });
    } catch (err) {
      console.error("[DashboardAttention] Failed to load more:", err);
      if (mine === generation.current) setFeed((s) => ({ ...s, loadingMore: false, pageError: true }));
    } finally {
      if (mine === generation.current) pageLock.current = false;
    }
  }, []);

  const setView = useCallback((view: AttentionView) => {
    const f = feedRef.current;
    if (view === f.view) return;
    if (view === "cleared") {
      // Never an empty Cleared view while it loads: it says it is loading, or that it failed.
      setFeed((s) => ({ ...s, view: "cleared", clearedStatus: "loading" }));
      void load("refresh", "cleared");
    } else setFeed((s) => ({ ...s, view }));
  }, [load]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (feedRef.current.view === "active" && scrollHeight - scrollTop <= clientHeight * 1.5) void loadMore();
  };

  return {
    feed,
    loadMore,
    setView,
    handleScroll,
    retry: () => void load("initial", feedRef.current.view),
    refreshInPlace: () => void load("refresh", feedRef.current.view),
  };
}
