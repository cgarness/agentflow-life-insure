import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  pendingSmsStore,
  type PendingSmsRecord,
  type ScopeEvent,
} from "@/lib/sms-send/pendingSmsStore";

const NONE: readonly PendingSmsRecord[] = Object.freeze([]);

/**
 * This identity's and contact's pending sends, oldest first. `null` (e.g. View As) shows none. The
 * result keeps its identity while this scope's records are unchanged, so another contact's send
 * does not re-render or re-merge this surface.
 */
export function usePendingSmsRecords(scopeKey: string | null): readonly PendingSmsRecord[] {
  const all = useSyncExternalStore(pendingSmsStore.subscribe, pendingSmsStore.getSnapshot, pendingSmsStore.getSnapshot);
  const previous = useRef<readonly PendingSmsRecord[]>(NONE);
  return useMemo(() => {
    const next = scopeKey ? all.filter((r) => r.scopeKey === scopeKey) : NONE;
    const prev = previous.current;
    if (next.length === prev.length && next.every((r, i) => r === prev[i])) return prev;
    previous.current = next.length ? next : NONE;
    return previous.current;
  }, [all, scopeKey]);
}

/** Recovery and acceptance notices for one mounted surface. Also marks the scope as on screen. */
export function useSmsScopeEvents(scopeKey: string | null, onEvent: (event: ScopeEvent) => void) {
  const handler = useRef({ scopeKey, onEvent });
  useLayoutEffect(() => {
    handler.current = { scopeKey, onEvent };
  });
  useEffect(() => {
    if (!scopeKey) return;
    // A scope change re-targets the handler in the layout phase, but this subscription is removed
    // only in passive cleanup. An event for the old scope in between must not reach the new one.
    return pendingSmsStore.subscribeScope(scopeKey, (event) => {
      if (handler.current.scopeKey === scopeKey) handler.current.onEvent(event);
    });
  }, [scopeKey]);
}

/** Records the surface's own list now contains are marked so capacity pruning frees them first. */
export function useMarkObserved(localIds: readonly string[]) {
  const key = localIds.join(",");
  useEffect(() => {
    if (key) pendingSmsStore.markObserved(key.split(","));
  }, [key]);
}

export interface ComposerDraft {
  /** The registered draft sink for this identity and contact, or null when none can be. */
  sinkId: string | null;
  /** Marks the composer cleared by a send and returns the draft revision after clearing. */
  clearForSend: () => number;
}

let sinkSeq = 0;

/**
 * Registers one mounted SMS composer as a draft sink, so provably unsent text can return to the
 * composer it came from — and only while that composer still shows the same identity and contact,
 * is on SMS, is empty and has not changed since the send cleared it (revision).
 */
export function useComposerDraftSink(
  scopeKey: string | null,
  channel: "sms" | "email",
  text: string,
  restore: (text: string) => void,
): ComposerDraft {
  const sinkId = useMemo(() => (scopeKey ? `sink:${(sinkSeq += 1)}` : null), [scopeKey]);
  const live = useRef({ sinkId, channel, text, revision: 0 });
  const restoreRef = useRef(restore);

  useLayoutEffect(() => {
    restoreRef.current = restore;
    const current = live.current;
    if (current.sinkId !== sinkId) {
      live.current = { sinkId, channel, text, revision: 0 };
    } else if (current.channel !== channel || current.text !== text) {
      // Every committed change the composer did not announce eagerly is still a newer draft.
      live.current = { ...current, channel, text, revision: current.revision + 1 };
    }
  });

  useLayoutEffect(() => {
    if (!sinkId || !scopeKey) return;
    return pendingSmsStore.registerSink({
      id: sinkId,
      scopeKey,
      getState: () => ({ channel: live.current.channel, text: live.current.text, revision: live.current.revision }),
      restore: (body) => {
        live.current = { ...live.current, text: body, revision: live.current.revision + 1 };
        restoreRef.current(body);
      },
    });
  }, [sinkId, scopeKey]);

  const clearForSend = useCallback(() => {
    live.current = { ...live.current, text: "", revision: live.current.revision + 1 };
    return live.current.revision;
  }, []);

  return { sinkId, clearForSend };
}
