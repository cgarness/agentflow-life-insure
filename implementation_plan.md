# Implementation Plan — Calendar Pass 2
## Appointment Type Source of Truth + Real Calendar Settings Foundation

**Goal:** Make Calendar appointment types real, org-scoped, and shared across Calendar Settings, AppointmentModal, CalendarContext, and CalendarPage. Replace hardcoded/local-only behavior with a single persisted source of truth. Keep Google sync reliability deferred to Pass 3.

**Status:** AWAITING CHRIS APPROVAL before any file mutations, migration apply, or Edge Function deploy.

---

## A. Pre-edit Inspection Findings

### A1. Live DB (verified 2026-05-25 via MCP)

- No `appointment_types` table exists.
- `public.appointments` row count = **0** — no legacy `type` text values to map.
- `public.organizations` row count = **6**: `capital`, `Capital life`, `chris's Agency`, `Family First Life - Chris Garness` (`a0000000-…-0001`), `John's Agency`, `test-prov-smoke-001`.
- Helper functions all present: `public.get_org_id()`, `public.get_user_role()`, `public.is_super_admin()`, `public.update_updated_at()`.
- `public.appointments` policies after Pass 1a: `appointments_select`, `appointments_insert`, `appointments_update`, `appointments_delete` — helper-based, org-scoped (matches Pass 1a notes).

### A2. Organization creation paths (delegated inspection complete)

Three mutation sites for `public.organizations`:

| Path | Currently seeds defaults? | Notes |
|---|---|---|
| `create-organization` Edge Function (self-serve signup via `AuthContext.signup`) | Yes — dispositions + pipeline_stages | Has working `seedOrganizationData(org.id)` precedent |
| `SuperAdminDashboard.handleCreateOrg` (direct `from("organizations").insert`) | **No** — already misses dispositions/pipeline_stages today | Bypasses Edge Function entirely |
| Migration backfill | n/a | Needed for the 6 existing orgs regardless |

One AFTER INSERT trigger pattern already lives on `public.organizations`: `on_organization_created_provision_twilio` calling `handle_new_organization_provisioning()` — SECURITY DEFINER, pg_net based, **never blocks the insert**.

**Decision (proposed):** Option A — DB-level seed function + AFTER INSERT trigger.

Justification:
- The Super Admin "Provision new agency" wizard inserts directly into `organizations` bypassing the Edge Function. Edge-only seeding would replicate the existing dispositions/pipeline_stages gap for that path.
- The Twilio provisioning trigger establishes a safe, never-blocking precedent.
- The seed function is pure data — no network, no secrets — so a SECURITY DEFINER PL/pgSQL function is the right shape.
- Existing Edge Function `create-organization` will redundantly hit the same insert path via the new trigger after this migration. **We will NOT modify `create-organization`** in this pass — the trigger handles the seeding regardless of caller. This keeps the Edge Function unchanged and avoids any risk to existing org provisioning.

### A3. Frontend appointment type touchpoints

| File | What it has | Pass 2 action |
|---|---|---|
| `src/components/settings/CalendarSettings.tsx` | `DEFAULT_APPOINTMENT_TYPES` local array; Card 3 disabled; dead modal/dialog plumbing | Wire Card 3 to real `appointment_types` table; keep all other cards disabled; replace local array source |
| `src/contexts/CalendarContext.tsx` | `CalAppointmentType` hard union, `VALID_TYPES`, `APPOINTMENT_TYPE_COLORS` exports; `mapAppointment` collapses unknown to "Other" | Widen `CalendarAppointment.type` to `string`; stop collapsing; keep exports for compat |
| `src/components/calendar/AppointmentModal.tsx` | `TYPES`, `TYPE_DURATIONS`, `TYPE_SUBJECT_LEAD` hardcoded; type dropdown is fixed list; lead search has no `organization_id` filter; new lead insert has no `organization_id` filter scoping but does set `organization_id` on payload | Load DB types via shared hook; org-scope lead search + lead fetch in `useEffect`; default-pick logic |
| `src/pages/CalendarPage.tsx` | Imports `APPOINTMENT_TYPE_COLORS` from CalendarContext for month/week/day/list color rendering | Use shared helper that falls back to context map for known types and to DB color for custom types |
| `src/components/contacts/FullScreenContactView.tsx` | Insert at line 1561 sets `organization_id`, `user_id`, `created_by`, `sync_source`. `data.type` is a string. | Already compatible after the widened type — no change needed. Verified inspection. |
| `src/integrations/supabase/types.ts` | `appointments.type` already typed as `string` | No change to `appointments` block. Add `appointment_types` block (manual patch for the new table). |

