/**
 * useImportHistory — the Contacts → Import History fetch: tab-gated, viewer-keyed, paginated.
 *
 * Two properties are load-bearing and easy to get subtly wrong:
 *
 * 1. **Render-time identity matching, not effect-time clearing.** State is stored TOGETHER with the
 *    viewer key it was loaded for and read back through a derived value. Clearing in a passive
 *    `useEffect` is one commit too late — on the render where the viewer changes, the previous
 *    viewer's rows are still in state, are returned to the component, are committed to the DOM and
 *    are painted; the effect only clears them afterwards. Deriving makes the switch synchronous.
 *
 * 2. **Pagination, not a silent cap.** A hard `.limit()` hides older imports with no way to reach
 *    them and no indication anything was withheld. Pages are explicit and `hasMore` drives a
 *    visible "Load more".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listImportHistory, IMPORT_HISTORY_PAGE_SIZE } from "@/lib/supabase-import-history";
import { isOrganizationWideViewer, effectiveViewerKey, type EffectiveViewer } from "@/lib/effectiveViewer";
import type { ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";

export interface UseImportHistoryParams {
  viewer: EffectiveViewer | null;
  /** True only while the Import History tab is the active tab. */
  enabled: boolean;
}

export interface UseImportHistoryReturn {
  entries: ImportHistoryEntry[];
  loading: boolean;
  /** True while a `loadMore()` page is in flight (the first page uses `loading`). */
  loadingMore: boolean;
  /** Non-null only on a real failure. Empty `entries` with `error === null` is a real empty history. */
  error: string | null;
  /** More authorized rows exist beyond what is loaded. */
  hasMore: boolean;
  /** Re-fetch from page one — the retry button, and the post-retry / post-undo refresh. */
  refresh: () => Promise<void>;
  /** Append the next page. */
  loadMore: () => Promise<void>;
  /** Mark stale so the next activation of the tab refetches (the post-import path). */
  markStale: () => void;
}

/** All state for ONE viewer identity. Carrying the key with the data is what makes it derivable. */
interface KeyedState {
  key: string;
  entries: ImportHistoryEntry[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
}

const EMPTY_ENTRIES: ImportHistoryEntry[] = [];

export function useImportHistory({ viewer, enabled }: UseImportHistoryParams): UseImportHistoryReturn {
  const [state, setState] = useState<KeyedState | null>(null);
  // Bumped by markStale() purely to make the gate effect re-evaluate.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Only the newest request may commit. Bumped before every fetch, so a response for a superseded
  // viewer can never repaint — including when it resolves after the newer one.
  const fetchSeqRef = useRef(0);
  /** The identity a fetch has already been STARTED for (prevents the gate effect re-firing). */
  const startedKeyRef = useRef<string | null>(null);

  const viewerKey = effectiveViewerKey(viewer);

  // ── Render-time identity match ───────────────────────────────────────────────────────────────
  // If the state on hand was loaded for a different viewer, it does not exist as far as this
  // render is concerned. No effect required, so there is no window in which it can be seen.
  const current = state && viewerKey && state.key === viewerKey ? state : null;

  // A viewer this tab is about to fetch for is LOADING from its very first render — before the
  // passive effect that starts the request has had any chance to run. Reporting `loading: false`
  // in that window made the panel commit its "no imports yet" empty state for a frame on every
  // activation and every viewer change. An empty history and an unstarted one are not the same
  // thing, and only one of them is safe to show.
  const willFetch = enabled && !!viewer && !!viewerKey && !current;

  const runFetch = useCallback(
    async (mode: "replace" | "append", offset: number) => {
      if (!viewer || !viewerKey) return;
      const seq = (fetchSeqRef.current += 1);
      const keyAtStart = viewerKey;

      setState((prev) => {
        const base = prev && prev.key === keyAtStart
          ? prev
          : { key: keyAtStart, entries: EMPTY_ENTRIES, loading: false, loadingMore: false, error: null, hasMore: false };
        return mode === "append"
          ? { ...base, loadingMore: true, error: null }
          : { ...base, entries: EMPTY_ENTRIES, loading: true, loadingMore: false, error: null, hasMore: false };
      });

      try {
        const rows = await listImportHistory({
          organizationId: viewer.organizationId,
          viewerId: viewer.viewerId,
          orgWide: isOrganizationWideViewer(viewer),
          offset,
          pageSize: IMPORT_HISTORY_PAGE_SIZE,
        });
        if (fetchSeqRef.current !== seq) return; // superseded — a newer viewer owns the screen
        setState((prev) => {
          const kept = mode === "append" && prev && prev.key === keyAtStart ? prev.entries : EMPTY_ENTRIES;
          return {
            key: keyAtStart,
            entries: [...kept, ...rows],
            loading: false,
            loadingMore: false,
            error: null,
            // A full page means there may be more; a short page is definitively the end.
            hasMore: rows.length === IMPORT_HISTORY_PAGE_SIZE,
          };
        });
      } catch (e) {
        if (fetchSeqRef.current !== seq) return;
        console.error("[Contacts] Import History load failed:", e);
        const message = e instanceof Error ? e.message : "Could not load import history.";
        setState((prev) => {
          // On an append failure the already-loaded rows stay; only the new page is lost.
          const kept = mode === "append" && prev && prev.key === keyAtStart ? prev.entries : EMPTY_ENTRIES;
          return {
            key: keyAtStart,
            entries: kept,
            loading: false,
            loadingMore: false,
            error: message,
            hasMore: mode === "append" ? (prev?.hasMore ?? false) : false,
          };
        });
        // Allow the gate effect to retry on the next activation.
        if (mode === "replace") startedKeyRef.current = null;
      }
    },
    [viewer, viewerKey],
  );

  const refresh = useCallback(async () => {
    startedKeyRef.current = viewerKey;
    await runFetch("replace", 0);
  }, [runFetch, viewerKey]);

  const loadMore = useCallback(async () => {
    if (!current?.hasMore || current.loadingMore) return;
    await runFetch("append", current.entries.length);
  }, [runFetch, current?.hasMore, current?.loadingMore, current?.entries.length]);

  // Tab-gated START. An inactive Contacts tab issues NO `import_history` query at all.
  //
  // Only the START lives in an effect — the CLEAR is render-time (see `current` above), which is
  // the part that must not lag a commit behind. `startedKeyRef` is a ref so a re-render cannot
  // re-fire the fetch.
  useEffect(() => {
    if (!enabled || !viewer || !viewerKey) return;
    if (startedKeyRef.current === viewerKey) return;
    startedKeyRef.current = viewerKey;
    void runFetch("replace", 0);
  }, [enabled, viewer, viewerKey, refreshNonce, runFetch]);

  const markStale = useCallback(() => {
    startedKeyRef.current = null;
    setRefreshNonce((n) => n + 1);
  }, []);

  return useMemo(
    () => ({
      entries: current?.entries ?? EMPTY_ENTRIES,
      loading: current?.loading ?? willFetch,
      loadingMore: current?.loadingMore ?? false,
      error: current?.error ?? null,
      hasMore: current?.hasMore ?? false,
      refresh,
      loadMore,
      markStale,
    }),
    [current, willFetch, refresh, loadMore, markStale],
  );
}
