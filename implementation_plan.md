# Implementation Plan — Phone Number Assignment Model (Pass 1 of 3)

**Owner:** Chris Garness | **Branch:** `claude/phone-assignment-pass-1-fuwef` | **Date:** 2026-06-01
**Production project:** `jncvvsvckxhqgqvkppmj`

> **STATUS: AWAITING CHRIS APPROVAL.** No files modified beyond this plan. No migration
> applied. No backend command run. Nothing committed/pushed.

---

## Goal

Create the **safe schema/type/docs foundation** for phone-number assignment (`agency` vs
`personal`) **without** changing outbound caller-ID selection. This pass deliberately ships
**no live editable Personal/Agency control** — enforcement lands in Pass 2, so a number can
never be flagged `personal` before caller-ID selection respects it (which would risk burning
a personal number in shared local presence).

**Pass order:** Pass 1 = schema/types/docs (+ optional read-only badge). Pass 2 = caller-ID /
local-presence enforcement on `assignment_type`. Pass 3 = pause/cool-off.

---

## Verified production context (read-only confirmed this session)

- `phone_numbers` has **10 rows**, all `status = 'active'` (1 distinct status).
- `assigned_to` is `uuid NULL` — **2 rows** populated; **do not invent** other owner columns.
- **The org default** (`is_default = true`, 1 row) **also has `assigned_to` set** → it must
  stay **agency** after backfill. `assigned_to` alone never means Personal.
- `is_direct_line` is `boolean NOT NULL DEFAULT false`; **0 rows** true. Inbound-display only.
- `is_default` is `boolean NULL DEFAULT false`.
- `assignment_type` **does not exist yet** (verified via `information_schema`).
- Latest applied migration: `20260530051039_get_campaign_card_stats_rpc` (`list_migrations`).

No Work Log conflicts: this pass touches none of the Twilio single-leg WebRTC invariant, the
P0 `calls.duration` canon, caller-ID/local-presence history, or Queue Builds 1–4.

---

## Scope of Pass 1

### A. Migration — `supabase/migrations/20260601193140_add_phone_numbers_assignment_type.sql` (APPLIED 2026-06-01)

Adds **one column** + three CHECK constraints. Idempotent guards. **Generated as a file only —
not applied** until Chris approves.

```sql
-- Add phone_numbers.assignment_type (agency | personal). Pass 1 foundation only.
-- Outbound caller-ID enforcement of this column lands in Pass 2.

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS assignment_type text NOT NULL DEFAULT 'agency';

-- Allowed values
ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_assignment_type_check;
ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_assignment_type_check
  CHECK (assignment_type IN ('agency','personal'));

-- Personal numbers must have an owner (assigned_to)
ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_personal_requires_owner_check;
ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_personal_requires_owner_check
  CHECK (assignment_type <> 'personal' OR assigned_to IS NOT NULL);

-- Personal numbers cannot be the org default
ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_personal_not_default_check;
ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_personal_not_default_check
  CHECK (assignment_type <> 'personal' OR COALESCE(is_default, false) = false);

NOTIFY pgrst, 'reload schema';
```

**Behavior:** `NOT NULL DEFAULT 'agency'` backfills all 10 existing rows to `agency`
automatically — including both `assigned_to` rows and the org default. The migration **does
not** touch/UPDATE `assigned_to`, `is_default`, `is_direct_line`, `status`, number groups, or
any data. No raw SQL executed; DDL ships as a migration file per AGENT_RULES.

### B. Supabase types

Add `assignment_type: string` (Row) / `assignment_type?: string` (Insert/Update) to the
`phone_numbers` block in `src/integrations/supabase/types.ts`. Will regenerate via
`generate_typescript_types` **after** the migration is applied (the canonical source); if not
yet applied, the surgical hand-edit keeps `tsc` green. No other type changes.

### C. Settings UI — read-only badge only (proposed; can be dropped on your call)

**File:** `src/components/settings/phone/NumberManagementSection.tsx` (the existing Phone
Number Settings table — confirmed; controller `usePhoneSettingsController.ts` already does
`.select("*")`, so the column flows through with no query change).

