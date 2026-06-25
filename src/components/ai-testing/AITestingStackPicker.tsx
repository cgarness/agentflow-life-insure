import React from "react";

export type BrowserStack = "deepgram_voice_agent" | "inworld_realtime_agent";

const STACK_OPTIONS: { id: BrowserStack; label: string; description: string }[] = [
  {
    id: "deepgram_voice_agent",
    label: "Deepgram Voice Agent",
    description: "One managed WebSocket: Flux STT + LLM + Aura TTS.",
  },
  {
    id: "inworld_realtime_agent",
    label: "Inworld Realtime",
    description: "Speech-to-speech via the Inworld Realtime API.",
  },
];

interface Props {
  value: BrowserStack;
  onChange: (next: BrowserStack) => void;
  disabled?: boolean;
}

export const AITestingStackPicker: React.FC<Props> = ({ value, onChange, disabled }) => (
  <section className="space-y-3">
    <h2 className="text-sm font-medium text-foreground">Voice stack</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      {STACK_OPTIONS.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={`text-left p-4 rounded-xl border transition-all disabled:opacity-50 ${
              selected
                ? "border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/40"
                : "border-border bg-card hover:border-violet-500/30"
            }`}
          >
            <span className="block text-sm font-medium text-foreground">{opt.label}</span>
            <span className="block text-xs text-muted-foreground mt-1">{opt.description}</span>
          </button>
        );
      })}
    </div>
  </section>
);
