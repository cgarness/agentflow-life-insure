# Implementation Plan — Phase 2f: Campaign Number Group Picker (UI only)

**Branch:** `claude/add-campaign-number-group-Ifuvo`
**Owner:** Chris Garness
**Date:** 2026-05-20

---

## 1. Goal

Admins can assign a Number Group (a pool of org phone numbers) to each
campaign from the Campaign Settings modal. Selection persists to
`campaigns.number_group_id`. Campaign cards display a small badge with the
group name when set. Wiring of the dialer to actually filter caller-IDs by
group is **out of scope** (next build).

Schema (Phase 2a) is already live:
- `number_groups (id, organization_id, name, ...)`
- `number_group_members (number_group_id, phone_number_id)`
- `campaigns.number_group_id uuid null` (FK → `number_groups`, ON DELETE SET NULL)

---

## 2. Files Modified

### A. `src/hooks/useDialerSession.ts`
Add `number_group_id` to the `.select(...)` projection on `campaigns` so the
selection screen and modal can read it without a follow-up query.

### B. `src/pages/DialerPage.tsx`
Add three pieces of state alongside the existing Calling Settings state:
- `campaignNumberGroupId: string | null` (+ setter) — the value the modal binds.
- `numberGroupOptions: Array<{ id: string; name: string; memberCount: number }>`
- (no extra "groupNameById" state — derived via `useMemo`)

Add a `useEffect` keyed on `organizationId` that runs once per org and fetches:
1. `select id, name from number_groups where organization_id = orgId order by name`
2. `select number_group_id from number_group_members` (no filter — RLS scopes
   to org-visible groups via the join policy)

Aggregate `number_group_members` counts into a `Map<groupId, number>` and merge
into `numberGroupOptions`. Counts default to `0` if a group has no members.

Update the **existing fetch effect** (lines ~2054–2089):
- Add `number_group_id` to the campaign SELECT.
- After fetch: `setCampaignNumberGroupId(campaignData.number_group_id ?? null)`.

Update `handleSaveCallingSettings` (lines ~2091–2166):
- Include `number_group_id: campaignNumberGroupId` in the campaigns UPDATE.
- After success, patch the local `campaigns` list so the card badge refreshes
  immediately without a refetch (alongside the existing `max_attempts` patch).

Wire **both** `CampaignSettingsModal` render sites (selection-screen + dialer
view, lines ~2996 and ~3764) with the new props.

Wire `CampaignSelection` (selection-screen render) with the new
`numberGroupNameById` prop, derived via `useMemo` from `numberGroupOptions`.

### C. `src/components/dialer/CampaignSettingsModal.tsx`
Extend `CampaignSettingsModalProps`:
```ts
numberGroupId: string | null;
setNumberGroupId: (id: string | null) => void;
numberGroupOptions: Array<{ id: string; name: string; memberCount: number }>;
```

Render a new **Number Group** field **directly above the Local Presence
toggle**, inside the same `border-t` toggle group so they read as related
controls. Use the shadcn `Select` (matches the rest of the app's dropdown UX):

- Sentinel value `"__all__"` ↔ `null` (Radix Select disallows `""` values).
- Options:
  - `"All Numbers (default)"` (value `__all__`).
  - For each group: `"<Group Name> (<N> numbers)"` (value `group.id`).
- Pre-selects current `numberGroupId` (or `__all__` when null).
- Helper text below: *"Choose which phone numbers this campaign uses for
  outbound dialing. When set, only numbers from this group are used for local
  presence matching."*

The new field stays compact so the modal stays under 200 LOC (current ~217 —
plan to keep the addition tight).

### D. `src/components/dialer/CampaignSelection.tsx`
Extend props with `numberGroupNameById: Record<string, string>`.

In `CampaignCard`, when `campaign.number_group_id` is set and a name is
known, render a small chip **above the action buttons** (below the
Created/Last-dialed lines). Reuses the existing chip style already in the
file (`bg-primary/10 text-primary border-primary/20 text-[9px]`) so cards
stay visually coherent. Truncated to one line via `max-w-full truncate` to
keep the card width stable.

When the campaign has no `number_group_id`, render nothing (no extra space).

---

## 3. Data Fetching Pattern

The modal-load path already does `Promise.all([campaigns, phone_settings])`.
The new number-groups fetch is a separate effect keyed on `organizationId`
because:
- It does not depend on which campaign is open.
- It populates the dropdown options shared across all settings modal sessions.

Two parallel queries — `number_groups` then `number_group_members` — joined in
JS into `{ id, name, memberCount }[]`. Same pattern as the existing parallel
fetch block in this file.

---

## 4. "All Numbers" → null Mapping

Radix Select forbids empty-string values, so the dropdown uses a sentinel
`"__all__"`. The save handler converts:
- `"__all__"` → `null`
- any UUID → that UUID

…before `update({ number_group_id })`.

---

## 5. Verification

- `npx tsc --noEmit` clean.
- Dropdown formats are: `"All Numbers (default)"` and `"<Group Name> (N numbers)"`.
- Save persists `campaigns.number_group_id` to the chosen UUID, or `null` for
  the default option.
- Reopening the modal pre-selects the persisted value.
- Campaign cards show a chip with the group name when set, nothing when null.

---

## 6. Out of Scope (next build)

- Dialer-side caller-ID filtering by group (in `TwilioContext` or local
  presence helper) — explicitly deferred by the spec.
- RLS or migration changes — none needed.
- Voicemail UI — separate phase.

---

## 7. Verification Checklist

- [ ] `useDialerSession.ts` projects `number_group_id`.
- [ ] DialerPage state + fetch effect + save wiring complete.
- [ ] Modal renders the dropdown above the Local Presence toggle with helper
      text and correct option labels.
- [ ] CampaignSelection card chip renders when group set, nothing when null.
- [ ] `npx tsc --noEmit` clean.
- [ ] `WORK_LOG.md` entry appended (newest-first).
