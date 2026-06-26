import React from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import type { PlacingStack } from "@/hooks/useAITestingSession";

interface Props {
  placing: boolean;
  placingStack: PlacingStack;
  ending: boolean;
  canEndCall: boolean;
  onPlaceDeepgram: () => void;
  onPlaceInworld: () => void;
  onPlaceOpenAI: () => void;
  onEnd: () => void;
}

export const AITestingCallButtons: React.FC<Props> = ({
  placing,
  placingStack,
  ending,
  canEndCall,
  onPlaceDeepgram,
  onPlaceInworld,
  onPlaceOpenAI,
  onEnd,
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onClick={onPlaceDeepgram}
      disabled={placing || ending}
      className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 h-10 px-5 disabled:opacity-50"
    >
      {placingStack === "deepgram_voice_agent" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Phone className="w-4 h-4" />
      )}
      {placingStack === "deepgram_voice_agent" ? "Calling…" : "Place Deepgram Phone Test Call"}
    </button>
    <button
      type="button"
      onClick={onPlaceInworld}
      disabled={placing || ending}
      className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 h-10 px-5 disabled:opacity-50"
    >
      {placingStack === "inworld_realtime_agent" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Phone className="w-4 h-4" />
      )}
      {placingStack === "inworld_realtime_agent" ? "Calling…" : "Place Inworld Phone Test Call"}
    </button>
    <button
      type="button"
      onClick={onPlaceOpenAI}
      disabled={placing || ending}
      className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 h-10 px-5 disabled:opacity-50"
    >
      {placingStack === "openai_realtime" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Phone className="w-4 h-4" />
      )}
      {placingStack === "openai_realtime" ? "Calling…" : "Place OpenAI Realtime Phone Test Call"}
    </button>
    {canEndCall && (
      <button
        type="button"
        onClick={onEnd}
        disabled={ending}
        className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 h-10 px-6 disabled:opacity-50"
      >
        {ending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOff className="w-4 h-4" />}
        {ending ? "Ending…" : "End call"}
      </button>
    )}
  </div>
);
