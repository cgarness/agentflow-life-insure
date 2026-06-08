import React, { useMemo } from "react";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_SETTINGS_COPY } from "./campaignSettingsSchema";
import {
  SETTINGS_EDIT_POLICY_LABELS,
  settingsAccessPolicyOptions,
  type SettingsEditPolicy,
} from "@/lib/campaign-settings-permissions";
import CampaignUserPicker, { type PickerProfile } from "./CampaignUserPicker";

interface CampaignSettingsAccessSectionProps {
  policy: SettingsEditPolicy;
  onPolicyChange: (p: SettingsEditPolicy) => void;
  selectedUserIds: string[];
  onToggleUser: (userId: string) => void;
  /** Same-org profiles only (caller scopes the list). */
  orgProfiles: PickerProfile[];
  /** D5: only Admin / super admin may choose 'admins_only'. */
  isAdminOrSuper: boolean;
  disabled?: boolean;
}

/**
 * "Settings Access" — pick who may edit this campaign's calling settings, and
 * (for 'specific_users') which same-org teammates are granted. UX only; the
 * server enforces via the trigger + update_campaign_settings RPC + RLS.
 */
export default function CampaignSettingsAccessSection({
  policy,
  onPolicyChange,
  selectedUserIds,
  onToggleUser,
  orgProfiles,
  isAdminOrSuper,
  disabled = false,
}: CampaignSettingsAccessSectionProps) {
  const options = settingsAccessPolicyOptions(isAdminOrSuper);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of orgProfiles) m.set(p.id, p.name);
    return m;
  }, [orgProfiles]);

  return (
    <div className="space-y-3 pt-2 border-t">
      <div className="space-y-1">
        <label className="text-sm font-medium">{CAMPAIGN_SETTINGS_COPY.accessLabel}</label>
        <p className="text-xs text-muted-foreground">{CAMPAIGN_SETTINGS_COPY.accessHelper}</p>
      </div>

      <Select
        value={policy}
        onValueChange={(v) => onPolicyChange(v as SettingsEditPolicy)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[300]">
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {SETTINGS_EDIT_POLICY_LABELS[opt]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {policy === "specific_users" && (
        <div className="space-y-2">
          <CampaignUserPicker
            profiles={orgProfiles}
            selectedIds={selectedUserIds}
            onToggle={onToggleUser}
            placeholder={CAMPAIGN_SETTINGS_COPY.pickerPlaceholder}
            emptyText={CAMPAIGN_SETTINGS_COPY.pickerEmpty}
            disabled={disabled}
          />
          {selectedUserIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedUserIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1 pr-1">
                  {nameById.get(id) ?? "Unknown"}
                  <button
                    type="button"
                    onClick={() => onToggleUser(id)}
                    aria-label={`Remove ${nameById.get(id) ?? "user"}`}
                    className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
