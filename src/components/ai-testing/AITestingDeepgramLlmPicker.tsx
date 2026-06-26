import React from "react";
import {
  DEEPGRAM_LLM_GROUPS,
  normalizeDeepgramLlmSelection,
} from "@/lib/aiTestingDeepgramModels";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export const AITestingDeepgramLlmPicker: React.FC<Props> = ({ value, onChange }) => {
  const normalizedValue = normalizeDeepgramLlmSelection(value);

  return (
    <section className="space-y-2">
      <label className="text-sm font-medium text-foreground">LLM model</label>
      <select
        value={normalizedValue}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {DEEPGRAM_LLM_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} · {entry.tier}
                {entry.recommended ? " · Recommended" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        LLM runs inside Deepgram Voice Agent. Advanced models cost more per minute.
      </p>
      {DEEPGRAM_LLM_GROUPS.flatMap((g) => g.entries)
        .filter((e) => e.id === normalizedValue)
        .map((entry) => (
          <p key={entry.id} className="text-[11px] text-muted-foreground">
            {entry.description}
            {entry.recommended ? " Recommended for natural appointment-setting tests." : ""}
          </p>
        ))}
    </section>
  );
};
