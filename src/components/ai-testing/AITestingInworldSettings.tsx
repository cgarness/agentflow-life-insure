import React from "react";
import {
  DEFAULT_INWORLD_TUNING,
  INWORLD_ROUTER_CATALOG,
  INWORLD_TTS_CATALOG,
  type InworldTuning,
} from "@/lib/aiTestingInworld";
import { VOICE_CATALOG } from "@/lib/aiTestingVoices";

interface Props {
  value: InworldTuning;
  onChange: (next: InworldTuning) => void;
}

export const AITestingInworldSettings: React.FC<Props> = ({ value, onChange }) => {
  const voices = VOICE_CATALOG.inworld_realtime_agent;

  return (
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">Inworld Realtime call settings</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Speech-to-speech via Inworld Realtime API on the same Render bridge as Deepgram (
          <code className="text-[10px]">/twilio/inworld</code>). <code className="text-[10px]">INWORLD_API_KEY</code>{" "}
          lives on Render only.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Inworld voice</label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value.voice_id || DEFAULT_INWORLD_TUNING.voice_id}
          onChange={(e) => onChange({ ...value, voice_id: e.target.value })}
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Router / LLM model</label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value.model_id}
          onChange={(e) => onChange({ ...value, model_id: e.target.value })}
        >
          {INWORLD_ROUTER_CATALOG.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {INWORLD_ROUTER_CATALOG.find((m) => m.id === value.model_id)?.hint}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">TTS tier</label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value.tts_model}
          onChange={(e) =>
            onChange({ ...value, tts_model: e.target.value as InworldTuning["tts_model"] })
          }
        >
          {INWORLD_TTS_CATALOG.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Temperature ({value.temperature.toFixed(2)})
          </label>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.05}
            value={value.temperature}
            onChange={(e) => onChange({ ...value, temperature: Number(e.target.value) })}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Interruption (semantic VAD)</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={value.interruption_sensitivity}
            onChange={(e) =>
              onChange({
                ...value,
                interruption_sensitivity: e.target.value as InworldTuning["interruption_sensitivity"],
              })
            }
          >
            <option value="low">Low (patient)</option>
            <option value="medium">Medium (natural)</option>
            <option value="high">High (eager barge-in)</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Max response tokens</label>
        <input
          type="number"
          min={32}
          max={2048}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value.max_response_tokens}
          onChange={(e) =>
            onChange({ ...value, max_response_tokens: Number(e.target.value) || 512 })
          }
        />
      </div>
    </section>
  );
};
