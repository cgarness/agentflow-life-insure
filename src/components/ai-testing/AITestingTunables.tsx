import React, { useState } from "react";
import { ChevronDown, ChevronRight, Sliders } from "lucide-react";
import type { InterruptionSensitivity, Tuning } from "@/lib/aiTestingFormSchema";
import type { VoiceStack } from "@/lib/aiTestingVoices";

interface Props {
  stack: VoiceStack;
  value: Tuning;
  onChange: (next: Tuning) => void;
}

const SENSITIVITIES: InterruptionSensitivity[] = ["low", "medium", "high"];

export const AITestingTunables: React.FC<Props> = ({ stack, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const speakingRateDisabled =
    stack !== "twilio_cr" && stack !== "deepgram_voice_agent" && stack !== "openai_realtime";

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sliders className="w-4 h-4" />
          Tunables
          <span className="text-xs font-normal text-muted-foreground">
            temp {value.temperature.toFixed(1)} · rate {value.speaking_rate.toFixed(2)} · {value.interruption_sensitivity}
          </span>
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div className="border-t border-border p-4 space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Temperature</label>
              <span className="font-mono text-muted-foreground">{value.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.1}
              value={value.temperature}
              onChange={(e) => onChange({ ...value, temperature: Number(e.target.value) })}
              className="w-full"
            />
            <p className="text-[11px] text-muted-foreground">Higher = more varied / creative replies.</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">
                Speaking rate
                {speakingRateDisabled && (
                  <span className="ml-2 text-muted-foreground italic">
                    (Controlled by AI provider)
                  </span>
                )}
              </label>
              <span className="font-mono text-muted-foreground">{value.speaking_rate.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={value.speaking_rate}
              onChange={(e) => onChange({ ...value, speaking_rate: Number(e.target.value) })}
              disabled={speakingRateDisabled}
              className="w-full disabled:opacity-40"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Interruption sensitivity</label>
            <div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">
              {SENSITIVITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ ...value, interruption_sensitivity: s })}
                  className={`text-xs font-medium uppercase tracking-wider py-1.5 rounded-sm ${
                    value.interruption_sensitivity === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {stack === "deepgram_voice_agent"
                ? "Flux turn-taking: higher = agent holds the floor longer before yielding."
                : "How readily the AI yields the floor when the caller starts speaking."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
