import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInboundsRoom } from "@/hooks/useInboundsRoom";
import { useInboundsVoice } from "@/hooks/useInboundsVoice";
import { useFloatingDialerDispositions } from "@/hooks/useFloatingDialerDispositions";
import { RoomScripts } from "@/components/inbounds/RoomScripts";
import { RoomStats } from "@/components/inbounds/RoomStats";
import { RoomRecords } from "@/components/inbounds/RoomRecords";
import { RoomDisposition } from "@/components/inbounds/RoomDisposition";
import { RoomHeader } from "@/components/inbounds/RoomHeader";
import { RoomStatus } from "@/components/inbounds/RoomStatus";
import { RoomCallStation } from "@/components/inbounds/RoomCallStation";
import { textButton } from "./styles";
export function RoomWorkspace({ org, user, name }: {
  org: string;
  user: string;
  name: string;
}) {
  const room = useInboundsRoom(org, user),
    config = useFloatingDialerDispositions(org, user);
  const { setReady } = room;
  const { retry: reloadOutcomes } = config;
  const [scriptReady, setScriptReady] = useState(false),
    [phoneReady, setPhoneReady] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const configReady = scriptReady && config.status === "ready",
    configRef = useRef(configReady);
  configRef.current = configReady;
  const onReady = useCallback(
    (value: boolean) => {
      setPhoneReady(value);
      setReady(value && configRef.current);
    },
    [setReady],
  );
  const voice = useInboundsVoice(room.sessionId, user, onReady, room.refresh);
  const s = room.snapshot,
    ownSession =
      s?.session?.session_id === room.sessionId &&
      s.session.state !== "offline";
  const inCall = voice.state === "active" || voice.state === "incoming";
  const pending = !!s?.pending || !!voice.awaiting;
  const available =
    !!s &&
    ownSession &&
    s.session?.state === "available" &&
    phoneReady &&
    configReady &&
    !pending &&
    !room.error;
  voice.canRing.current =
    available && (voice.state === "idle" || voice.state === "incoming");
  useEffect(() => {
    setReady(phoneReady && configReady);
  }, [phoneReady, configReady, setReady]);
  useEffect(() => {
    const handler = () => reloadOutcomes();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [reloadOutcomes]);
  useEffect(() => {
    const channel = supabase
      .channel(`room-outcomes:${org}:${user}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dispositions",
          filter: `organization_id=eq.${org}`,
        },
        reloadOutcomes,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pipeline_stages",
          filter: `organization_id=eq.${org}`,
        },
        reloadOutcomes,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [org, user, reloadOutcomes]);
  const action = async (kind: "join" | "pause" | "resume" | "leave") => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      if (kind === "join") {
        await room.act("join");
        try {
          await voice.connect();
          await room.act("resume");
        } catch (e) {
          await room.act("pause").catch(() => {});
          throw e;
        }
      } else {
        await room.act(kind);
        if (kind === "leave") voice.cleanup();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Room action failed. Retry.");
    } finally {
      setWorking(false);
    }
  };
  const status =
    voice.state === "incoming"
      ? "Incoming call"
      : voice.state === "active"
        ? "On a call"
        : pending
          ? "Wrap-up required"
          : available
            ? "Ready for calls"
            : ownSession
              ? "Paused"
              : "Outside the room";
  return (
    <main className="dark min-h-screen bg-[#080f1d] text-slate-100">
      <RoomHeader />
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-7">
        <RoomStatus
          {...{
            name,
            status,
            s,
            ownSession,
            available,
            pending,
            working,
            configReady,
            phoneReady,
            inCall,
            action,
          }}
          state={voice.state}
        />
        {s && <RoomStats data={s} />}
        {(room.error || voice.error || error) && (
          <div
            role="alert"
            className="rounded-xl border border-rose-400/60 bg-rose-950/40 p-4 text-rose-100"
          >
            {error || room.error || voice.error}{" "}
            <button className={textButton} onClick={() => void room.refresh()}>
              Refresh status
            </button>
          </div>
        )}
        {config.status !== "ready" && (
          <div
            role="alert"
            className="rounded-xl border border-amber-400/60 p-4 text-amber-100"
          >
            {config.status === "loading"
              ? "Loading call outcomes…"
              : "Call outcomes are unavailable. Configure them in AgentFlow Settings, then retry."}{" "}
            <button className={textButton} onClick={config.retry}>
              Reload outcomes
            </button>
          </div>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
          <div className="order-2 space-y-6 lg:order-1">
            <RoomScripts org={org} onReady={setScriptReady} />
          </div>
          <div className="order-1 space-y-5 lg:order-2">
            <RoomCallStation {...{ voice, inCall, pending, available }} />
            {s?.pending && (
              <RoomDisposition
                key={s.pending.id}
                call={s.pending}
                org={org}
                config={config}
                onSaved={room.refresh}
              />
            )}
            <p className="px-2 text-xs leading-relaxed text-slate-300">
              Keep this tab open. Only dedicated Inbounds numbers route here. Up
              to 10 agents can join this pilot room.
            </p>
          </div>
        </div>
        {s && <RoomRecords data={s} />}
      </div>
    </main>
  );
}
