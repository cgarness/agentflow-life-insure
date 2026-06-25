import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Phone } from "lucide-react";
import { AITestingPhoneInputs } from "@/components/ai-testing/AITestingPhoneInputs";
import { AITestingCallButtons } from "@/components/ai-testing/AITestingCallButtons";
import { AITestingLiveStatus } from "@/components/ai-testing/AITestingLiveStatus";
import type { PlacingStack, TestSession } from "@/hooks/useAITestingSession";

interface Props {
  to: string;
  from: string;
  phoneOptions: string[];
  onChangeTo: (value: string) => void;
  onChangeFrom: (value: string) => void;
  placing: boolean;
  placingStack: PlacingStack;
  ending: boolean;
  canEndCall: boolean;
  session: TestSession | null;
  onPlaceDeepgram: () => void;
  onPlaceInworld: () => void;
  onEnd: () => void;
}

const STACK_LABELS: Record<string, string> = {
  deepgram_voice_agent: "Deepgram Voice Agent",
  inworld_realtime_agent: "Inworld Realtime Voice Agent",
};

export const AITestingPhoneSection: React.FC<Props> = (props) => {
  const [open, setOpen] = useState(false);

  const callActive = props.placing || props.canEndCall || Boolean(props.session);
  useEffect(() => {
    if (callActive) setOpen(true);
  }, [callActive]);

  return (
    <section className="rounded-xl border border-border bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Phone className="w-4 h-4 text-muted-foreground" />
          Phone test (optional)
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Place a real outbound call through Twilio to the same agent configuration above.
          </p>
          <AITestingPhoneInputs
            to={props.to}
            from={props.from}
            phoneOptions={props.phoneOptions}
            onChangeTo={props.onChangeTo}
            onChangeFrom={props.onChangeFrom}
          />
          <AITestingCallButtons
            placing={props.placing}
            placingStack={props.placingStack}
            ending={props.ending}
            canEndCall={props.canEndCall}
            onPlaceDeepgram={props.onPlaceDeepgram}
            onPlaceInworld={props.onPlaceInworld}
            onEnd={props.onEnd}
          />
          {(props.session || props.placing) && (
            <AITestingLiveStatus
              status={props.session?.status ?? (props.placing ? "placing" : "idle")}
              callSid={props.session?.twilio_call_sid}
              errorMessage={props.session?.error_message}
              transcript={props.session?.transcript ?? []}
              stackLabel={
                props.session?.stack
                  ? STACK_LABELS[props.session.stack] ?? props.session.stack
                  : props.placingStack
                    ? STACK_LABELS[props.placingStack] ?? props.placingStack
                    : null
              }
            />
          )}
        </div>
      )}
    </section>
  );
};