### A4. AppointmentModal lead queries (Pass 2 hardening)

Two unscoped queries:
- Line 304 `fetchLeadInfo`: `from('leads').select('*').eq('id', contactId).maybeSingle()` — **no org filter**.
- Line 464 contact search: `from('leads').select(...).or(...).limit(5)` — **no org filter**.

Plus the inline "Quick Add" lead insert at line 541 already sets `organization_id: organizationId` but has no guard for missing org.

Pass 2 will add explicit `.eq('organization_id', organizationId)` to both reads and a guard on the Quick Add insert.

### A5. Goal-setting independence (verified)

Grep `src/` for `goal` does not show any goal logic keyed on appointment-type strings. Goal counts are independent — no change needed.

---

## B. Database Design

### B1. New table `public.appointment_types`

```
id              uuid PK default gen_random_uuid()
organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE
name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40)
color           text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 240)
sort_order      integer NOT NULL DEFAULT 0
is_default      boolean NOT NULL DEFAULT false
is_locked       boolean NOT NULL DEFAULT false
is_active       boolean NOT NULL DEFAULT true
created_by      uuid NULL REFERENCES auth.users(id)
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

Indexes:
- `appointment_types_org_lower_name_active_unique`
  `UNIQUE INDEX (organization_id, lower(name)) WHERE is_active = true` (partial)
- `appointment_types_org_sort_idx (organization_id, sort_order)`
- `appointment_types_org_active_idx (organization_id, is_active)`

Trigger:
- `appointment_types_updated_at BEFORE UPDATE EXECUTE FUNCTION public.update_updated_at()`

### B2. RLS

`ENABLE ROW LEVEL SECURITY` + `FORCE` not used (matches project pattern).

- **SELECT** `appointment_types_select`: `organization_id = public.get_org_id()`
- **INSERT** `appointment_types_insert` (WITH CHECK only):
  `organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin())`
- **UPDATE** `appointment_types_update`:
  - USING: `organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin())`
  - WITH CHECK: same + `organization_id = public.get_org_id()` (prevents org reassignment)
  - **Note:** locked-row rename/deactivate immutability is **not enforced at DB level** in this pass. UI hides those actions for locked defaults. Documented as deferred.
- **DELETE** `appointment_types_delete`:
  `organization_id = public.get_org_id() AND (public.get_user_role() = 'Admin' OR public.is_super_admin()) AND is_locked = false`
  This DB-level locked-default DELETE guard is required.

Super Admin remains org-scoped — no `is_super_admin() OR organization_id = …` global access pattern.

### B3. Seed function (SECURITY DEFINER)

```
public.seed_default_appointment_types(p_organization_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Inserts six default locked rows for the supplied org **using `INSERT … SELECT … WHERE NOT EXISTS`** scoped by `organization_id` + `lower(name)` + `is_active = true`. Idempotent. Each row marks `is_default = true, is_locked = true, is_active = true`.

Defaults (per spec):
| # | Name | Color | Duration | sort_order |
|---|---|---|---|---|
| 1 | Sales Call | #3B82F6 | 30 | 10 |
| 2 | Follow Up | #F97316 | 20 | 20 |
| 3 | Recruit Interview | #A855F7 | 45 | 30 |
| 4 | Policy Review | #22C55E | 60 | 40 |
| 5 | Policy Anniversary | #EC4899 | 60 | 50 |
| 6 | Other | #64748B | 30 | 60 |

`REVOKE ALL … FROM PUBLIC`; do **not** grant EXECUTE to `authenticated` — only the trigger and the admin migration call it.

### B4. New-org trigger

```
CREATE FUNCTION public.handle_new_organization_seed_appointment_types() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.seed_default_appointment_types(NEW.id); RETURN NEW; END $$;

CREATE TRIGGER on_organization_created_seed_appointment_types
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization_seed_appointment_types();
```

Pattern mirrors `on_organization_created_provision_twilio`. Never blocks the insert (PL/pgSQL trigger returns NEW; the seed function itself does nothing that can fail in normal operation, but a `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING …; RETURN NEW; END` wrap will be added defensively).

### B5. Existing-org backfill

At the bottom of the migration:
```sql
SELECT public.seed_default_appointment_types(o.id) FROM public.organizations o;
```
Idempotent because the seed function uses `NOT EXISTS`.

### B6. Migration file

`supabase/migrations/20260528120000_calendar_appointment_types.sql` — single migration containing: table + indexes + trigger + RLS + seed function + insert trigger + backfill.

---

## C. Frontend Plan

### C1. Shared module — `src/lib/calendar/appointmentTypes.ts`

Exports:
```ts
export interface AppointmentTypeRecord {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  durationMinutes: number;
  sortOrder: number;
  isDefault: boolean;
  isLocked: boolean;
  isActive: boolean;
}

export const KNOWN_DEFAULT_APPOINTMENT_TYPE_NAMES = [
  "Sales Call", "Follow Up", "Recruit Interview",
  "Policy Review", "Policy Anniversary", "Other",
] as const;
export type KnownAppointmentType = typeof KNOWN_DEFAULT_APPOINTMENT_TYPE_NAMES[number];

export const KNOWN_APPOINTMENT_TYPE_COLORS: Record<KnownAppointmentType, string> = { ... };
export const KNOWN_APPOINTMENT_TYPE_DURATIONS: Record<KnownAppointmentType, number> = { ... };
export const KNOWN_APPOINTMENT_TYPE_SUBJECT_LEAD: Record<KnownAppointmentType, string> = { ... };

export const FALLBACK_COLOR = "#64748B";
export const FALLBACK_DURATION = 30;
export const FALLBACK_SUBJECT_LEAD = "Meeting";

export function getAppointmentTypeColor(name: string, types: AppointmentTypeRecord[]): string;
export function getAppointmentTypeDuration(name: string, types: AppointmentTypeRecord[]): number;
export function getAppointmentTypeSubjectLead(name: string, types: AppointmentTypeRecord[]): string;
export function normalizeAppointmentTypeName(name: string | null | undefined): string;
```

Helpers look up by exact `name` match in the live list first, fall back to the `KNOWN_*` map for known defaults, then to the fallback constant.

### C2. Shared hook — `src/hooks/useAppointmentTypes.ts`

- Fetches `appointment_types` for the current org, `.eq('organization_id', organizationId).eq('is_active', true).order('sort_order').order('name')`.
- Guarded on missing `organizationId`.
- Returns `{ types, loading, error, reload, allTypesIncludingInactive(): Promise<…> }`.
- React state, no TanStack Query (matches CalendarContext style for surgicality).
- On error: keeps `types = []` and surfaces `error`; helpers degrade to known/fallback values.

### C3. CalendarContext.tsx (conservative)

- **Keep** `CalAppointmentType`, `VALID_TYPES`, `APPOINTMENT_TYPE_COLORS`, `APPOINTMENT_STATUS_COLORS` exports. CalendarPage and AppointmentModal still import these.
- **Widen** `CalendarAppointment.type: CalAppointmentType` → `CalendarAppointment.type: string`.
- **Stop** the `VALID_TYPES.includes(appt.type) ? appt.type : "Other"` collapse — keep the stored text as-is. Fallback to `"Other"` only when `appt.type` is null/empty.
- Status handling unchanged.

### C4. AppointmentModal.tsx

- Replace hardcoded `TYPES` with results from `useAppointmentTypes()` filtered to `is_active`.
- Replace `TYPE_DURATIONS[type]` lookup with `getAppointmentTypeDuration(type, types)`.
- Replace `autoSubjectForType(type, name)` to use `getAppointmentTypeSubjectLead(type, types)` for the lead phrase; preserve the natural form for custom types ("<Type Name> with <FirstName>"). For known defaults, the lead-phrase map keeps the original phrasing.
- Default type on open: `"Sales Call"` if active, else first active type by sort, else `"Other"`.
- `type` state widened from `CalAppointmentType` to `string`.
- Add `.eq('organization_id', organizationId)` to `fetchLeadInfo` (line 304) and to contact search (line 464). Add guards on both for missing org.
- Add guard on the inline Quick Add lead insert: bail with toast if `!organizationId`.
- Remove the no-longer-needed `TYPES`, `TYPE_DURATIONS`, `TYPE_SUBJECT_LEAD` constants and `autoSubjectForType` (replaced by helper).
- Preserve all current UI styling. Type dropdown still uses native `<select>`.
- Multi-contact search (clients/recruits) remains deferred per Pass 1b notes.

### C5. CalendarPage.tsx

- Import `useAppointmentTypes` and `getAppointmentTypeColor`.
- Replace `APPOINTMENT_TYPE_COLORS[a.type]` calls (month/week/day/list/agenda — six sites) with `getAppointmentTypeColor(a.type, apptTypes)`.
- Header search and lead lookups already org-scoped from Pass 1b.

### C6. CalendarSettings.tsx — Card 3 only

- Re-enable Card 3 (`Appointment Types`). All other disabled cards stay disabled.
- Replace `DEFAULT_APPOINTMENT_TYPES` local seed with live DB load via `useAppointmentTypes` (and a reload-all variant that returns inactive too for management UI — same hook exposes `allTypesIncludingInactive` lazy fetch, or we simply call the table directly inside CalendarSettings to keep things explicit).
- Card 3 actions:
  - **Add**: Admin/Super Admin only. Insert into `appointment_types` (`is_default = false`, `is_locked = false`, `is_active = true`).
  - **Edit**: Admin/Super Admin only. Update `name`/`color`/`duration_minutes`. Disabled in UI for `is_locked = true`.
  - **Deactivate** (soft-delete): Admin/Super Admin only. `UPDATE … SET is_active = false`. Disabled for `is_locked = true`.
  - Hard `DELETE` is **not** wired from UI for any row (custom or locked). DB RLS guard remains as defense-in-depth.
- Role gating:
  - Agent / Team Leader: render the list read-only. Add button hidden. Row actions hidden.
  - Admin / Super Admin: full management except locked rows show locked padlock and disabled actions.
- Zod schema in `src/components/settings/calendar/appointmentTypeSchema.ts`:
  - `name`: `z.string().trim().min(1).max(40)`
  - `color`: `z.string().regex(/^#[0-9A-Fa-f]{6}$/)`
  - `duration_minutes`: `z.number().int().min(5).max(240)` (UI offers 15/30/45/60/90 presets but validation accepts the full range).
- Duplicate-name DB error (unique index violation, code `23505`) → friendly toast: "An appointment type with this name already exists."
- Successful mutation reloads the list (calls the hook's `reload`).
- Remove fake-save toasts. The `saveType()` function is rewritten to await DB write.

### C7. FullScreenContactView.tsx

- No code change needed. Verified that `data.type` is already a `string` value, organization_id/user_id/created_by all set from Pass 1b. Confirmed no `contact_type` field.

### C8. Activity logging

- Skip for this pass. CalendarSettings has no existing activity-log pattern; adding one would scope-creep.

---

## D. Types.ts

Hand-patch only — add `appointment_types` block to `Database['public']['Tables']` mirroring the schema. Also add the `Functions` entry for `seed_default_appointment_types(p_organization_id uuid) → void` (not callable from the frontend, but typed for completeness). No other tables touched.

---

## E. Files to Touch

1. `supabase/migrations/20260528120000_calendar_appointment_types.sql` (new)
2. `src/integrations/supabase/types.ts` (hand-patch — add `appointment_types` table + seed function)
3. `src/lib/calendar/appointmentTypes.ts` (new — helpers + constants)
4. `src/hooks/useAppointmentTypes.ts` (new — fetcher hook)
5. `src/components/settings/calendar/appointmentTypeSchema.ts` (new — Zod)
6. `src/contexts/CalendarContext.tsx` (widen `type`, stop collapsing)
7. `src/components/calendar/AppointmentModal.tsx` (DB-backed types + org-scope lead queries)
8. `src/pages/CalendarPage.tsx` (color helper)
9. `src/components/settings/CalendarSettings.tsx` (re-enable Card 3, real persistence)
10. `WORK_LOG.md` (newest-first entry)
11. `implementation_plan.md` (this file — final context snapshot)

**Not touched:**
- `supabase/functions/create-organization/index.ts` — DB trigger handles new-org seeding regardless of caller.
- All Google Calendar Edge Functions — out of scope (Pass 3).
- Dialer, Twilio, workflow, Telnyx, dispositions, carriers, goals.
- Other Calendar Settings cards (1, 2, 4, 6, 7, 8) — remain disabled.
- `FullScreenContactView.tsx` — confirmed compatible without changes.

---

## F. Verification Plan

- `npx tsc --noEmit` → must be 0 errors.
- `npm test -- --run` → run; report cleanly if vitest still missing (consistent with Pass 1a/1b sessions).
- Live MCP audits after migration:
  - Table exists with expected columns, indexes, constraints, RLS enabled.
  - 4 policies present; DELETE policy includes `is_locked = false`.
  - Seed function exists, `prosecdef = true`, no PUBLIC grant.
  - Trigger `on_organization_created_seed_appointment_types` present.
  - Each of 6 orgs has exactly 6 default rows after backfill.
  - Re-run migration mentally: `NOT EXISTS` ensures idempotency.

---

## G. Critical Hardening Decisions (mirrored from spec)

1. **Locked defaults are protected from hard DELETE at the DB/RLS level via the `is_locked = false` predicate on the DELETE policy. Full locked-row immutability (preventing Admin UPDATE to rename, unlock, or deactivate) is deferred — UI hides those actions, but a trigger or stricter UPDATE policy would be needed to enforce it at the DB.** This distinction will be repeated in the WORK_LOG entry.
2. Seeding uses `INSERT … SELECT … WHERE NOT EXISTS`, **not** `ON CONFLICT` — the unique active-name index is partial.
3. New-org seeding uses **Option A** (DB-level seed function + AFTER INSERT trigger on `public.organizations`). The Super Admin "Provision new agency" path bypasses the Edge Function, so DB-level coverage is the only complete answer. `create-organization` Edge Function is **not** modified. Twilio provisioning trigger is the precedent.
4. Type compatibility is conservative: widen `CalendarAppointment.type` to `string`, keep `CalAppointmentType` / `APPOINTMENT_TYPE_COLORS` / `VALID_TYPES` exported for compat, route color/duration/subject-lead lookups through helpers. No cascading rewrite.

---

## H. Stop / Approval Gate

**Awaiting Chris's explicit approval to proceed with:**
- Applying migration `20260528120000_calendar_appointment_types`.
- Source-file edits per §E.
- Hand-patching `types.ts` for the new table.

No `git push`, no merge, no `create-organization` Edge Function deploy, no destructive operation will run without approval.
