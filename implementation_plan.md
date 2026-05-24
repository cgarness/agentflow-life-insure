# Implementation Plan — Calendar Pass 1a (Appointment Tenant Hardening)

**Goal:** Make `public.appointments` tenant-safe at the DB/RLS layer. Backfill `organization_id`, set `NOT NULL`, replace the broad legacy RLS policy with helper-based per-command policies, add useful indexes, add the canonical `updated_at` trigger, and keep Super Admin org-scoped in normal Calendar RLS. Calendar UI/settings cleanup is deferred to Pass 1b.

**Status:** AWAITING CHRIS APPROVAL. Two hard-gate findings below require explicit go/no-go before any migration runs.

---

## A. Inspection Summary (live `jncvvsvckxhqgqvkppmj`, read-only)

### A1. Live appointments audit

| Metric | Value |
|---|---|
| total rows | **0** |
| rows where `organization_id IS NULL` | 0 |
| rows where `user_id IS NULL` | 0 |
| rows where `created_by IS NULL` | 0 |
| rows where both `user_id` and `created_by` are null | 0 |
| rows where `external_provider = 'google'` | 0 |
| rows where `sync_source = 'external'` | 0 |

Zero rows live. Backfill is trivially safe; no conflict possible. The guard `DO` blocks in the migration are still included for safety in case rows appear between plan-approval and apply-time.

### A2. Existing RLS

One broad policy: `"Hierarchical Appointments Access"` (cmd `*`, i.e. ALL). It uses raw `profiles` subqueries and inlines four branches: owner / Team Leader same-team / Admin same-org / Super Admin **already org-scoped** (`p.is_super_admin = true AND p.organization_id = appointments.organization_id`).

Team-leader branch shape (copied verbatim from live `pg_policy.polqual`):

```
EXISTS (
  SELECT 1 FROM profiles p
  WHERE p.id = auth.uid()
    AND p.role = 'Team Leader'
    AND p.team_id IS NOT NULL
    AND appointments.user_id IN (
      SELECT id FROM profiles WHERE team_id = p.team_id
    )
)
```

WITH CHECK currently allows owner OR (Admin/Team Leader/Super Admin same org). DELETE inherits the same ALL policy USING clause, so Team Leader currently can delete same-team appointments. Pass 1a preserves that behavior and documents it.

### A3. Indexes on `public.appointments`

| Index | Definition | Decision |
|---|---|---|
| `appointments_pkey` | `(id)` | keep |
| `idx_appointments_user_id` | `(user_id)` | keep |
| `idx_appointments_organization_id` | `(organization_id)` | keep (canonical, also referenced by brief) |
| `idx_appointments_org` | `(organization_id)` | **duplicate** — drop in the migration |
| `idx_appointments_google_external_event` | partial `(user_id, external_provider, external_event_id)` | keep (created by `20260308170000`, used by inbound sync lookup) |

Indexes to **add**:
- `appointments_org_start_time_idx (organization_id, start_time)` — supports org-wide calendar reads, dashboard widgets.
- `appointments_user_start_time_idx (user_id, start_time)` — supports per-user calendar reads (`CalendarContext.fetchAppointments`, `AppointmentsWidget`, `CallbacksWidget`).

### A4. Triggers on `public.appointments`

- `workflow_appointment_insert_trigger` AFTER INSERT (executes `handle_appointment_workflow_events`) — preserved.
- `workflow_appointment_update_trigger` AFTER UPDATE (same fn) — preserved.
- **No `updated_at` trigger exists.** Brief requires adding one calling `public.update_updated_at()`. Will add as `appointments_updated_at BEFORE UPDATE`.

### A5. Helper functions

All present and callable:

| Fn | `prosecdef` | `proconfig` |
|---|---|---|
| `public.get_org_id()` | false | `search_path=public` |
| `public.get_user_role()` | false | — |
| `public.is_super_admin()` | false | — |
| `public.update_updated_at()` | false | `search_path=public` |
| `public.is_platform_admin()` | true | `search_path=public` (not used here) |

