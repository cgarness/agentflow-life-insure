import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import type { useInboundsVoice } from "@/hooks/useInboundsVoice";
import { panel, button, primary, danger } from "./styles";
export function RoomCallStation({
  voice,
  inCall,
  pending,
  available,
}: {
  voice: ReturnType<typeof useInboundsVoice>;
  inCall: boolean;
  pending: boolean;
  available: boolean;
}) {
  return (
    <section className={panel + " p-6 text-center"}>
      <div
        className={
          "mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-300/10 text-emerald-300 " +
          (voice.state === "incoming" ? "motion-safe:animate-pulse" : "")
        }
      >
        <Phone className="h-8 w-8" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-white">
        {inCall
          ? voice.caller
          : pending
            ? "Complete your wrap-up"
            : available
              ? "You’re in the room"
              : "Your call station"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">
        {available
          ? "All available agents ring together. First answer gets the call."
          : inCall
            ? "Other calls will skip you while you are busy."
            : "Enter when you’re ready to receive inbound calls."}
      </p>
      {voice.state === "incoming" && (
        <div className="mt-6 flex justify-center gap-3">
          <button className={primary} onClick={voice.answer}>
            Answer call
          </button>
          <button className={danger} onClick={voice.decline}>
            Decline
          </button>
        </div>
      )}
      {voice.state === "active" && (
        <div className="mt-6 flex justify-center gap-3">
          <button
            aria-label={voice.muted ? "Unmute" : "Mute"}
            aria-pressed={voice.muted}
            className={button}
            onClick={voice.toggleMute}
          >
            {voice.muted ? <MicOff /> : <Mic />}
          </button>
          <button className={danger} onClick={voice.hangup}>
            <PhoneOff className="mr-2 inline h-4 w-4" />
            End call
          </button>
        </div>
      )}
    </section>
  );
}
