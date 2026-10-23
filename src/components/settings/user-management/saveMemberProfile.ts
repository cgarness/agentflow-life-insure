/**
 * Settings → User Management → member profile "Save Changes" (hierarchy stabilization F1).
 *
 * The save is two PATCHes on `profiles`, built by `buildProfileSavePayload`:
 *   step 1 `usersSupabaseApi.update` — name, contact, avatar and, only when changed AND
 *          editable, role / status / Super Admin flag;
 *   step 2 `usersSupabaseApi.updateProfile` — licences, resident state, NPN, timezone,
 *          carriers and, only when changed AND editable, upline / commission level.
 * An untouched upline or commission level is never in the SET list, so an ordinary save no
 * longer fires the `UPDATE OF upline_id` hierarchy triggers or the commission guard.
 *
 * A CHANGED upline is re-validated against a fresh `loadUplineCandidates` read before step 1:
 * an upline the picker should no longer offer (now beneath the member, deactivated, demoted,
 * another organization) stops the save before anything is written, instead of after a
 * committed role / status change. A candidate read failure stops it too (fail closed).
 * "None" needs no check. This is a UI precondition; the database guards stay the authority.
 *
 * Remaining partial-save case (documented and tested): step 1 commits and step 2 fails — a
 * database guard raced the check (a concurrent move made the choice a cycle), the network
 * dropped, or RLS refused the row. The result then carries `partialError`; the caller says
 * some changes were not saved, shows the database message, and re-reads the member list
 * instead of applying an optimistic patch.
 */
import { z } from "zod";
import { usersSupabaseApi } from "@/lib/supabase-users";
import { loadUplineCandidates } from "@/lib/hierarchy/uplineCandidates";
import {
  buildProfileSavePayload,
  type ProfileSaveForm,
  type ProfileSaveViewer,
} from "@/lib/user-management/profileSavePayload";
import type { UserWithProfile } from "./userManagementTypes";

export const UPLINE_NOT_AVAILABLE =
  "The selected upline can no longer be chosen for this member. Pick another upline and save again.";

const optionalText = z.string().optional();
/** What the profile form must satisfy before anything is written (AGENT_RULES §7). */
export const memberProfileFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: optionalText.nullable(),
  uplineId: z.union([z.string().uuid("Choose an upline from the list"), z.literal("_none"), z.literal("")])
    .nullable().optional(),
  commissionLevel: z.string().trim().max(32, "Commission level is too long").nullable().optional(),
});

export interface SaveMemberProfileResult {
  /** What was written, for the parent list; only meaningful when `partialError` is null. */
  patch: Partial<UserWithProfile>;
  /** Step 2 failed after step 1 committed; the caller must re-read rather than patch. */
  partialError: unknown | null;
}

export async function saveMemberProfile(params: {
  user: UserWithProfile;
  form: ProfileSaveForm;
  viewer: ProfileSaveViewer;
  /** The organization the member list was loaded for (the member's organization). */
  organizationId: string | null;
}): Promise<SaveMemberProfileResult> {
  const { user, viewer } = params;
  const parsed = memberProfileFormSchema.safeParse(params.form);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const form: ProfileSaveForm = {
    ...params.form,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    email: parsed.data.email,
  };
  const { userUpdates, profileUpdates } = buildProfileSavePayload(user, form, viewer);

  const nextUpline = profileUpdates.uplineId;
  if (typeof nextUpline === "string") {
    const { candidates } = await loadUplineCandidates({
      targetId: user.id,
      organizationId: user.profile.organizationId ?? params.organizationId,
      currentUplineId: user.profile.uplineId ?? null,
    });
    if (!candidates.some((c) => c.id === nextUpline)) throw new Error(UPLINE_NOT_AVAILABLE);
  }

  await usersSupabaseApi.update(user.id, userUpdates);
  try {
    await usersSupabaseApi.updateProfile(user.id, profileUpdates);
  } catch (e) {
    return { patch: { id: user.id }, partialError: e };
  }

  return {
    patch: {
      id: user.id,
      ...userUpdates,
      profile: { ...profileUpdates } as UserWithProfile["profile"],
    },
    partialError: null,
  };
}
