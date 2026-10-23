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
 * Both steps read their row back, so an UPDATE that RLS filtered to zero rows is a failure,
 * never a false success. A step 1 failure therefore means NOTHING was written (the save
 * rejects with the database message).
 *
 * Remaining partial-save case (documented and tested): step 1 committed and step 2 failed — a
 * database guard raced the check (a concurrent move made the choice a cycle), the network
 * dropped, or RLS refused the row. The result then carries `partialError` and a
 * `partialMessage` naming exactly what step 1 saved and what step 2 did not; the caller shows
 * it and re-reads the member list instead of applying an optimistic patch.
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
  /** With `partialError`: which fields step 1 saved, which step 2 did not, and why. */
  partialMessage: string | null;
}

const STEP_1_LABELS: Record<string, string> = {
  firstName: "name", lastName: "name", email: "email", phone: "phone", avatar: "photo",
  role: "role", status: "status", isSuperAdmin: "Super Admin access",
};
const STEP_2_LABELS: Record<string, string> = {
  licensedStates: "licensed states", residentState: "resident state", npn: "NPN", timezone: "timezone",
  carriers: "carriers", uplineId: "upline", commissionLevel: "commission level",
};
const labelsOf = (payload: object, labels: Record<string, string>) =>
  [...new Set(Object.keys(payload).map((key) => labels[key]).filter(Boolean))].join(", ") || "nothing";

/** The partial-save toast text: step 1 committed (read back), step 2 was refused. */
export function partialSaveMessage(saved: object, notSaved: object, error: unknown): string {
  const reason = (error as { message?: string } | null)?.message || "An unknown error occurred";
  return `Saved: ${labelsOf(saved, STEP_1_LABELS)}. Not saved: ${labelsOf(notSaved, STEP_2_LABELS)}. ${reason} ` +
    "The member list has been reloaded.";
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

  // Rejects (nothing written) on an error or a zero-row read-back.
  await usersSupabaseApi.update(user.id, userUpdates);
  try {
    await usersSupabaseApi.updateProfile(user.id, profileUpdates);
  } catch (e) {
    return { patch: { id: user.id }, partialError: e, partialMessage: partialSaveMessage(userUpdates, profileUpdates, e) };
  }

  return {
    patch: {
      id: user.id,
      ...userUpdates,
      profile: { ...profileUpdates } as UserWithProfile["profile"],
    },
    partialError: null,
    partialMessage: null,
  };
}
