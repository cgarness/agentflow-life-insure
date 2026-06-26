import React, { useState } from "react";
import { ChevronDown, ChevronRight, Headphones } from "lucide-react";
import type { DeepgramBrowserAudioOptions } from "@/lib/aiTestingFormSchema";

interface Props {
  value: DeepgramBrowserAudioOptions;
  onChange: (next: DeepgramBrowserAudioOptions) => void;
  disabled?: boolean;
}

export const AITestingBrowserOptions: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const volumePercent = Math.round(value.backgroundVolume * 100);

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 p-4 text-left disabled:opacity-50"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Headphones className="w-4 h-4" />
          Browser audio options
          <span className="text-xs font-normal text-muted-foreground">
            Deepgram browser test only
          </span>
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div className="border-t border-border p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Microphone processing</p>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Echo cancellation</span>
              <input
                type="checkbox"
                checked={value.echoCancellation}
                onChange={(e) => onChange({ ...value, echoCancellation: e.target.checked })}
                disabled={disabled}
                className="rounded border-border"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Noise suppression</span>
              <input
                type="checkbox"
                checked={value.noiseSuppression}
                onChange={(e) => onChange({ ...value, noiseSuppression: e.target.checked })}
                disabled={disabled}
                className="rounded border-border"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Auto gain control</span>
              <input
                type="checkbox"
                checked={value.autoGainControl}
                onChange={(e) => onChange({ ...value, autoGainControl: e.target.checked })}
                disabled={disabled}
                className="rounded border-border"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Noise suppression can clip short answers like &ldquo;yes,&rdquo; &ldquo;no,&rdquo; and names.
              Default is off for Deepgram browser tests.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Background sound</label>
            <select
              value={value.backgroundSound}
              onChange={(e) =>
                onChange({
                  ...value,
                  backgroundSound: e.target.value as DeepgramBrowserAudioOptions["backgroundSound"],
                })
              }
              disabled={disabled}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
            >
              <option value="off">Off</option>
              <option value="light_office">Light office</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Browser test only. Mixed into your local playback, not sent to Deepgram.
            </p>
          </div>

          {value.backgroundSound === "light_office" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-foreground">Background volume</label>
                <span className="font-mono text-muted-foreground">{volumePercent}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={volumePercent}
                onChange={(e) =>
                  onChange({ ...value, backgroundVolume: Number(e.target.value) / 100 })
                }
                disabled={disabled}
                className="w-full"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
};
