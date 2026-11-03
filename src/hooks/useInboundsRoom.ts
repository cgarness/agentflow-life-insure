import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { roomState, roomSession } from "@/lib/inbounds/api";
import type { RoomSnapshot } from "@/lib/inbounds/contracts";
export function useInboundsRoom(org: string, user: string) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null),
    [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const current = useRef(true),
    sequence = useRef(0),
    ready = useRef(false),
    joined = useRef(false),
    heartbeatBusy = useRef(false);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const next = await roomState();
      if (!current.current || seq !== sequence.current) return;
      if (next.organization_id !== org || next.user_id !== user)
        throw Error("Room identity changed. Reload this page.");
      setSnapshot(next);
      setError(null);
    } catch (e) {
      if (current.current && seq === sequence.current) {
        setError(e instanceof Error ? e.message : "Room unavailable");
        setSnapshot(null);
      }
    }
  }, [org, user]);
  const act = useCallback(
    async (action: "join" | "pause" | "resume" | "leave") => {
      await roomSession(sessionId, action, ready.current);
      joined.current = action !== "leave";
      await refresh();
    },
    [refresh, sessionId],
  );
  const setReady = useCallback((value: boolean) => {
    ready.current = value;
  }, []);
  useEffect(() => {
    current.current = true;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      if (joined.current && !heartbeatBusy.current) {
        heartbeatBusy.current = true;
        void roomSession(sessionId, "heartbeat", ready.current)
          .catch((e) => {
            if (current.current) {
              setError(e.message);
              setSnapshot(null);
            }
          })
          .finally(() => {
            heartbeatBusy.current = false;
          });
      }
    }, 10000);
    const channel = supabase
      .channel(`inbounds:${org}:${user}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calls",
          filter: `organization_id=eq.${org}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dispositions",
          filter: `organization_id=eq.${org}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    const close = () => {
      if (joined.current) void roomSession(sessionId, "leave").catch(() => {});
    };
    window.addEventListener("pagehide", close);
    return () => {
      current.current = false;
      // This is a request-generation counter, not a DOM ref. Cleanup invalidates all outstanding reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++sequence.current;
      clearInterval(timer);
      window.removeEventListener("pagehide", close);
      void supabase.removeChannel(channel);
      close();
    };
  }, [org, user, refresh, sessionId]);
  return { snapshot, error, refresh, act, sessionId, setReady };
}