### A6. App insert/update paths (audit)

| Path | Sets `org_id`? | Sets `user_id`? | Sets `created_by`? | Under NOT NULL? | Under new INSERT WITH CHECK? |
|---|---|---|---|---|---|
| `CalendarContext.addAppointment` (`src/contexts/CalendarContext.tsx:155`) | ✅ from `useOrganization()` | ✅ from `user.id` | indirect via caller payload | ✅ | ✅ owner branch |
| `CalendarPage.handleSave` (passes payload into context) | ✅ | ✅ | ✅ (`created_by: user.id`) | ✅ | ✅ |
| `FloatingDialer.tsx:768` (callback-scheduler insert) | ✅ `organizationId` | ❌ | ✅ `created_by: user.id` | ✅ | ✅ via `created_by = auth.uid()` |
| `dialer-api.ts:559` (`scheduleAppointmentFromDisposition`) | ✅ (passed param) | ✅ `data.agent_id` | ❌ | ✅ if caller passes `organizationId` | ✅ via `user_id = auth.uid()` if `data.agent_id = auth.uid()` |
| `FullScreenContactView.tsx:1556` | ❌ | ❌ | ❌ | ❌ **WILL BREAK** | ❌ **WILL BREAK** |
| `google-calendar-inbound-sync` Edge Function (`supabase/functions/google-calendar-inbound-sync/index.ts:280`) — service_role | ❌ | ✅ `integration.user_id` | ❌ | ❌ **WILL BREAK** | (bypassed — service_role) |
| `google-calendar-sync-appointment` Edge Function | UPDATE-only (metadata fields); never inserts or changes `organization_id` | — | — | ✅ | n/a |
| `supabase-conversion.ts` | UPDATE-only (`contact_id`, `contact_type`); doesn't touch org | — | — | ✅ | n/a |

Read-only paths (`AppointmentsWidget`, `CallbacksWidget`, `supabase-dashboard.ts`, `useDashboardStats`, `useLeaderboardData`, `AgentScorecardModal`, `DashboardDetailModal`, `supabase-users.ts`) — all SELECT-only, gated by RLS plus their own `.eq("user_id"...)` / `.eq("created_by"...)` / `.eq("organization_id"...)`. The new SELECT policy keeps the existing visibility model so these continue to work.

### A7. Edge Function status

| Slug | Version | `verify_jwt` | Notes |
|---|---|---|---|
| `google-calendar-inbound-sync` | v473 | false | service_role inside; user JWT path for on-demand sync; cron secret for batch. **Insert payload is missing `organization_id` — needs a v474 patch.** |
| `google-calendar-sync-appointment` | v473 | false | user JWT (validated in-code via `auth.getUser`). Does not insert appointments; only updates metadata. No change needed. |
| `google-calendar-list` / `-status` / `-configure` / `-disconnect` | v469/v474 | false | Do not touch appointments. No change needed. |

### A8. Home-org / hardcoded UUID

