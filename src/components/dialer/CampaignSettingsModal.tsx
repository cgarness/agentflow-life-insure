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
/* ─── Props ─── */

export interface CampaignSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  // Form state
  isUnlimited: boolean;
  setIsUnlimited: (v: boolean) => void;
  maxAttemptsValue: number;
  setMaxAttemptsValue: (v: number) => void;
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
  // Loading / saving
  loading: boolean;
  saving: boolean;
  onSave: () => void;
}

/* ─── Component ─── */

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
            {/* Max Attempts */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Call Attempts</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={isUnlimited ? "" : maxAttemptsValue}
                  disabled={isUnlimited}
                  onChange={(e) => setMaxAttemptsValue(Number(e.target.value))}
                  className="w-20 rounded border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-40"
                  placeholder="3"
                />
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isUnlimited}
                    onChange={(e) => setIsUnlimited(e.target.checked)}
                    className="accent-primary"
                  />
                  Unlimited
                </label>
              </div>
            </div>

            {/* Calling Hours */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Calling Hours (local lead time)</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={callingHoursStart}
                  onChange={(e) => setCallingHoursStart(e.target.value)}
                  className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <input
                  type="time"
                  value={callingHoursEnd}
                  onChange={(e) => setCallingHoursEnd(e.target.value)}
                  className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Retry Interval */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Retry Interval (hours)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={168}
                  value={retryIntervalHours}
                  onChange={(e) => setRetryIntervalHours(Math.max(0, Number(e.target.value)))}
                  className="w-24 rounded border border-input bg-background px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  {retryIntervalHours === 0 ? "(Immediate retry)" : ""}
                </span>
              </div>
            </div>

            {/* Ring Timeout */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Ring Timeout (seconds)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={ringTimeoutValue}
                  onChange={(e) => setRingTimeoutValue(Number(e.target.value))}
                  className="w-24 rounded border border-input bg-background px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-muted-foreground">(Hangs up if no answer)</span>
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-4 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Auto-Dial</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settingsAutoDialEnabled}
                  onClick={() => setSettingsAutoDialEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    settingsAutoDialEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      settingsAutoDialEnabled ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Local Presence</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={localPresenceEnabled}
                  onClick={() => setLocalPresenceEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    localPresenceEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      localPresenceEnabled ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? "Saving\u2026" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
