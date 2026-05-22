import { User, UserProfile } from "@/lib/types";

export type UserWithProfile = User & { profile: UserProfile };

export type LicensedStateEntry = { state: string; licenseNumber: string };

export type ConfirmDialogState = {
  open: boolean;
  user: UserWithProfile | null;
  action: "deactivate" | "reactivate";
};