Proposed, **read-only**:
- Add `assignment_type?: string | null` to the `PhoneNumberRow` interface.
- Render a small **read-only** role chip in the existing "Assigned to" cell:
  **`Agency`** (neutral) / **`Personal`** (accent), driven by `n.assignment_type`.
- Tooltip / helper text: *"Phone number assignment enforcement is being added in the next pass."*

**Explicitly NOT in Pass 1** (would require Pass 2 enforcement in the same deploy):
- No editable Agency/Personal toggle, no owner picker tied to it, no way to set `personal`.
- No redesign of the page, no pause/cool-off UI.

> If you'd rather I leave the UI **completely untouched** in Pass 1, say so — the badge is
> optional. I will **not** build any editable control.

### D. Docs

- **`implementation_plan.md`** — this file.
- **`AGENT_RULES.md`** — add a new invariant (and a Schema Gotcha row):
  > **A phone number's outbound role is controlled by `phone_numbers.assignment_type`, not by
  > `assigned_to` alone and not by `is_direct_line`.** `agency` = shared outbound pool;
  > `personal` = user-owned (requires `assigned_to`, cannot be org default). `assigned_to`
  > alone never implies Personal; existing `assigned_to` rows are still Agency. `is_direct_line`
  > is inbound caller-display only — never outbound eligibility. Pass 2: Personal numbers are
  > excluded from all automatic outbound selection (power-dialer rotation, campaign rotation,
  > AI/local presence, smart + fallback caller-ID) and manually selectable only by their owner.
  > Number groups cannot override phone-number ownership/scope safety. Pause/cool-off deferred.
- **`WORK_LOG.md`** — newest-first entry + Context Snapshot.

### E. Verification

- `npx tsc --noEmit`
- `npm test -- --run`
- If migration approved & applied, read-only checks: migration recorded; column exists,
  NOT NULL, default `agency`; the 3 CHECKs present; all 10 rows `agency`; the 2 `assigned_to`
  rows still `agency`; org default still `agency`; `is_direct_line` unmutated; number groups
  untouched; no Postgres errors.
- Static: no Twilio edge files, no `calls.duration` write, no queue-lock/Reports/campaign-stats
  files, no caller-ID/TwilioContext/DialerPage/FloatingDialer changes, no pause/cooldown, no
  live editable Personal/Agency control.

---

## Files I intend to touch

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_add_phone_numbers_assignment_type.sql` | **NEW** — column + 3 CHECKs + NOTIFY |
| `src/integrations/supabase/types.ts` | Add `assignment_type` to `phone_numbers` Row/Insert/Update |
| `src/components/settings/phone/NumberManagementSection.tsx` | **(optional)** add field to `PhoneNumberRow` + read-only badge |
| `implementation_plan.md` | This plan |
| `AGENT_RULES.md` | New `assignment_type` invariant + Schema Gotcha row |
| `WORK_LOG.md` | Newest-first entry + Context Snapshot |

## DB objects I intend to touch

| Object | Change |
|--------|--------|
| `public.phone_numbers.assignment_type` | **NEW** column `text NOT NULL DEFAULT 'agency'` |
| `phone_numbers_assignment_type_check` | **NEW** CHECK `IN ('agency','personal')` |
| `phone_numbers_personal_requires_owner_check` | **NEW** CHECK personal ⇒ `assigned_to NOT NULL` |
| `phone_numbers_personal_not_default_check` | **NEW** CHECK personal ⇒ not default |

**Untouched DB:** `assigned_to`, `is_default`, `is_direct_line`, `status`, `number_groups`,
`number_group_members`, all RPCs, all RLS, all Twilio/queue/reports objects.

---

## Stop gates

1. **(HERE)** Stop after plan, before editing — awaiting Chris approval.
2. Stop after implementation, before applying migration.
3. Stop after migration apply, before commit/push.
4. Stop before any deploy unless Chris approves.

## What Pass 2 will consume

- `phone_numbers.assignment_type` (`agency` eligible for shared outbound; `personal` excluded)
- `phone_numbers.assigned_to` (owner identity for Personal)
- Owner-manual-select rule (a Personal number is manually selectable only by its `assigned_to` owner)

**Next step after Pass 1:** Pass 2 — caller-ID eligibility enforcement using `assignment_type`.
