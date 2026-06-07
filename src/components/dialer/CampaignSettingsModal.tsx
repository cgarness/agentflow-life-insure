import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_SETTINGS_COPY } from "./campaignSettingsSchema";

export interface CampaignSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  isUnlimited: boolean;
  setIsUnlimited: (v: boolean) => void;
  maxAttemptsValue: number | "";
  setMaxAttemptsValue: (v: number | "") => void;
  callingHoursStart: string;
  setCallingHoursStart: (v: string) => void;
  callingHoursEnd: string;
  setCallingHoursEnd: (v: string) => void;
  retryIntervalHours: number;
  setRetryIntervalHours: (v: number) => void;
  ringTimeoutValue: number;
  setRingTimeoutValue: (v: number) => void;
  settingsAutoDialEnabled: boolean;
  setSettingsAutoDialEnabled: (fn: (v: boolean) => boolean) => void;
  localPresenceEnabled: boolean;
  setLocalPresenceEnabled: (fn: (v: boolean) => boolean) => void;
  /** True when a call/wrap-up is in progress — saved settings apply to the next call. */
  sessionActive?: boolean;
  /** Inline validation error surfaced from the save attempt (Zod). */
  errorMessage?: string | null;
  loading: boolean;
  saving: boolean;
  onSave: () => void;
}

const inputCls = "rounded border border-input bg-background px-2 py-1.5 text-sm";

/* A plain numeric field (label + number input + optional hint). */
function NumberField({ label, value, min, max, hint, onChange }: { label: string; value: number; min: number; max: number; hint?: React.ReactNode; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`w-24 ${inputCls}`} />
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

/* A labelled on/off switch with an optional helper line. */
function ToggleRow({ label, helper, checked, onToggle }: { label: string; helper?: string; checked: boolean; onToggle: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button type="button" role="switch" aria-checked={checked} onClick={onToggle} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}>
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-1"}`} />
        </button>
      </div>
      {helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

export default function CampaignSettingsModal({
  open,
  onOpenChange,
  campaignName,
  isUnlimited,
  setIsUnlimited,
  maxAttemptsValue,
  setMaxAttemptsValue,
  callingHoursStart,
  setCallingHoursStart,
  callingHoursEnd,
  setCallingHoursEnd,
  retryIntervalHours,
  setRetryIntervalHours,
  ringTimeoutValue,
  setRingTimeoutValue,
  settingsAutoDialEnabled,
  setSettingsAutoDialEnabled,
  localPresenceEnabled,
  setLocalPresenceEnabled,
  sessionActive = false,
  errorMessage,
  loading,
  saving,
  onSave,
}: CampaignSettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Calling Settings</DialogTitle>
          <DialogDescription>
            Configure call attempt limits and scheduling for{" "}
            <span className="font-semibold">{campaignName}</span>.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {sessionActive && (
              <p className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {CAMPAIGN_SETTINGS_COPY.sessionActiveNote}
              </p>
            )}

            {/* Max Attempts (blank stays blank — never coerced to 0) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Call Attempts</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={isUnlimited ? "" : maxAttemptsValue}
                  disabled={isUnlimited}
                  onChange={(e) => setMaxAttemptsValue(e.target.value === "" ? "" : Number(e.target.value))}
                  className={`w-20 disabled:opacity-40 ${inputCls}`}
                  placeholder="3"
                />
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
                  <input type="checkbox" checked={isUnlimited} onChange={(e) => setIsUnlimited(e.target.checked)} className="accent-primary" />
                  Unlimited
                </label>
              </div>
            </div>

            {/* Calling Window */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{CAMPAIGN_SETTINGS_COPY.callingWindowLabel}</label>
              <div className="flex items-center gap-2">
                <input type="time" value={callingHoursStart} onChange={(e) => setCallingHoursStart(e.target.value)} className={inputCls} />
                <span className="text-muted-foreground text-sm">to</span>
                <input type="time" value={callingHoursEnd} onChange={(e) => setCallingHoursEnd(e.target.value)} className={inputCls} />
              </div>
              <p className="text-xs text-muted-foreground">{CAMPAIGN_SETTINGS_COPY.callingWindowHelper}</p>
            </div>

            <NumberField
              label="Retry Interval (hours)"
              value={retryIntervalHours}
              min={0}
              max={168}
              hint={retryIntervalHours === 0 ? "(Immediate retry)" : undefined}
              onChange={(v) => setRetryIntervalHours(Math.max(0, v))}
            />

            <NumberField
              label="Ring Timeout (seconds)"
              value={ringTimeoutValue}
              min={5}
              max={120}
              hint="(Hangs up if no answer)"
              onChange={setRingTimeoutValue}
            />

            {/* Toggles */}
            <div className="space-y-4 pt-2 border-t">
              <ToggleRow label="Auto-Dial" checked={settingsAutoDialEnabled} onToggle={() => setSettingsAutoDialEnabled((v) => !v)} />
              <ToggleRow label="Local Presence" helper={CAMPAIGN_SETTINGS_COPY.localPresenceHelper} checked={localPresenceEnabled} onToggle={() => setLocalPresenceEnabled((v) => !v)} />
            </div>

            {errorMessage && <p className="text-xs font-medium text-destructive">{errorMessage}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
