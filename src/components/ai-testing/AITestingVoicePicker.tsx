import React from "react";
import { VOICE_CATALOG, type VoiceStack } from "@/lib/aiTestingVoices";

interface Props {
  stack: VoiceStack;
  value: string;
  onChange: (id: string) => void;
}

export const AITestingVoicePicker: React.FC<Props> = ({ stack, value, onChange }) => {
  const voices = VOICE_CATALOG[stack];
  return (
    <section className="space-y-2">
      <label className="text-sm font-medium text-foreground">Voice</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label} — {v.gender}, {v.accent}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {stack === "twilio_cr"
          ? "ElevenLabs voice via Twilio ConversationRelay."
          : stack === "xai_s2s"
          ? "xAI Grok voice (experimental — limited catalog)."
          : "OpenAI Realtime voice."}
      </p>
    </section>
  );
};
