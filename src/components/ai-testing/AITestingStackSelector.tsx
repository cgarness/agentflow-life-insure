import React from "react";
import type { VoiceStack } from "@/lib/aiTestingVoices";

const STACK_OPTIONS: {
  id: VoiceStack;
  label: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    id: "twilio_cr",
    label: "Twilio + Deepgram + ElevenLabs + OpenAI",
    description:
      "ConversationRelay pipeline — Twilio handles STT/TTS; OpenAI drives the conversation. Best Twilio-native quality.",
    recommended: true,
  },
  {
    id: "xai_s2s",
    label: "xAI Grok Voice",
    description:
      "Speech-to-speech via Media Streams. Most expressive delivery; requires XAI_API_KEY on server.",
  },
  {
    id: "openai_realtime",
    label: "OpenAI Realtime",
    description:
      "Speech-to-speech via Media Streams (Twilio ↔ AgentFlow ↔ OpenAI Realtime). Reliable telephony bridge using G.711 µ-law.",
  },
];

interface Props {
  value: VoiceStack;
  onChange: (next: VoiceStack) => void;
}

export const AITestingStackSelector: React.FC<Props> = ({ value, onChange }) => (
  <section className="space-y-3">
    <h2 className="text-sm font-medium text-foreground">Voice stack</h2>
    <div className="grid gap-3">
      {STACK_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`text-left p-4 rounded-xl border transition-all ${
            value === opt.id
              ? "border-foreground ring-1 ring-foreground bg-accent/40"
              : "border-border bg-card hover:border-primary/30"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{opt.label}</span>
            {opt.recommended && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                Recommended
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
        </button>
      ))}
    </div>
  </section>
);
