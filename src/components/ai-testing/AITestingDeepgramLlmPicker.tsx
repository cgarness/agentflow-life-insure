import React from "react";
import { DEEPGRAM_LLM_CATALOG } from "@/lib/aiTestingDeepgramModels";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export const AITestingDeepgramLlmPicker: React.FC<Props> = ({ value, onChange }) => (
  <section className="space-y-2">
    <label className="text-sm font-medium text-foreground">LLM model</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    >
      {DEEPGRAM_LLM_CATALOG.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
    <p className="text-xs text-muted-foreground">
      Managed by Deepgram Voice Agent — no separate OpenAI setup per model.
    </p>
  </section>
);
