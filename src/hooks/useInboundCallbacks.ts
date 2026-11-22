import { useCallback, useEffect, useRef, useState } from "react";
import {
  CallbackTakenError, callbackQueue, claimCallback, completeCallback, releaseCallback,
} from "@/lib/inbounds/api";
import type { CallbackQueue, InboundCallback } from "@/lib/inbounds/contracts";

const REFRESH_MS = 10_000;
type Action = "claim" | "release" | "complete";
const ACTIONS: Record<Action, (id: string) => Promise<unknown>> = {
  claim: claimCallback, release: releaseCallback, complete: completeCallback,
};

/** The agency's callback list for the Inbounds work area, refreshed on a timer and after every action. */
export function useInboundCallbacks() {
  const [queue, setQueue] = useState<CallbackQueue | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const request = useRef(0);
  const acting = useRef(false);

  const refresh = useCallback(async () => {
    const serial = ++request.current;
    try {
      const next = await callbackQueue();
      // A slower, older answer never replaces a newer one.
      if (serial !== request.current) return;
      setQueue(next); setError("");
    } catch (failure) {
      if (serial === request.current) setError(failure instanceof Error ? failure.message : "Callbacks could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden && !acting.current) void refresh(); }, REFRESH_MS);
    return () => { window.clearInterval(timer); ++request.current; };
  }, [refresh]);

  const act = useCallback(async (action: Action, item: InboundCallback) => {
    // One action at a time, so a double press never sends two requests.
    if (acting.current) return;
    acting.current = true; setBusyId(item.id); setNotice("");
    try {
      await ACTIONS[action](item.id);
    } catch (failure) {
      setNotice(failure instanceof CallbackTakenError || failure instanceof Error ? failure.message : "The callback could not be updated. Try again.");
    } finally {
      await refresh();
      acting.current = false; setBusyId(null);
    }
  }, [refresh]);

  return {
    items: queue?.items ?? [], admin: queue?.admin ?? false, loaded: queue !== null, error, notice, busyId, refresh,
    claim: (item: InboundCallback) => act("claim", item),
    release: (item: InboundCallback) => act("release", item),
    complete: (item: InboundCallback) => act("complete", item),
  };
}
