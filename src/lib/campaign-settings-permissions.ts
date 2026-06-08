/**
 * Campaign "Settings Access" — client-side permission model.
 *
 * `canEditCampaignSettings` is a UX-ONLY mirror of the SQL function
 * `public.can_edit_campaign_settings(uuid)`. The server is the source of truth
 * for enforcement (the BEFORE UPDATE trigger on `campaigns`, the
 * `update_campaign_settings` SECURITY DEFINER RPC, and RLS on
 * `campaign_settings_permissions`). This helper only decides whether to
 * show/enable the settings gear and pre-block a save for nicer UX.
 *
 * ⚠️ Deliberate client/server logic duplication — keep this in lockstep with the
 * `can_edit_campaign_settings` migration (noted in WORK_LOG).
 */

export const SETTINGS_EDIT_POLICIES = [
  "creator_and_admins",
  "admins_only",
  "team_leaders",
  "specific_users",
] as const;

export type SettingsEditPolicy = (typeof SETTINGS_EDIT_POLICIES)[number];

export const SETTINGS_EDIT_POLICY_LABELS: Record<SettingsEditPolicy, string> = {
  creator_and_admins: "Only creator and admins",
  admins_only: "Admins only",
  team_leaders: "Creator, admins, and team leaders",
  specific_users: "Creator, admins, and selected people",
};

export interface CampaignAccessShape {
  id: string;
  organization_id?: string | null;
  user_id?: string | null;
  settings_edit_policy?: string | null;
}

export interface ProfileAccessShape {
  id?: string | null;
  role?: string | null;
  organization_id?: string | null;
  is_super_admin?: boolean | null;
}

/** Normalize a possibly-missing policy to the safe default. */
export function normalizeSettingsEditPolicy(
  value: string | null | undefined,
): SettingsEditPolicy {
  return (SETTINGS_EDIT_POLICIES as readonly string[]).includes(value ?? "")
    ? (value as SettingsEditPolicy)
    : "creator_and_admins";
}

/**
 * UX-only mirror of `public.can_edit_campaign_settings`. Same evaluation order:
 * super admin (own org) → org isolation → Admin → owner (unless admins_only) →
 * Team Leader under team_leaders → explicit grant (team_leaders|specific_users).
 *
 * @param grantedCampaignIds set of campaign ids the CURRENT user holds an
 *        `edit_settings` grant for.
 */
export function canEditCampaignSettings(
  campaign: CampaignAccessShape | null | undefined,
  profile: ProfileAccessShape | null | undefined,
  grantedCampaignIds: Set<string>,
): boolean {
  if (!campaign || !profile) return false;

  const uid = profile.id ?? null;
  const myOrg = profile.organization_id ?? null;
  const campaignOrg = campaign.organization_id ?? null;

  // Super admin scoped to their own org.
  if (profile.is_super_admin === true && campaignOrg != null && campaignOrg === myOrg) {
    return true;
  }

  // Hard org isolation (null org → blocked).
  if (campaignOrg == null || campaignOrg !== myOrg) return false;

  // Admins always — creators cannot lock admins out.
  if (profile.role === "Admin") return true;

  const policy = normalizeSettingsEditPolicy(campaign.settings_edit_policy);
  const isOwner = uid != null && campaign.user_id === uid;

  // Creator/owner — allowed unless the policy is admins_only.
  if (
    isOwner &&
    (policy === "creator_and_admins" || policy === "team_leaders" || policy === "specific_users")
  ) {
    return true;
  }

  // Team Leaders when the policy opens to them ('Team Lead' = defensive alias).
  if (policy === "team_leaders" && (profile.role === "Team Leader" || profile.role === "Team Lead")) {
    return true;
  }

  // Explicit per-user grant (team_leaders or specific_users).
  if (
    (policy === "team_leaders" || policy === "specific_users") &&
    grantedCampaignIds.has(campaign.id)
  ) {
    return true;
  }

  return false;
}

/**
 * Policy options the current user may CHOOSE in the dropdown.
 * D5: `admins_only` is offered only to Admins / super admins (UI-only restriction;
 * it remains valid in the DB CHECK and in `can_edit_campaign_settings`).
 */
export function settingsAccessPolicyOptions(isAdminOrSuper: boolean): SettingsEditPolicy[] {
  return isAdminOrSuper
    ? [...SETTINGS_EDIT_POLICIES]
    : SETTINGS_EDIT_POLICIES.filter((p) => p !== "admins_only");
}
