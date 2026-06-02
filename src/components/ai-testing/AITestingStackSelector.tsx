import React from "react";
import type { VoiceStack } from "@/lib/aiTestingVoices";

const STACK_OPTIONS: {
  id: VoiceStack;
  label: string;
  description: string;
  recommended?: boolean;
  experimental?: boolean;
}[] = [
  {
    id: "openai_realtime",
    label: "Speech-to-speech (recommended)",
    description:
      "OpenAI Realtime GA (gpt-realtime-2) end-to-end voice over Twilio Media Streams. Lowest latency, most natural interruptions — the priority path.",
    recommended: true,
  },
  {
    id: "twilio_cr",
    label: "Transcribed (fallback)",
    description:
      "Twilio ConversationRelay pipeline — Twilio handles STT/TTS, OpenAI drives the text conversation. Use if speech-to-speech is unavailable.",
  },
  {
    id: "xai_s2s",
    label: "xAI Grok Voice (experimental)",
    description:
      "Speech-to-speech via Media Streams. Known-broken on Deno (WebSocket can't send the auth header) — disabled.",
    experimental: true,
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
          disabled={opt.experimental}
          onClick={() => !opt.experimental && onChange(opt.id)}
          className={`text-left p-4 rounded-xl border transition-all ${
            opt.experimental
              ? "border-border bg-muted/30 opacity-60 cursor-not-allowed"
              : value === opt.id
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
            {opt.experimental && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
                Experimental
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
        </button>
      ))}
    </div>
  </section>
);
