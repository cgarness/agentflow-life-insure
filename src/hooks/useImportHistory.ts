/**
 * useImportHistory — the Contacts → Import History fetch, gated and guarded.
 *
 * Replaces a `useCallback(…, [])` plus a bare `useEffect(() => { fetch(); }, [fetch])` in
 * `Contacts.tsx`, which fetched exactly once per mount **regardless of the active tab**, never
 * cleared on a viewer change, had no stale-response guard, and swallowed every error behind
 * `if (!error && data)`.
 *
 * Guarantees:
 *  - fetches ONLY while `enabled` (the Import History tab is active), plus an explicit
 *    `markStale()` for the post-import refresh;
 *  - CLEARS entries when the viewer/organization identity changes, so the previous viewer's rows
 *    can never paint;
 *  - ignores any in-flight response whose request generation is no longer current;
 *  - surfaces `error` distinctly from an empty list, with `refresh()` as the retry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { listImportHistory } from "@/lib/supabase-import-history";
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
  /** Non-null only on a real failure. Empty `entries` with `error === null` is a real empty history. */
  error: string | null;
  /** Re-fetch now — the retry button, and the post-retry / post-undo refresh. */
  refresh: () => Promise<void>;
  /** Mark stale so the next activation of the tab refetches (the post-import path). */
  markStale: () => void;
}

export function useImportHistory({ viewer, enabled }: UseImportHistoryParams): UseImportHistoryReturn {
  const [entries, setEntries] = useState<ImportHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by markStale() purely to make the gate effect re-evaluate.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Only the newest request may commit. Bumped on every identity change AND before every fetch, so
  // a response for the previous viewer can never repaint — including when it resolves after the
  // newer one and would otherwise clear the loading flag.
  const fetchSeqRef = useRef(0);
  /** The identity whose rows are currently on screen. `null` = nothing loaded / must (re)fetch. */
  const loadedKeyRef = useRef<string | null>(null);

  const viewerKey = effectiveViewerKey(viewer);

  // Identity changed: the rows on screen belong to the previous viewer — drop them with it, and
  // invalidate any request already in flight for that viewer.
  useEffect(() => {
    fetchSeqRef.current += 1;
    loadedKeyRef.current = null;
    setEntries([]);
    setError(null);
    setLoading(false);
  }, [viewerKey]);

  const runFetch = useCallback(async () => {
    if (!viewer || !viewerKey) return;
    const seq = (fetchSeqRef.current += 1);
    const keyAtStart = viewerKey;
    setLoading(true);
    setError(null);
    try {
      const rows = await listImportHistory({
        organizationId: viewer.organizationId,
        viewerId: viewer.viewerId,
        orgWide: isOrganizationWideViewer(viewer),
      });
      if (fetchSeqRef.current !== seq) return; // superseded — a newer viewer owns the screen
      loadedKeyRef.current = keyAtStart;
      setEntries(rows);
      setLoading(false);
    } catch (e) {
      if (fetchSeqRef.current !== seq) return;
      console.error("[Contacts] Import History load failed:", e);
      // Fail closed: show nothing rather than a stale or partial list, and say so. `loadedKeyRef`
      // stays null so re-activating the tab retries on its own.
      setEntries([]);
      setError(e instanceof Error ? e.message : "Could not load import history.");
      setLoading(false);
    }
  }, [viewer, viewerKey]);

  // Tab-gated. An inactive Contacts tab issues NO `import_history` query at all.
  useEffect(() => {
    if (!enabled || !viewer || !viewerKey) return;
    if (loadedKeyRef.current === viewerKey) return;
    void runFetch();
  }, [enabled, viewer, viewerKey, refreshNonce, runFetch]);

  const markStale = useCallback(() => {
    loadedKeyRef.current = null;
    setRefreshNonce((n) => n + 1);
  }, []);

  return { entries, loading, error, refresh: runFetch, markStale };
}
