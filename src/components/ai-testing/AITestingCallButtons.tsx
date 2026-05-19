import React from "react";
import { Phone, PhoneOff, Loader2 } from "lucide-react";

interface Props {
  placing: boolean;
  ending: boolean;
  canEndCall: boolean;
  onPlace: () => void;
  onEnd: () => void;
}

export const AITestingCallButtons: React.FC<Props> = ({
  placing,
  ending,
  canEndCall,
  onPlace,
  onEnd,
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onClick={onPlace}
      disabled={placing || ending}
      className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-6 disabled:opacity-50"
    >
      {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
      {placing ? "Calling…" : "Place test call"}
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