`a0000000-0000-0000-0000-000000000001` (Chris's home org, Family First Life) is referenced in ops scripts and AGENT_RULES §2 as a test/seed constant. It is **not** used as a fallback for live writes anywhere in the appointment paths above. We will **not** use a hardcoded UUID fallback in this migration.

---

## B. Hard-gate findings (require Chris approval before any migration)

### HG-1. `google-calendar-inbound-sync` Edge Function will break under `NOT NULL`.

Lines 280–292 of `supabase/functions/google-calendar-inbound-sync/index.ts` build an appointment payload with `user_id`, `title`, `notes`, `type`, `status`, `start_time`, `end_time`, `external_provider`, `external_event_id`, `external_last_synced_at`, `sync_source` — **no `organization_id`**. The insert at line 307 uses `service_role`, so it bypasses RLS but is still subject to the `NOT NULL` constraint. Once `organization_id` is `NOT NULL`, every Google inbound import (manual sync from the Calendar header + any cron batch) will fail with `23502 null value in column "organization_id"`.

**Proposed fix (need approval):** patch the Edge Function so the payload's `organization_id` is derived from `calendar_integrations.user_id -> profiles.organization_id` (already loaded in the `integrations` query just upstream — add `profiles!inner(organization_id)` or a second `.maybeSingle()` lookup before the per-event loop). If a user's profile has no `organization_id`, skip that integration's events and append an error to the summary (do not insert an orphan appointment). Deploy as v474. Then apply the migration.

This is the **smallest possible** change to the Edge Function — no auth-mode change, no signature change, no logic change beyond filling in the org id. Matches brief §"Verify google-calendar-inbound-sync before migration so the new RLS does not break imports."

### HG-2. `FullScreenContactView.tsx` insert will break under both `NOT NULL` and the new `INSERT WITH CHECK`.

`src/components/contacts/FullScreenContactView.tsx:1556` inserts an appointment with no `organization_id`, no `user_id`, and no `created_by`. Under the new policies, the row would fail the `NOT NULL` constraint immediately; even with org id added, it would fail INSERT WITH CHECK because the `(user_id = auth.uid() OR created_by = auth.uid() OR ...)` branch wouldn't match for a non-Admin caller.

**Proposed fix (need approval):** add `organization_id: organizationId` (from `useOrganization()`), `user_id: user?.id`, and `created_by: user?.id` to the insert object. This mirrors what `CalendarContext.addAppointment` + `CalendarPage.handleSave` already do — same fix, copy-paste minimum. Imports for `useOrganization` and `useAuth` may already exist in this file; if not, both are one line each.

**Brief check:** brief says "do not change frontend in this pass unless necessary for types". This change is **necessary to avoid breaking an existing feature path under the new DB constraints**, not a type-driven change. Listing it explicitly so Chris can approve or substitute (e.g. defer the FullScreenContactView appointment-creation feature instead).

### HG-3 (not blocking, just FYI).

`idx_appointments_org` is an exact duplicate of `idx_appointments_organization_id`. Pass 1a drops the duplicate in the migration. If Chris prefers to leave it, say so and the DROP will be removed.

---

## C. Files to touch (final list)

### New

- `supabase/migrations/20260527150000_appointments_tenant_hardening.sql` — the full hardening migration described below.

### Modified (gated by Chris's HG-1/HG-2 approval)

- `supabase/functions/google-calendar-inbound-sync/index.ts` — derive and set `organization_id` on the appointment insert/update payloads (HG-1).
- `src/components/contacts/FullScreenContactView.tsx` — add `organization_id`, `user_id`, `created_by` to the appointment insert at line 1556 (HG-2).

### Modified (type sync, deterministic)

- `src/integrations/supabase/types.ts` — flip `appointments.Row.organization_id` from `string | null` to `string`; mark `appointments.Insert.organization_id` required (`organization_id: string`); leave `Update.organization_id` optional (UPDATE WITH CHECK still rejects cross-org reassignment). No other tables touched.

### Append

- `WORK_LOG.md` — newest-first entry summarizing this pass.
- `implementation_plan.md` (this file) — final context snapshot at the bottom after apply.

### Not touched (deliberate)

- `src/pages/CalendarPage.tsx` — UI behavior unchanged (Pass 1b).
- `src/contexts/CalendarContext.tsx` — already sets `organization_id` and `user_id`. The legacy mock `initialAppointments` array sits unused (state initializes from `[]` and is replaced by `fetchAppointments`); leave it for Pass 1b.
- `src/components/calendar/AppointmentModal.tsx` — no change required.
- `src/lib/dialer-api.ts:559` — already accepts `organizationId`; verified callers pass it (no change in this pass).
- `src/components/layout/FloatingDialer.tsx:768` — already sets `organization_id` + `created_by`.
- `supabase/functions/google-calendar-sync-appointment/index.ts` — does not insert; only updates metadata fields. No change.
- `supabase/functions/google-calendar-*` (list / status / configure / disconnect) — don't touch appointments.
- `supabase/config.toml` — no function added/removed; no change.
- Workflow triggers `workflow_appointment_insert_trigger` / `workflow_appointment_update_trigger` — preserved.
- `AGENT_RULES.md` / `VISION.md` — no new invariant in this pass.

---

## D. Migration (SQL spec)

`supabase/migrations/20260527150000_appointments_tenant_hardening.sql`:

1. **Helper guard.** `DO` block raises `EXCEPTION` if any of `public.get_org_id`, `public.get_user_role`, `public.is_super_admin`, `public.update_updated_at` is missing.
2. **Backfill prechecks.** `DO` blocks raise if:
   - any appointment has `organization_id IS NULL` AND cannot be mapped via `user_id -> profiles.organization_id` OR `created_by -> profiles.organization_id`;
   - any appointment has non-null `user_id` AND non-null `created_by` whose profile-resolved orgs both exist and differ;
   - any appointment has non-null `organization_id` AND non-null `user_id` whose profile-resolved org differs from `appointments.organization_id`.
   Live audit shows 0 rows, so each guard short-circuits with no impact; they're present for safety at apply-time.
3. **Backfill.** `UPDATE appointments SET organization_id = COALESCE(...)` using preferred priority: `user_id -> profile.org`, fallback `created_by -> profile.org`. Only touches rows where `organization_id IS NULL` (0 rows expected).
4. **NOT NULL.** `ALTER TABLE public.appointments ALTER COLUMN organization_id SET NOT NULL;`
5. **`updated_at` trigger.** `CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();` (drop-if-exists first to be idempotent).
6. **Indexes** (each `CREATE INDEX IF NOT EXISTS`):
   - keep `idx_appointments_organization_id`, `idx_appointments_user_id`, `idx_appointments_google_external_event` (no-op);
   - add `appointments_org_start_time_idx (organization_id, start_time)`;
   - add `appointments_user_start_time_idx (user_id, start_time)`;
   - `DROP INDEX IF EXISTS public.idx_appointments_org;` (duplicate of `idx_appointments_organization_id`).
7. **RLS policies.**
   - `DROP POLICY IF EXISTS "Hierarchical Appointments Access" ON public.appointments;`
   - `DROP POLICY IF EXISTS appointments_select ON public.appointments;` (+ insert/update/delete) for idempotency.
   - Create the four policies below.
8. **Reload.** `NOTIFY pgrst, 'reload schema';`

### Policy text (exact)

```sql
-- SELECT
CREATE POLICY appointments_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() = 'Admin'
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'Team Leader'
          AND p.team_id IS NOT NULL
          AND appointments.user_id IN (
            SELECT id FROM public.profiles WHERE team_id = p.team_id
          )
      )
    )
  );

-- INSERT (WITH CHECK only)
CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- UPDATE (USING + WITH CHECK)
CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() = 'Admin'
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'Team Leader'
          AND p.team_id IS NOT NULL
          AND appointments.user_id IN (
            SELECT id FROM public.profiles WHERE team_id = p.team_id
          )
      )
    )
  )
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- DELETE (USING only) — preserves current behavior (Team Leader same-team delete allowed)
CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.get_user_role() = 'Admin'
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'Team Leader'
          AND p.team_id IS NOT NULL
          AND appointments.user_id IN (
            SELECT id FROM public.profiles WHERE team_id = p.team_id
          )
      )
    )
  );
```

Key invariants:
- Every policy wraps in `organization_id = public.get_org_id()`. Super Admin is **org-scoped** in normal Calendar RLS (no unconditional global access via `is_super_admin() OR organization_id = ...`).
- INSERT/UPDATE `WITH CHECK` forces `organization_id = get_org_id()` for every writer, preventing cross-org reassignment and cross-org inserts.
- Team Leader same-team `EXISTS` clause copies the live policy verbatim (no team-id model change).
- DELETE preserves the current Team Leader same-team capability per the existing `FOR ALL` policy's USING branch. Documented in WORK_LOG.

---

## E. Edge Function patch (gated by HG-1)

`supabase/functions/google-calendar-inbound-sync/index.ts`:

1. After loading the integrations list (the existing `supabase.from("calendar_integrations").select(...)`), join or follow-up-query each `integration.user_id -> profiles.organization_id`. Store on a per-integration `orgId` local.
2. If `orgId` is null, push an error to `summary.errors` (`user=<uid>: missing organization_id`) and `continue` to the next integration — do not import events.
3. Pass `orgId` into the `appointmentPayload` for both the existing INSERT (line 307) and UPDATE (line 296) paths so subsequent Google-wins overwrites continue to carry org id (defense-in-depth; UPDATE actually doesn't need it because the existing row already has it after backfill + NOT NULL).
4. No change to auth mode or signature.
5. Deploy as v474 via `deploy_edge_function`.

---

## F. Frontend patch (gated by HG-2)

`src/components/contacts/FullScreenContactView.tsx:1556`:

Change the insert from
```ts
.from('appointments').insert([{ title, contact_name, contact_id, contact_type, type, start_time, end_time, notes }])
```
to
```ts
.from('appointments').insert([{ title, contact_name, contact_id, contact_type, type, start_time, end_time, notes,
  organization_id: organizationId,
  user_id: user?.id,
  created_by: user?.id,
}])
```

Add `useOrganization()` and (if missing) `useAuth()` hook calls near the top of the component. Surgical; no behavior change other than the row now carrying the tenancy/owner fields required by the new schema.

---

## G. Types patch

`src/integrations/supabase/types.ts` — `appointments` block only:

- `Row.organization_id: string` (was `string | null`).
- `Insert.organization_id: string` (was optional `string | null`).
- `Update.organization_id?: string` (was `string | null`). The WITH CHECK enforces no cross-org reassignment.

No other tables changed.

---

## H. Verification plan

1. `npx tsc --noEmit` — 0 errors.
2. `npm test -- --run` — preserve baseline (72/72 last seen on 2026-05-24).
3. Live audits via MCP `execute_sql`:
   - `is_nullable` for `appointments.organization_id` = `NO`.
   - `SELECT count(*) FROM appointments WHERE organization_id IS NULL` = 0.
   - `pg_policy` lists exactly `appointments_select`, `appointments_insert`, `appointments_update`, `appointments_delete`; no `"Hierarchical Appointments Access"`.
   - Each policy `polqual` / `polwithcheck` references `get_org_id` / `get_user_role` / `is_super_admin`.
   - No unconditional `is_super_admin() OR organization_id` anywhere in the four policies.
   - Trigger `appointments_updated_at` exists referencing `update_updated_at()`.
   - Indexes `appointments_org_start_time_idx`, `appointments_user_start_time_idx` exist; `idx_appointments_org` does not exist.
   - `appointments` row count unchanged (0 expected pre/post).
   - `google-calendar-inbound-sync` deployed version is v474 with `verify_jwt = false` unchanged.
4. Smoke (Chris): the manual checklist in §J.

---

## I. Risks / Decisions

- **Super Admin in Calendar RLS is org-scoped.** Matches brief; matches the existing prod policy. Cross-org appointment inspection belongs in Control Center, not normal Calendar RLS.
- **Team Leader same-team logic** is preserved verbatim from the live policy — same `profiles.team_id` model, same role string `'Team Leader'`. Now wrapped by `organization_id = get_org_id()` (defense-in-depth; team_id is already practically org-scoped via profiles).
- **Team Leader DELETE preserved.** The existing single `FOR ALL` policy permitted Team Leader same-team delete; the new split DELETE policy keeps that. If Chris wants delete restricted to owner + Admin + Super Admin, say so before approval and I'll drop the Team Leader branch from `appointments_delete` USING only.
- **`organization_id = public.get_org_id()` in WITH CHECK applies to Super Admin too.** Super Admin cannot insert/move appointments into other orgs through the normal Calendar API. Cross-org administrative writes belong to Control Center / Agencies tooling.
- **Duplicate index `idx_appointments_org`** dropped in the migration. Say so if you'd rather leave it.
- **No `pgrst` reload risk** beyond the standard `NOTIFY` at end of migration.
- **Realtime publication** for `appointments` (set in `20260323110000`) is unaffected by RLS changes.

---

## J. Manual smoke checklist (for Chris after apply)

1. Agent (own user): can see/edit/delete only own appointments in current org.
2. Agent: cannot read appointments where `organization_id != my org` (try via crafted query in browser console).
3. Admin (same org): can read all appointments in their org.
4. Team Leader: can read appointments for `profiles.team_id = my team_id`.
5. Super Admin: can read appointments in their **current** org; cannot read appointments in other orgs via the normal Calendar SELECT (would need Control Center/Agencies path).
6. Non-Admin: cannot insert an appointment with `organization_id != get_org_id()` (PostgREST returns RLS rejection).
7. Update cannot move an appointment across orgs (WITH CHECK rejects).
8. Google "Sync Now" from Calendar header still imports events (HG-1 fix verified): `summary.imported` reflects new rows; new rows carry the expected `organization_id`.
9. Schedule appointment from a contact's `FullScreenContactView` (HG-2 fix verified) — succeeds, row carries org/user/created_by.
10. Dialer callback-scheduler still creates appointments (FloatingDialer untouched).
11. No console errors on Calendar page.

---

## K. Approval gate

Awaiting Chris approval on:
- **HG-1**: deploy v474 of `google-calendar-inbound-sync` to set `organization_id` from the user's profile before the NOT NULL migration.
- **HG-2**: surgical edit to `FullScreenContactView.tsx:1556` to set `organization_id`, `user_id`, `created_by` on the appointment insert.
- **Drop duplicate `idx_appointments_org`** in the migration.
- **DELETE policy keeps Team Leader same-team** (preserves current live behavior).

Once approved, sequence is:
1. Patch Edge Function and deploy v474. Verify deploy.
2. Patch `FullScreenContactView.tsx`.
3. Write + apply migration `20260527150000_appointments_tenant_hardening.sql` via `apply_migration`.
4. Hand-patch types.
5. Run `npx tsc --noEmit` and `npm test -- --run`.
6. Run live audits.
7. Append WORK_LOG entry + final context snapshot here.

No `git push` / merge unless Chris explicitly asks.

---

## Approval

Chris approved on 2026-05-24 with the following redlines via `AskUserQuestion`:
- HG-1 → **Approve v474 patch** (derive `organization_id` server-side; skip-with-error if missing).
- HG-2 → **Approve 3-field add** (`organization_id`, `user_id`, `created_by` in `FullScreenContactView` insert).
- Duplicate index → **Drop `idx_appointments_org`**.
- DELETE policy → **Restrict — owner / created_by / Admin / Super Admin only** (Team Leader same-team DELETE removed; tighter than legacy live policy).

All redlines applied as written.

---

## Final context snapshot

### Changes
- Deployed `google-calendar-inbound-sync` **v474** with org-id derivation + injection (`verify_jwt=false` preserved).
- Patched `src/components/contacts/FullScreenContactView.tsx` to set `organization_id`, `user_id`, `created_by` on the schedule-appointment insert (and expanded the `useAuth()` destructure to include `user`).
- Applied migration `20260527150000_appointments_tenant_hardening.sql`:
  - Guard `DO` blocks for helper fns and backfill safety.
  - Backfilled `organization_id` via `user_id -> profiles.organization_id` (preferred) / `created_by -> profile` (fallback) — 0 rows touched (live had 0 rows).
  - `ALTER COLUMN organization_id SET NOT NULL`.
  - New `appointments_updated_at BEFORE UPDATE` trigger executing `public.update_updated_at()`.
  - Added composite indexes `appointments_org_start_time_idx` and `appointments_user_start_time_idx`; dropped duplicate `idx_appointments_org`.
  - Replaced legacy `"Hierarchical Appointments Access"` FOR ALL policy with four helper-based per-command policies (`appointments_select` / `_insert` / `_update` / `_delete`).
- Hand-patched `src/integrations/supabase/types.ts` to mark `appointments.organization_id` non-nullable on Row, required on Insert, present (non-null) on Update.

### Decisions
- Appointments are tenant-owned. `organization_id` is required.
- Super Admin stays org-scoped in normal Calendar RLS; cross-org appointment inspection belongs in Control Center / Agencies tooling.
- Team Leader SELECT/UPDATE same-team preserved verbatim; DELETE narrowed per Chris's redline.
- INSERT and UPDATE `WITH CHECK` pin `organization_id = get_org_id()` for every writer, including Super Admin.
- Edge Function patch was the minimal possible change: no auth-mode change, no signature change.
- Frontend touch was the minimum required to keep an existing feature alive under the new schema (mirrors `CalendarContext.addAppointment` shape exactly).
- Calendar UI / settings / type source-of-truth / Google reliability deferred to Passes 1b / 2 / 3.

### Files touched
| Path | Kind |
|---|---|
| `supabase/migrations/20260527150000_appointments_tenant_hardening.sql` | new |
| `supabase/functions/google-calendar-inbound-sync/index.ts` | modified + deployed v474 |
| `src/components/contacts/FullScreenContactView.tsx` | modified |
| `src/integrations/supabase/types.ts` | hand-patched (`appointments` block only) |
| `WORK_LOG.md` | appended (newest first) |
| `implementation_plan.md` | this file |

### Migrations / deploys
- `20260527150000_appointments_tenant_hardening` applied to `jncvvsvckxhqgqvkppmj` via MCP `apply_migration` — success.
- `google-calendar-inbound-sync` deployed as **v474** via MCP `deploy_edge_function` — `verify_jwt=false` preserved; bundled `_shared/google-token.ts`.

### Verification
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → vitest not installed in remote execution environment (consistent with prior session note on 2026-05-24).
- Live audits via MCP `execute_sql`:
  - `appointments.organization_id` is `is_nullable = NO`.
  - `count(*) WHERE organization_id IS NULL` = 0; total rows = 0.
  - Exactly four policies on `public.appointments`: `appointments_select` / `_insert` / `_update` / `_delete`. Legacy `"Hierarchical Appointments Access"` gone.
  - Each policy expression references `get_org_id()`, `get_user_role()`, and/or `is_super_admin()`; no unconditional Super Admin OR clause anywhere.
  - INSERT + UPDATE `WITH CHECK` both pin `organization_id = get_org_id()`.
  - `appointments_updated_at` trigger present, BEFORE UPDATE, calling `public.update_updated_at()`.
  - Indexes match the plan: `appointments_org_start_time_idx`, `appointments_user_start_time_idx` present; `idx_appointments_org` absent.
  - `google-calendar-inbound-sync` live version = 474, `verify_jwt = false`.

### Manual check status
Pending Chris — see WORK_LOG manual smoke checklist (11 steps).

### Blockers / next steps
- None. Awaiting Chris's manual smoke + explicit push/merge decision (per directive, no `git push` and no merge initiated).
- Pass 1b candidates: Calendar settings cleanup, remove mock `initialAppointments` from `CalendarContext`, contact search consolidation.
- Pass 2: appointment type source-of-truth.
- Pass 3: Google sync reliability (DST, recurrence, owner-org changes).
