import { User, UserProfile } from "@/lib/types";
import type { HierarchyPersonOption } from "@/lib/hierarchy/uplineCandidates";

export type UserWithProfile = User & { profile: UserProfile };

export type LicensedStateEntry = { state: string; licenseNumber: string };

export type ConfirmDialogState = {
  open: boolean;
  user: UserWithProfile | null;
  action: "deactivate" | "reactivate";
};

/**
 * An Invite modal manager choice: an Active Admin / Team Leader of the organization from
 * `loadInviteManagerCandidates` — independent of the Team Members table filters.
 */
export type ManagerOption = HierarchyPersonOption;
