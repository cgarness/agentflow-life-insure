# Implementation Plan — Phone Assignment Pass 3

**Owner:** Chris Garness · **Branch:** `claude/phone-assignment-pass-3-Pwiyt` · **Date:** 2026-06-04
**Status:** AWAITING APPROVAL — no files will be edited until Chris approves.

---

## Goal

Complete the Settings → Phone System → Phone Numbers role-management UI so admins can
safely flip a number between **Agency** (shared outbound pool) and **Personal** (owner-only),
preserving the caller-ID enforcement already live in `TwilioContext` / `caller-id-selection`
(invariant #18). Replace stale "next pass" copy. Align Number Groups with role behavior.

**No DB migration.** `phone_numbers.assignment_type` + the three CHECK constraints already exist
on prod (invariant #18). `number_group_members` has **no `organization_id`** column.

---

## Current state (verified by reading)

- `NumberManagementSection.tsx` shows a **read-only** Agency/Personal badge with the stale tooltip
  `"Phone number assignment enforcement is being added in the next pass."` (lines 30-33, 714-716).
- `handleAssign` lets `assigned_to` be cleared to `null` with **no Personal guard** (lines 182-222).
- `handleSetDefault` blocks non-active but has **no Personal guard** (lines 116-162); the default
  radio is disabled only when `!isActive`.
- `NumberGroupMembersModal.tsx` eligible filter = `status active && !is_direct_line` only — it does
  **not** exclude Personal numbers (lines 32-38).
- `caller-id-selection.ts` already exports `isAgencyCallerIdEligible` (status+agency, no daily cap).
- Stale-string sweep: the only **stale user-facing** hit is the tooltip above. The `Pass 2` comments
  in `TwilioContext`/`caller-id-selection`/`FloatingDialer`/`ConversationHistory` are **accurate**
  descriptions of shipped enforcement — leave them. `CallMonitoring.tsx` "coming soon" is a
  different (call-monitoring) feature — leave it. Baseline `npx tsc --noEmit` = clean.

---

## Files to touch

| File | Change |
|------|--------|
| `implementation_plan.md` | this plan |
| `src/components/settings/phone/phoneNumberRoleMutations.ts` | **NEW** — `changePhoneNumberToPersonal` / `changePhoneNumberToAgency` |
| `src/components/settings/phone/PhoneNumberRoleModal.tsx` | **NEW** — Zod-validated role-change modal |
| `src/components/settings/phone/NumberManagementSection.tsx` | replace stale tooltip/comments; admin role control (clickable badge -> modal); Personal guards in `handleAssign` + `handleSetDefault`; wire modal |
| `src/components/settings/phone/NumberGroupMembersModal.tsx` | eligible filter = active + **agency** + not direct-line (local predicate, NOT daily-cap helper); helper text |
| `src/components/settings/phone/NumberGroupsSection.tsx` | copy: note Personal numbers excluded (and drop duplicate `useAuth` import while here) |
| `WORK_LOG.md` | newest-first entry |

**Will NOT touch:** `TwilioContext.tsx`, `caller-id-selection.ts` (no concrete bug found),
`numberGroupMutations.ts` logic, Supabase migrations, Edge Functions, production data.

---

## Detail

### 1. `phoneNumberRoleMutations.ts` (NEW)
- `changePhoneNumberToPersonal({ phoneNumberId, organizationId, ownerId })`:
  1. `update phone_numbers set assignment_type='personal', assigned_to=ownerId, is_default=false`
     `.eq("id").eq("organization_id").select("id").maybeSingle()` — the returned row both confirms
     the number belongs to the org and gives a clean no-row error path.
  2. Only after that confirmation: `delete number_group_members .eq("phone_number_id", id)`
     — **by `phone_number_id` only** (table has no `organization_id`; org already confirmed in step 1).
- `changePhoneNumberToAgency({ phoneNumberId, organizationId })`:
  - `update phone_numbers set assignment_type='agency' .eq id .eq organization_id`.
  - Does **not** touch `assigned_to`, `is_default`, or group membership.
- Both return `{ error: string | null }`.

### 2. `PhoneNumberRoleModal.tsx` (NEW, Zod, shadcn/Radix, Tailwind)
- Props: `open`, `onOpenChange`, `phoneNumber`, `agents`, `organizationId`, `onUpdated`.
- Zod: `assignment_type in {agency, personal}`; when `personal`, `assigned_to` required (non-empty).
- UI: shows current role; control for target role; owner Select (defaults to existing `assigned_to`)
  shown when Personal.
- Agency->Personal confirmation copy (verbatim): "This will make the number owner-only, remove it
  from automatic dialer/local-presence rotation, clear default status if set, and remove it from
  campaign number groups." Plus a default-clear warning when `is_default`.
- Personal->Agency: explains `assigned_to` on an Agency number is administrative/display only, is not
  made default, and is not auto-added to groups.
- On save -> role mutation -> toast -> `logActivity` -> `onUpdated()` -> close.

### 3. `NumberManagementSection.tsx`
- Delete stale `ASSIGNMENT_ROLE_TOOLTIP` + Pass-1 comment; add accurate role tooltips (Agency /
  Personal copy above).
- Admin: render the badge as a button -> opens `PhoneNumberRoleModal` (`roleModalTarget` state).
  Non-admin: unchanged read-only badge + accurate tooltip.
- `handleSetDefault`: if `target.assignment_type === 'personal'` -> block: "Personal numbers cannot be
  default caller IDs because they are owner-only and excluded from automatic rotation."; also disable
  the default radio for Personal rows.
- `handleAssign`: if clearing to `null` while `assignment_type === 'personal'` -> block: "Personal
  numbers must have an assigned owner. Change this number back to Agency before clearing assignment."
- Existing assigned Agency rows keep showing **Agency** (badge keyed off `assignment_type==='personal'`,
  never off `assigned_to`).

### 4. `NumberGroupMembersModal.tsx`
- `eligible` filter -> `status==='active' && (assignment_type ?? 'agency')==='agency' && is_direct_line !== true`,
  with an explicit comment that it deliberately avoids `isAutomaticCallerIdAllowed()` (daily-cap) so a
  capped Agency number never disappears from group management.
- DialogDescription / empty-state: "Personal numbers and direct lines are excluded from campaign number groups."

### 5. `NumberGroupsSection.tsx`
- Header helper line: add Personal exclusion. Remove duplicate `useAuth` import (lines 5 & 19).

---

## Verification
- Repo search: stale tooltip gone outside archives.
- Agency->Personal requires owner; clears default; removes group memberships (by `phone_number_id`, no `organization_id`).
- Personal->Agency keeps `assigned_to`; no auto-default; no auto-group.
- Personal can't be default from UI; clearing Personal owner blocked with copy.
- Group modal excludes Personal + direct lines; filter independent of `daily_call_count/limit`.
- Agency-with-`assigned_to` still behaves as Agency; automatic caller-ID + manual From-number lists unchanged.
- `npx tsc --noEmit` clean; WORK_LOG.md newest-first; context snapshot.

---

## Decisions / out of scope
- D1: group eligibility -> **local predicate** (PhoneNumberRow lacks the `daily_call_*` fields
  `CallerIdPhoneRow` requires, and we must avoid the daily-cap path anyway).
- D2: role control surface -> **clickable badge** for admins (keeps `NumberManagementSection` small;
  logic in the new modal/helper).
- User-delete / Personal-number FK edge case (`assigned_to` ON DELETE SET NULL could orphan a Personal
  number into an invalid state) is **out of scope** — WORK_LOG.md note only.
