import type { RoomSnapshot } from "@/lib/inbounds/contracts";
import type { RoomVoiceState } from "@/hooks/useInboundsVoice";
import { panel, button, primary } from "./styles";
type Props = {
  name: string;
  status: string;
  s: RoomSnapshot | null;
  ownSession: boolean;
  available: boolean;
  pending: boolean;
  working: boolean;
  configReady: boolean;
  phoneReady: boolean;
  inCall: boolean;
  state: RoomVoiceState;
  action: (kind: "join" | "pause" | "resume" | "leave") => Promise<void>;
};
export function RoomStatus({
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
  state,
  action,
}: Props) {
  return (
    <section
      className={
        panel + " flex flex-wrap items-center justify-between gap-5 p-5"
      }
    >
      <div>
        <p className="text-sm text-slate-200">Welcome, {name}</p>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={
              "h-3 w-3 rounded-full " +
              (available
                ? "bg-emerald-300 shadow-[0_0_12px_#6ee7b7]"
                : pending
                  ? "bg-amber-300"
                  : "bg-slate-400")
            }
          />
          <h2 className="text-xl font-bold text-white" aria-live="polite">
            {status}
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-300">
          {s
            ? `${s.presence.available} ready · ${s.presence.busy} busy · ${s.presence.paused} paused`
            : "Connecting to your agency…"}
        </p>
      </div>
      <div className="flex gap-3">
        {!ownSession || state === "offline" ? (
          <button
            className={primary}
            disabled={working || !s || !configReady || pending || inCall}
            onClick={() => void action("join")}
          >
            {working ? "Connecting…" : "Enter room"}
          </button>
        ) : (
          <>
            <button
              className={button}
              disabled={
                working || inCall || pending || !configReady || !phoneReady
              }
              onClick={() =>
                void action(
                  s?.session?.state === "available" ? "pause" : "resume",
                )
              }
            >
              {available ? "Pause calls" : "Start receiving"}
            </button>
            <button
              className={button}
              disabled={working || inCall}
              onClick={() => void action("leave")}
            >
              Leave room
            </button>
          </>
        )}
      </div>
    </section>
  );
}
