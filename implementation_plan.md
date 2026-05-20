# Implementation Plan — Phase 2d+2e: Number Groups UI + Phone Numbers Tab Redesign

**Branch:** `claude/number-groups-management-ui-pybVM`
**Owner:** Chris Garness
**Date:** 2026-05-20

---

## 1. Goal

Build the admin UI for Number Groups (create / edit / delete / assign numbers) and redesign the Phone Numbers tab to expose direct lines and group membership inline.

Schema (Phase 2a) is already live:
- `number_groups (id, organization_id, name, description, ...)`
- `number_group_members (id, number_group_id, phone_number_id)` — multi-group allowed
- `phone_numbers.is_direct_line boolean default false`
- `phone_numbers.voicemail_greeting_url text null`
- `campaigns.number_group_id uuid null` (FK → `number_groups`, ON DELETE SET NULL)

---

## 2. New Files

| File | Approx LOC | Responsibility |
|------|-----------|----------------|
| `src/components/settings/phone/numberGroupsSchema.ts` | ~20 | Zod schema for create/edit group form (`name` 1–100, `description` ≤500). |
| `src/components/settings/phone/NumberGroupsSection.tsx` | ~140 | Top-level section: header, "+ Create Group", list of `NumberGroupCard`s, owns modal state (create / edit / delete / members). Renders only for Admin / Team Leader / Super Admin write actions. |
| `src/components/settings/phone/NumberGroupCard.tsx` | ~160 | One group card: name + description, "X numbers" / "Y campaigns" counts, expand/collapse showing member list with phone + friendly_name, edit/delete buttons, "Add Numbers" button. |
| `src/components/settings/phone/NumberGroupFormModal.tsx` | ~120 | Create + edit modal (single component, mode prop). Uses `react-hook-form` + `zodResolver`. Inserts/updates `number_groups`. |
| `src/components/settings/phone/NumberGroupMembersModal.tsx` | ~150 | Assign numbers to group. Lists all org `phone_numbers` where `is_direct_line = false` and `status = 'active'`. Pre-checks existing members. On save: diff → insert new rows, delete removed rows. |
| `src/components/settings/phone/numberGroupMutations.ts` | ~60 | Shared mutation helpers (`toggleDirectLine`, `removeNumberFromAllGroups`) used by both `NumberManagementSection` and member modal. Keeps business rule (direct line → wipe groups) in one place. |

All new components ≤ 200 LOC.

---

## 3. Modified Files

### `src/components/settings/phone/usePhoneSettingsController.ts` (~+40 LOC)
- Add state: `groups: NumberGroupRow[]`, `groupMembers: NumberGroupMemberRow[]`, `campaignGroupCounts: Record<groupId, number>`.
- Extend `fetchData()` parallel block with 3 more queries:
  - `select * from number_groups where organization_id = orgId order by name`
  - `select id, number_group_id, phone_number_id, phone_numbers(phone_number, friendly_name) from number_group_members where number_group_id IN (...)` — done in a single query with the FK relationship hint.
  - `select number_group_id from campaigns where organization_id = orgId and number_group_id is not null` — aggregate to counts client-side.
- Expose `groups`, `groupMembers`, `campaignGroupCounts`, `setGroups`, `setGroupMembers` from return value.

### `src/components/settings/phone/NumberManagementSection.tsx` (additive, ≤+80 LOC)
- Extend `PhoneNumberRow` interface with `is_direct_line?: boolean`, `voicemail_greeting_url?: string | null`.
- Add new props: `groups: NumberGroupRow[]`, `groupMembers: NumberGroupMemberRow[]`.
- Add 2 new columns to the table:
  - **Direct Line** — small Switch per row. Disabled when `assigned_to == null`; toggling ON triggers `toggleDirectLine(id, true)` which sets `is_direct_line=true` AND deletes every `number_group_members` row for this phone_number. Toggling OFF clears `is_direct_line`. Toast prompts if not assigned.
  - **Groups** — small chip list. If direct line → single "Direct Line" badge. Else → up to 3 group-name chips with `+N` overflow.
- Modify `handleAssign`: if the new `agent_id` is null AND the number is currently a direct line, also set `is_direct_line=false`. Toast: "Direct line cleared (no agent)".
- Add a small `<DirectLineSwitch />` inline (≤25 LOC inside same file, kept local to avoid yet another file).

