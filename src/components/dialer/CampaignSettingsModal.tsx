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
import { CallingWindowField, MaxAttemptsField, NumberField, RetryIntervalField, ToggleRow } from "./campaignSettingsControls";
import CampaignSettingsAccessSection from "./CampaignSettingsAccessSection";
import { type PickerProfile } from "./CampaignUserPicker";
import { type SettingsEditPolicy } from "@/lib/campaign-settings-permissions";

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
  /** Canonical retry interval in minutes (campaigns.retry_interval_minutes). */
  retryIntervalMinutes: number;
  setRetryIntervalMinutes: (v: number) => void;
  ringTimeoutValue: number;
  setRingTimeoutValue: (v: number) => void;
  settingsAutoDialEnabled: boolean;
  setSettingsAutoDialEnabled: (fn: (v: boolean) => boolean) => void;
  localPresenceEnabled: boolean;
  setLocalPresenceEnabled: (fn: (v: boolean) => boolean) => void;
  // Licensed-state access (Build 2b); canEditSettings gates the toggle (mirrors can_edit_campaign_settings).
  // licensedStateApplicable=false for Personal campaigns (queue RPCs don't filter them).
  requireLicensedStateAccess: boolean;
  setRequireLicensedStateAccess: (fn: (v: boolean) => boolean) => void;
  canEditSettings?: boolean;
  licensedStateApplicable?: boolean;
  /** True when a call/wrap-up is in progress — saved settings apply to the next call. */
  sessionActive?: boolean;
  /** Inline validation error surfaced from the save attempt (Zod). */
  errorMessage?: string | null;
  // ── Settings Access (edit-permission model) ──
  settingsEditPolicy: SettingsEditPolicy;
  setSettingsEditPolicy: (p: SettingsEditPolicy) => void;
  settingsGrantUserIds: string[];
  onToggleGrantUser: (userId: string) => void;
  /** Same-org profiles only (caller scopes the list). */
  orgProfiles: PickerProfile[];
  /** True for Admin / super admin — gates the 'admins_only' option (D5). */
  isAdminOrSuper: boolean;
  loading: boolean;
  saving: boolean;
  onSave: () => void;
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
  retryIntervalMinutes,
  setRetryIntervalMinutes,
  ringTimeoutValue,
  setRingTimeoutValue,
  settingsAutoDialEnabled,
  setSettingsAutoDialEnabled,
  localPresenceEnabled,
  setLocalPresenceEnabled,
  requireLicensedStateAccess,
  setRequireLicensedStateAccess,
  canEditSettings = true,
  licensedStateApplicable = true,
  sessionActive = false,
  errorMessage,
  settingsEditPolicy,
  setSettingsEditPolicy,
  settingsGrantUserIds,
  onToggleGrantUser,
  orgProfiles,
  isAdminOrSuper,
  loading,
  saving,
  onSave,
}: CampaignSettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Viewport-bounded frame: header, error and footer stay put; only the settings scroll. */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-lg p-0">
        <DialogHeader className="shrink-0 border-b pb-4 pl-4 pr-12 pt-5 text-left sm:pl-6">
          <DialogTitle>Calling Settings</DialogTitle>
          <DialogDescription className="break-words">
            Configure call attempt limits and scheduling for{" "}
            <span className="font-semibold" title={campaignName}>{campaignName}</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Radix's focus trap wraps Tab with preventScroll; keep the focused control in view.
            The contains() check skips focus bubbling up from portaled Select/Popover content. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
          onFocus={(e) => { if (e.currentTarget.contains(e.target)) e.target.scrollIntoView?.({ block: "nearest" }); }}
        >
          {loading ? (
            <div role="status" aria-label="Loading calling settings" className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-5">
              {sessionActive && (
                <p className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {CAMPAIGN_SETTINGS_COPY.sessionActiveNote}
                </p>
              )}

              <MaxAttemptsField
                isUnlimited={isUnlimited}
                onUnlimitedChange={setIsUnlimited}
                value={maxAttemptsValue}
                onChange={setMaxAttemptsValue}
              />

              <CallingWindowField
                start={callingHoursStart}
                end={callingHoursEnd}
                onStartChange={setCallingHoursStart}
                onEndChange={setCallingHoursEnd}
              />

              <RetryIntervalField
                minutes={retryIntervalMinutes}
                onChange={setRetryIntervalMinutes}
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
                <ToggleRow label={CAMPAIGN_SETTINGS_COPY.requireLicensedStateLabel} helper={licensedStateApplicable ? CAMPAIGN_SETTINGS_COPY.requireLicensedStateHelper : CAMPAIGN_SETTINGS_COPY.requireLicensedStateNotApplicable} checked={licensedStateApplicable && requireLicensedStateAccess} disabled={!canEditSettings || !licensedStateApplicable} onToggle={() => setRequireLicensedStateAccess((v) => !v)} />
              </div>

              <CampaignSettingsAccessSection
                policy={settingsEditPolicy}
                onPolicyChange={setSettingsEditPolicy}
                selectedUserIds={settingsGrantUserIds}
                onToggleUser={onToggleGrantUser}
                orgProfiles={orgProfiles}
                isAdminOrSuper={isAdminOrSuper}
                disabled={saving}
              />
            </div>
          )}
        </div>

        {/* Pinned above the buttons so a save/validation error is never scrolled out of view. */}
        <div className="shrink-0 space-y-2 border-t px-4 py-3 sm:px-6">
          {!loading && errorMessage && <p role="alert" className="text-xs font-medium text-destructive">{errorMessage}</p>}
          <DialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving || loading}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
