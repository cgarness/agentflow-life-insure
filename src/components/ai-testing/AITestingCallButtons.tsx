import React from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import type { PlacingStack } from "@/hooks/useAITestingSession";

interface Props {
  placingStack: PlacingStack;
  ending: boolean;
  canEndCall: boolean;
  onPlaceOpenAI: () => void;
  onPlaceDeepgram: () => void;
  onEnd: () => void;
}

export const AITestingCallButtons: React.FC<Props> = ({
  placingStack,
  ending,
  canEndCall,
  onPlaceOpenAI,
  onPlaceDeepgram,
  onEnd,
}) => {
  const placingOpenAI = placingStack === "openai_realtime";
  const placingDeepgram = placingStack === "deepgram_voice_agent";
  const anyPlacing = placingStack !== null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onPlaceOpenAI}
        disabled={anyPlacing || ending}
        className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-5 disabled:opacity-50"
      >
        {placingOpenAI ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Phone className="w-4 h-4" />
        )}
        {placingOpenAI ? "Calling…" : "Place OpenAI Phone Test Call"}
      </button>
      <button
        type="button"
        onClick={onPlaceDeepgram}
        disabled={anyPlacing || ending}
        className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 h-10 px-5 disabled:opacity-50"
      >
        {placingDeepgram ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Phone className="w-4 h-4" />
        )}
        {placingDeepgram ? "Calling…" : "Place Deepgram Phone Test Call"}
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
};
