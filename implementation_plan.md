# User Management Pass 2 — REFACTOR Implementation Plan

**Owner:** Chris Garness | **Branch:** `claude/fervent-pascal-htCFg` | **Status:** awaiting approval

---

## A. Delete-path verification (FINDING)

**Current code (src/lib/supabase-users.ts:439–450) HARD DELETES `profiles`:**
```ts
async deleteUser(id, transferToUserId?) {
  if (transferToUserId) { await leadsSupabaseApi.reassignAllContacts(...) }
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw error;
}
```

**Fix:** Replace `.delete()` with soft-delete update:
```ts
await supabase.from("profiles").update({
  status: "Deleted",
  availability_status: "Offline",
  updated_at: new Date().toISOString(),
}).eq("id", id);
```
- Transfer/reassign logic runs first (unchanged).
- No auth user deletion.
- No related-row deletion.
- `getAll()` already filters out `status="Deleted"` (line 79), so soft-deleted rows disappear from UI.

---

## B. Split UserManagement.tsx → `src/components/settings/user-management/`

Current monolith (1,850 lines) decomposes into:

| File | Purpose |
|------|---------|
| `UserManagement.tsx` (kept in place; small orchestrator, ~150 lines) | State, tab switcher, modals wiring |
| `user-management/UserManagementHeader.tsx` | Title + "Invite New Agent" button |
| `user-management/UserManagementTabs.tsx` | Team Members / Pending Invites / Hierarchy tablist |
| `user-management/TeamMembersTable.tsx` | Search/filter row + table rows + dropdown menu |
| `user-management/PendingInvitesTable.tsx` | Invites list + resend/copy/revoke/delete actions |
| `user-management/InviteUserModal.tsx` | InviteModal (currently inlined ~336–507) |
| `user-management/UserProfileModal.tsx` | Dialog shell + tab container (~509–1240) |
| `user-management/UserProfileTab.tsx` | Profile fields, avatar, role, status, licensed states |
| `user-management/UserGoalsTab.tsx` | Goal sliders / inputs |
| `user-management/UserOnboardingTab.tsx` | Onboarding checklist |
| `user-management/UserPerformanceTab.tsx` | Performance KPIs |
| `user-management/UserTeamTab.tsx` | "My Team" tab (Team Leader downline) |
| `user-management/UserManagementConfirmDialogs.tsx` | Deactivate/Reactivate + Reset password + Delete confirms |
| `user-management/StateMultiSelect.tsx` | Pulled from lines 87–174 |
| `user-management/SingleStateSelect.tsx` | Pulled from lines 176–241 |
| `user-management/AvatarUploadPreview.tsx` | Pulled from lines 243–334 (behavior preserved exactly) |
| `user-management/userManagementTypes.ts` | `UserWithProfile` and shared types |
| `user-management/userManagementUtils.ts` | `formatDate`, `goalColor`, `US_STATES`, `US_STATE_NAMES`, badge maps |

Target: each new file < 200 lines where practical. If `UserProfileModal.tsx` still exceeds 200 lines after extracting tabs, the tabs themselves absorb more (modal stays a thin shell).

---

## C. Centralize mutations in `src/lib/supabase-users.ts`

New helper methods to add:

```ts
updateBillingType(userId, billingType: 'agency_covered' | 'self_pay'): Promise<void>
assignUpline(userId, uplineId: string | null): Promise<void>
removeFromTeam(userId): Promise<void>          // sets upline_id = null
updateOnboardingItems(userId, items): Promise<void>
updateGoals(userId, goals): Promise<void>      // thin wrapper over updateProfile()
```

Replace direct `supabase.from('profiles').update(...)` calls in components:
- `UserManagement.tsx:1617` (billing) → `usersApi.updateBillingType(...)`
- Any upline/team-assignment in `UserProfileTab` → `usersApi.assignUpline(...)`
- Goals / onboarding tab saves → typed helpers above

Read-only fetches (e.g., teamMembers in My Team tab) may remain inline.

---

## D. `.single()` → `.maybeSingle()`

| Location | Current | Action |
|----------|---------|--------|
| `supabase-users.ts:138` (getById main) | `.single()` | `.maybeSingle()` + null check → throw `"User not found"` |
| `supabase-users.ts:146` (getById safe-fallback) | `.single()` | `.maybeSingle()` + null check |
| `supabase-users.ts:320` (resendInvite lookup) | `.single()` | `.maybeSingle()` + clear "Invitation not found" error |
| `supabase-users.ts:354` (createInvitation insert returning token) | `.single()` | Keep — INSERT always returns one row; zero-row IS an error |

`supabase-contacts.ts` `.single()` calls are out of scope.

---

## E. Out of scope (per task)

- Licensing source-of-truth / `profiles.licensed_states` behavior — unchanged
- `agent_state_licenses` migration — deferred
- Supabase Storage / avatar migration — deferred (AvatarUpload UI preserved)
- Email auth/profile sync — deferred
- Schema changes / migrations — none
- Zod validation tightening — deferred

---

## Files to touch

**New:**
- `src/components/settings/user-management/UserManagementHeader.tsx`
- `src/components/settings/user-management/UserManagementTabs.tsx`
- `src/components/settings/user-management/TeamMembersTable.tsx`
- `src/components/settings/user-management/PendingInvitesTable.tsx`
- `src/components/settings/user-management/InviteUserModal.tsx`
- `src/components/settings/user-management/UserProfileModal.tsx`
- `src/components/settings/user-management/UserProfileTab.tsx`
- `src/components/settings/user-management/UserGoalsTab.tsx`
- `src/components/settings/user-management/UserOnboardingTab.tsx`
- `src/components/settings/user-management/UserPerformanceTab.tsx`
- `src/components/settings/user-management/UserTeamTab.tsx`
- `src/components/settings/user-management/UserManagementConfirmDialogs.tsx`
- `src/components/settings/user-management/StateMultiSelect.tsx`
- `src/components/settings/user-management/SingleStateSelect.tsx`
- `src/components/settings/user-management/AvatarUploadPreview.tsx`
- `src/components/settings/user-management/userManagementTypes.ts`
- `src/components/settings/user-management/userManagementUtils.ts`

**Modified:**
- `src/components/settings/UserManagement.tsx` — slim orchestrator
- `src/lib/supabase-users.ts` — soft delete + `.maybeSingle()` + new mutation helpers
- `WORK_LOG.md` — append entry (newest first)

**No schema / no migrations / no Edge deploys.**

---

## Verification

1. `npx tsc --noEmit` clean.
2. `npm test` (vitest).
3. Manual UI checks documented in WORK_LOG for Chris to run (no host browser in container).

---

## Risks

- **UserProfileModal split risk:** original modal has interlinked state (avatar, profile, goals, onboarding, performance, team). Plan: modal owns state; tabs receive props + emit onChange (presentational).
- **Real-time invitations channel** subscription stays in PendingInvitesTable.
- **Impersonation flow** in row dropdown moves to TeamMembersTable; `startImpersonation` from auth context still wired.