NumberManagementSection is already 643 LOC (pre-existing violation; not on the AGENT_RULES exception list but also outside this task's scope). New additions are minimal — I won't refactor the rest in this task to keep diff surgical.

### `src/components/settings/PhoneSystem.tsx` (~+10 LOC)
- Inside `TabsContent value="phone-numbers"`, render `<NumberGroupsSection />` below `<LocalPresenceSection />`.
- Pass `organizationId`, `numbers`, `agents`, `groups`, `groupMembers`, `campaignGroupCounts`, `onRefresh`.

---

## 4. Data Flow

```
PhoneSystem.tsx
  └─ usePhoneSettingsController()
       ├─ numbers, agents, secretBundle  (existing)
       └─ groups, groupMembers, campaignGroupCounts  (NEW)

  Phone Numbers Tab:
    NumberManagementSection (table)
      ├─ groups, groupMembers (for Groups column display)
      └─ onRefresh()  ← refetch after direct-line / assignment mutation
    LocalPresenceSection
    NumberGroupsSection (NEW)
      ├─ groups, groupMembers, campaignGroupCounts, numbers
      ├─ NumberGroupCard × N
      │    ├─ Edit → NumberGroupFormModal (mode="edit")
      │    ├─ Delete → AlertDialog (warns if campaigns use it)
      │    └─ Add Numbers → NumberGroupMembersModal
      └─ + Create Group → NumberGroupFormModal (mode="create")
```

All write mutations call `onRefresh()` (which is `phone.fetchData`) to re-pull groups/members; no local cache divergence.

---

## 5. Business Rules

1. **Direct line ⟺ no group membership.** When `is_direct_line` flips true, delete every `number_group_members` row for that phone_number. The Members modal filters out direct-line numbers from the picker list.
2. **Direct line requires assigned agent.** Switch is disabled when `assigned_to is null`. If user attempts to toggle, toast warns first.
3. **Unassigning a direct line clears it.** When `assigned_to` changes to "Unassigned" on a direct-line number, also set `is_direct_line=false`.
4. **Direct line follows agent on reassignment.** When `assigned_to` changes to a different agent, `is_direct_line` stays true (the spec says the direct line follows the new agent).
5. **Group deletion warns about campaigns.** AlertDialog body: "This group is used by {X} campaigns. Those campaigns will fall back to using all org numbers." (FK is `ON DELETE SET NULL` per Phase 2a migration.)
6. **Multi-group membership allowed.** Member modal only toggles membership for the current group; checking/unchecking does NOT touch other groups' membership.
7. **Write gating.** Create/Edit/Delete/AddNumbers buttons hidden unless `profile.role ∈ {"Admin", "Team Leader"} || profile.is_super_admin`. RLS already enforces server-side.

---

## 6. Validation (Zod)

```ts
export const numberGroupFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Max 100 characters"),
  description: z.string().trim().max(500, "Max 500 characters").optional().or(z.literal("")),
});
```

Wired via `useForm` + `zodResolver` + `Form*` shadcn components for inline error display.

---

## 7. Verification Checklist

- [ ] `npx tsc --noEmit` clean.
- [ ] Phone Numbers table shows Direct Line column (toggle) and Groups column (chips).
- [ ] Toggling Direct Line ON immediately removes the number from any groups it was in (member modal re-open confirms).
- [ ] Toggling Direct Line ON without `assigned_to` shows the toast and does not flip.
- [ ] Setting `assigned_to=Unassigned` on a direct line clears `is_direct_line`.
- [ ] Create Group modal validates empty name and >100 char name.
- [ ] Delete confirmation correctly references campaign count and only deletes from `number_groups`.
- [ ] Member modal does NOT list direct-line numbers.
- [ ] WORK_LOG.md appended.

---

## 8. Out of Scope (deferred)

- Refactoring `NumberManagementSection.tsx` (~643 LOC pre-existing) into smaller pieces — separate task.
- Wiring `number_group_id` into Campaign Detail UI — that's Phase 2f/g.
- Voicemail greeting URL upload UI — Phase 2 follow-up.

---

## 9. Confirmation

This plan creates 6 new files (all ≤200 LOC), modifies 3 existing files (additive, minimal surface), adds Zod validation, and uses Tailwind only. No new migrations. No new Edge Functions.

**Ready to proceed with implementation.**
