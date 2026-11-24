import { useCallback, useEffect, useRef, useState } from "react";
import { callbackQueue, claimCallback, completeCallback, releaseCallback } from "@/lib/inbounds/api";
import type { CallbackQueue, InboundCallback } from "@/lib/inbounds/contracts";

const REFRESH_MS = 10_000;
export type CallbackAction = "claim" | "release" | "complete";
const ACTIONS: Record<CallbackAction, (id: string) => Promise<unknown>> = {
  claim: claimCallback, release: releaseCallback, complete: completeCallback,
};

/** The agency's callback list for the Inbounds work area, refreshed on a timer and after every action. */
export function useInboundCallbacks() {
  const [queue, setQueue] = useState<CallbackQueue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** The one action in flight. Every row's actions wait for it, so no press is dropped without a sign. */
  const [busy, setBusy] = useState<{id: string; action: CallbackAction} | null>(null);
  const request = useRef(0);
  const acting = useRef(false);
  /** The server said this agency has no callback list (outside the Automations pilot), so the timer stops asking. */
  const unavailable = useRef(false);
  /** False once the work area closes, so an action answered afterwards neither reads the list again nor updates it. */
  const open = useRef(true);

  // A notice explains the list the agent is looking at, so it stays through the read that follows its action and
  // clears once a later read succeeds.
  const refresh = useCallback(async (keepNotice = false) => {
    if (!open.current) return;
    const serial = ++request.current;
    try {
      const next = await callbackQueue();
      // A slower, older answer never replaces a newer one.
      if (serial !== request.current) return;
      setQueue(next); setError(""); unavailable.current = !next.available;
      if (!keepNotice) setNotice("");
    } catch (failure) {
      if (serial === request.current) setError(failure instanceof Error ? failure.message : "Callbacks could not be loaded.");
    }
  }, []);

  useEffect(() => {
    open.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden && !acting.current && !unavailable.current) void refresh();
    }, REFRESH_MS);
    return () => { open.current = false; window.clearInterval(timer); ++request.current; };
  }, [refresh]);

  const act = useCallback(async (action: CallbackAction, item: InboundCallback) => {
    // One action at a time, so a double press never sends two requests.
    if (acting.current) return;
    acting.current = true; setBusy({id: item.id, action}); setNotice("");
    try {
      await ACTIONS[action](item.id);
    } catch (failure) {
      if (open.current) setNotice(failure instanceof Error ? failure.message : "The callback could not be updated. Try again.");
    } finally {
      await refresh(true);
      acting.current = false;
      if (open.current) setBusy(null);
    }
  }, [refresh]);

  return {
    items: queue?.items ?? [], admin: queue?.admin ?? false, loaded: queue !== null, error, notice, busy, refresh: () => refresh(),
    available: queue?.available ?? false, openCount: queue?.open_count ?? 0, claimedCount: queue?.claimed_count ?? 0,
    claim: (item: InboundCallback) => act("claim", item),
    release: (item: InboundCallback) => act("release", item),
    complete: (item: InboundCallback) => act("complete", item),
  };
}
