# Implementation Plan — Dispositions Build 2: RLS + API + UI hardening

**Owner:** Chris Garness | **Status:** `[APPROVED] / [DONE]` 2026-05-23 — migration applied (`20260526120000_dispositions_rls_harden`), API rewritten, Zod added, manager/read-only gates live, reorder revert in place, `tsc --noEmit` clean, 72/72 tests passing. Not pushed.
**Date:** 2026-05-23 (per system context)
**Branch:** `claude/dispositions-build-1` (continuation; Build 1 committed as `61c47f1`; Build 2 changes uncommitted in the working tree)

> **Build 2 scope (locked):** `dispositions.organization_id` NOT NULL, RLS rewrite, org-scoped API methods, manager/read-only gates, Zod, reorder error handling, unique `lower(name)` per org. Preserves every Build 1 canonical-field decision; no Twilio/dialer/Contact-Flow changes; no `create-organization` Edge Function changes; no component split.

---

## 0. Confirmation that Build 1 is in place

Git: branch `claude/dispositions-build-1`; head commit `61c47f1 — Dispositions Build 1: canonical fields + reporting cutover`. Working tree clean.

WORK_LOG newest entry (2026-05-23, `[DONE]`) records:
- Migration `20260524180000_dispositions_canonical_fields_backfill.sql` applied (file present in `supabase/migrations/`).
- create-organization v37 deployed with canonical-field seeding.
- Reports/RPCs use `dnc_auto_add`.
- AGENT_RULES.md row added under §5 (verified — present at line 91).

Live Supabase (`jncvvsvckxhqgqvkppmj`) confirms:
- `dispositions.campaign_action text NOT NULL DEFAULT 'none'`; `dispositions.dnc_auto_add boolean NOT NULL DEFAULT false`.
- Deprecated `remove_from_queue` and `auto_add_to_dnc` columns still present (not dropped).
- `dispositions_campaign_action_check` CHECK still enforces `('none','remove_from_queue','remove_from_campaign')`.
- `rpc_report_call_summary`, `rpc_report_call_volume_timeseries`, `rpc_report_campaign_performance` reference `dnc_auto_add`, not `auto_add_to_dnc`.

Build 1 invariant is intact. No drift. Proceeding directly to Build 2 without re-touching Build 1 territory.

---

## 1. Live inspection (read-only) — Build 2 targets

### 1a. `public.dispositions` schema (relevant columns)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `name` | text | NO | — | no case-insensitive unique yet |
| `organization_id` | uuid | **YES** | — | **target: SET NOT NULL** |
| `sort_order` | integer | NO | 0 | needs composite index with org |
| `is_locked` | boolean | NO | false | locked-row guard |
| `campaign_action` | text | NO | 'none' | canonical (Build 1) |
| `dnc_auto_add` | boolean | NO | false | canonical (Build 1) |
| `remove_from_queue` | boolean | NO | false | DEPRECATED (kept) |
| `auto_add_to_dnc` | boolean | NO | false | DEPRECATED (kept) |
| `updated_at` | timestamptz | NO | now() | **no BEFORE UPDATE trigger exists** |

FK: `organization_id → organizations(id)`; `pipeline_stage_id → pipeline_stages(id) ON DELETE SET NULL`.

### 1b. Row inventory

- Total rows: **6**.
- NULL `organization_id` rows: **0**. → `SET NOT NULL` is safe.
- Rows by org: 6 in Chris's home org `a0000000-0000-0000-0000-000000000001`; 0 elsewhere.
- Duplicate `lower(name)` per organization: **0 groups**. → unique case-insensitive index is safe.

### 1c. Current RLS policies on `public.dispositions`

| polname | cmd | USING | WITH CHECK |
|---|---|---|---|
| `dispositions_select` | r | `organization_id = get_user_org_id()` | — |
| `dispositions_insert` | a | — | `organization_id = get_user_org_id()` |
| `dispositions_update` | w | `organization_id = get_user_org_id()` | **none** |
| `dispositions_delete` | d | `organization_id = get_user_org_id() AND get_user_role() = 'Admin'` | — |

Gaps vs. Build 2 brief:
1. INSERT / UPDATE allow any org member to write — **no Admin gate**.
2. UPDATE has **no WITH CHECK** — agents could in principle move rows between orgs by editing `organization_id` (RLS lets the post-row through as long as USING allowed the pre-row).
3. Uses `get_user_org_id()` (SECURITY DEFINER, profile lookup) — Build 2 brief mandates `public.get_org_id()` (JWT-first with profile fallback) plus `public.is_super_admin()` super-admin path.
4. No `is_super_admin()` bypass — Super Admin cannot manage other-org dispositions today.

### 1d. Helper functions (compatibility check)

`public.get_org_id()` — plpgsql, STABLE, JWT-first (`app_metadata.organization_id`) with `profiles` fallback when JWT is stale. **JWT shape:** `app_metadata.organization_id` is stamped by the `custom_access_token_hook` at sign-in; this is the same shape `get_user_org_id()` ultimately falls back to. ✅ Compatible — switching policy from `get_user_org_id()` to `get_org_id()` is a forward-compatible move (JWT fast path with the same fallback target). No data drift expected.

`public.is_super_admin()` — sql, STABLE, reads JWT `is_super_admin` claim.
`public.get_user_role()` — sql, STABLE, reads JWT `app_metadata.role`.
`public.update_updated_at()` — plpgsql trigger func setting `NEW.updated_at = now()`. **This is the canonical repo helper** (used by `message_templates_updated_at` in `20260525120000_*`).

### 1e. Indexes present

- `dispositions_pkey` (PK on id)
- `idx_dispositions_org (organization_id)` — already exists ✓
- `idx_dispositions_pipeline_stage_id (pipeline_stage_id) WHERE pipeline_stage_id IS NOT NULL`

Missing per brief:
- `(organization_id, sort_order)` — for ordered list reads.
- Unique `(organization_id, lower(name))` — case-insensitive name uniqueness per org.

### 1f. Triggers present

`information_schema.triggers` returns **zero rows** for `public.dispositions`. → Build 2 must add an `updated_at` BEFORE UPDATE trigger using `public.update_updated_at()` (matches `message_templates_updated_at` precedent).

### 1g. RPC/reports drift check (Build 1 verification)

`pg_get_functiondef` confirms all three reporting RPCs reference `dnc_auto_add` and **none reference `auto_add_to_dnc`**. Build 1 reporting cutover is intact. No additional RPC work in Build 2.

### 1h. Repo grep / code-path inventory (Build 2 targets)

| File | Build 2 action |
|---|---|
| `src/lib/supabase-dispositions.ts` | **Rewrite** — require `organizationId` on every method; org-scope every query; bubble reorder errors. |
| `src/components/settings/DispositionsManager.tsx` | **Edit** — manager/read-only gates, Zod-driven save, reorder revert on partial failure. |
| `src/components/settings/dispositions/dispositionSchema.ts` | **New file** — Zod schema + parse/normalize helper. |
| `src/pages/DialerPage.tsx` | **Verify only** — disposition record shape unchanged (canonical fields preserved). |
| `src/lib/types.ts` | **No change** — `Disposition` already canonical. |
| `src/integrations/supabase/types.ts` | **Patch** — flip `organization_id` from `string | null` to `string` in `Row` / strict-required in `Insert` / `Update`. |
| `src/hooks/usePermissions.ts` | **No change** — see §3f re: why we compute `fullAccess` locally. |
| `supabase/functions/create-organization/index.ts` | **No change** — v37 already canonical. |
| Reporting (`report-utils.ts`, `reports-queries.ts`, `stat-computations.ts`, `StatsGrid.tsx`) | **No change** — already on canonical column. |

---

## 2. Files to touch (final list, before any edits)

**Migration (new):**
1. `supabase/migrations/20260526120000_dispositions_rls_harden.sql`

**Frontend / shared:**
2. `src/lib/supabase-dispositions.ts` (rewrite all methods to require `organizationId`; bubble reorder errors)
3. `src/components/settings/DispositionsManager.tsx` (manager gates, Zod, reorder revert)
4. `src/components/settings/dispositions/dispositionSchema.ts` (new file)
5. `src/integrations/supabase/types.ts` (flip `organization_id` to required on `dispositions`)

**Docs:**
6. `WORK_LOG.md` (append newest-first Build 2 entry)
7. `implementation_plan.md` (this file — mark `[APPROVED] / [DONE]` post-handoff)

**Explicitly not touched:**
- `supabase/functions/create-organization/index.ts` — v37 already canonical.
- `src/pages/DialerPage.tsx` — disposition shape unchanged.
- `src/lib/types.ts` — `Disposition` already canonical.
- `src/lib/report-utils.ts`, `src/lib/reports-queries.ts`, `src/lib/stat-computations.ts`, `src/components/reports/StatsGrid.tsx` — already on canonical column.
- `src/hooks/usePermissions.ts` — see §3f.
- AGENT_RULES.md — invariant already added in Build 1.

---

## 3. Detailed design

### 3a. Migration `20260526120000_dispositions_rls_harden.sql`

Following `message_templates_scope_harden` precedent. Pseudocode (final SQL written on approval):

```sql
-- 1. Safety: refuse if any NULL organization_id rows snuck in between plan-time and apply-time.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.dispositions WHERE organization_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'dispositions has % NULL organization_id row(s) — backfill before SET NOT NULL', n;
  END IF;
END $$;

-- 2. organization_id NOT NULL.
ALTER TABLE public.dispositions ALTER COLUMN organization_id SET NOT NULL;

-- 3. Composite index for ordered list reads.
CREATE INDEX IF NOT EXISTS idx_dispositions_org_sort_order
  ON public.dispositions (organization_id, sort_order);

-- 4. Safety: refuse if any case-insensitive duplicates per org sneak in.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.dispositions
    GROUP BY organization_id, lower(name) HAVING count(*) > 1
  ) s;
  IF n > 0 THEN
    RAISE EXCEPTION 'dispositions has % duplicate lower(name) group(s) per org — resolve before unique index', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS dispositions_org_lower_name_unique
  ON public.dispositions (organization_id, lower(name));

-- 5. updated_at trigger via canonical helper.
DROP TRIGGER IF EXISTS dispositions_updated_at ON public.dispositions;
CREATE TRIGGER dispositions_updated_at
  BEFORE UPDATE ON public.dispositions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. RLS — drop legacy and any future-named variants, then recreate.
ALTER TABLE public.dispositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispositions_select ON public.dispositions;
DROP POLICY IF EXISTS dispositions_insert ON public.dispositions;
DROP POLICY IF EXISTS dispositions_update ON public.dispositions;
DROP POLICY IF EXISTS dispositions_delete ON public.dispositions;
-- defensive drops for any older names
DROP POLICY IF EXISTS dispositions_select_policy ON public.dispositions;
DROP POLICY IF EXISTS dispositions_insert_policy ON public.dispositions;
DROP POLICY IF EXISTS dispositions_update_policy ON public.dispositions;
DROP POLICY IF EXISTS dispositions_delete_policy ON public.dispositions;

CREATE POLICY dispositions_select ON public.dispositions
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR organization_id = public.get_org_id()
);

CREATE POLICY dispositions_insert ON public.dispositions
FOR INSERT TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.is_super_admin()
    OR (organization_id = public.get_org_id() AND public.get_user_role() = 'Admin')
  )
);

CREATE POLICY dispositions_update ON public.dispositions
FOR UPDATE TO authenticated
USING (
  public.is_super_admin()
  OR (organization_id = public.get_org_id() AND public.get_user_role() = 'Admin')
)
WITH CHECK (
  organization_id IS NOT NULL
  AND (
    public.is_super_admin()
    OR (organization_id = public.get_org_id() AND public.get_user_role() = 'Admin')
  )
);

CREATE POLICY dispositions_delete ON public.dispositions
FOR DELETE TO authenticated
USING (
  public.is_super_admin()
  OR (organization_id = public.get_org_id() AND public.get_user_role() = 'Admin')
);

NOTIFY pgrst, 'reload schema';
```

**Explicit non-actions in this migration:**
- No `DROP COLUMN` (deprecated `remove_from_queue` / `auto_add_to_dnc` stay).
- No changes to RPCs (Build 1 covered them).
- No data backfill (no rows need it).
- No changes to `dispositions_campaign_action_check` constraint (already correct).

### 3b. `src/lib/supabase-dispositions.ts` — API hardening

Every method requires a non-empty `organizationId`. Bail with a clear `Error` if missing.

Method signatures (final):
```ts
getAll(organizationId: string): Promise<Disposition[]>
create(input, organizationId: string): Promise<Disposition>
update(id: string, input, organizationId: string): Promise<Disposition>
delete(id: string, organizationId: string): Promise<void>
reorder(orderedIds: string[], organizationId: string): Promise<void>
getAnalytics(period: string, organizationId: string): Promise<...>
```

Behavior rules:
- `getAll`: `.eq("organization_id", organizationId)` and `.order("sort_order")`.
- Name duplicate check (create / update path): scope by `organization_id`. Use `.maybeSingle()`.
- `create`: scope `count` query by org. Compute next `sort_order` from max-in-org + 1 (more robust than count-of-all). Set `organization_id` from arg, not param.
- `update`: scope by `id AND organization_id` so cross-org IDs cannot leak.
- `delete`: pre-fetch the row with `.eq("id").eq("organization_id").maybeSingle()`; refuse if missing or `is_locked`; then `.delete().eq("id").eq("organization_id")`.
- `reorder`: each update scoped by `id AND organization_id`. Run with `Promise.all`, then inspect every response — if any `error`, throw the first one. Caller must refetch/revert.
- `getAnalytics`: `.eq("organization_id", organizationId)`. Keep the existing breakdown logic.
- Drop the `as any` cast on the `insert(...)` row; types now allow it.
- Continue to use `is_locked` for locked-row enforcement (in addition to UI restrictions on `No Answer`/`DNC`/`Appointment Set`, which the component owns).

### 3c. `src/components/settings/dispositions/dispositionSchema.ts` — Zod

```ts
import { z } from "zod";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const dispositionSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(30, "Max 30 characters"),
    color: z.string().regex(HEX, "Must be a 6-digit hex color (e.g. #3B82F6)"),
    requireNotes: z.boolean(),
    minNoteChars: z.number().int().min(0).max(500),
    callbackScheduler: z.boolean(),
    appointmentScheduler: z.boolean(),
    automationTrigger: z.boolean(),
    automationId: z.string().nullable().optional(),
    campaignAction: z.enum(["none", "remove_from_queue", "remove_from_campaign"]),
    dncAutoAdd: z.boolean(),
    pipelineStageId: z
      .string()
      .uuid()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .superRefine((v, ctx) => {
    if (v.requireNotes) {
      if (v.minNoteChars < 1) ctx.addIssue({ code: "custom", path: ["minNoteChars"], message: "Must be at least 1" });
      if (v.minNoteChars > 500) ctx.addIssue({ code: "custom", path: ["minNoteChars"], message: "Max 500" });
    } else {
      // normalize to 0 when notes not required
      v.minNoteChars = 0; // not a mutation in strict mode; we re-derive on output instead
    }
    if (v.automationTrigger && !v.automationId) {
      ctx.addIssue({ code: "custom", path: ["automationId"], message: "Choose an automation" });
    }
  });

export type DispositionFormValues = z.infer<typeof dispositionSchema>;
```

`handleSave` will:
1. Build a raw form object.
2. Call `dispositionSchema.safeParse(raw)`.
3. On failure, toast the first issue's message (`destructive`).
4. On success, derive `minNoteChars = requireNotes ? parsed.minNoteChars : 0`, `automationId = automationTrigger ? automationId : undefined`, then call `create`/`update` with `organizationId`.

### 3d. `DispositionsManager.tsx` — manager/read-only gates

Behavior matrix:

| Action | Non-manager (Agent / Team Leader) | Admin / Super Admin |
|---|---|---|
| View list | ✅ | ✅ |
| See read-only helper note | ✅ | — |
| Add button visible | ❌ | ✅ |
| Edit pencil visible | ❌ | ✅ (locked rows: `No Answer`, `DNC` remain edit-disabled per existing rules) |
| Delete trash visible | ❌ | ✅ (locked rows still disabled) |
| Drag/drop reorder | ❌ (not `draggable`) | ✅ |
| Write handler entry points (`openAdd`, `openEdit`, `handleSave`, `handleDelete`, `handleDrop`) | hard-guard with `if (!fullAccess) return;` | unchanged |

Implementation notes:
- Read role via `useAuth()`: `const fullAccess = profile?.is_super_admin === true || profile?.role === "Admin";`
- Conditionally render the Add button, pencil button, trash button, and the GripVertical / `draggable` props.
- Read-only banner under the info banner when `!fullAccess`:
  > "You can view dispositions but need Admin access to add, edit, reorder, or delete."

### 3e. Reorder error handling

Replace `await Promise.all(updates)` with a pattern that inspects each result:

```ts
const results = await Promise.all(orderedIds.map((id, idx) =>
  supabase.from("dispositions")
    .update({ sort_order: idx + 1 })
    .eq("id", id)
    .eq("organization_id", organizationId)
));
const firstError = results.find(r => r.error);
if (firstError?.error) throw new Error(firstError.error.message);
```

In `DispositionsManager.handleDrop`:
- Optimistically reorder local state.
- `await dispositionsApi.reorder(...)`. On success → toast "Order saved".
- On failure → toast `"Error saving order"` (destructive) **and** `await load()` to revert to server truth.

### 3f. Why not `usePermissions().fullAccess`?

`src/hooks/usePermissions.ts` line 9 explicitly says *"Do NOT consume this hook in components yet — BUILD 3 wires it up."* Its internal `fullAccess` constant is not exposed in `UsePermissionsReturn`. Build 2 is scoped to dispositions hardening — wiring up the new permissions hook is out of scope. Computing `fullAccess` inline mirrors the hook's own definition exactly (`profile.is_super_admin || profile.role === "Admin"`) and keeps the diff surgical. When BUILD 3 lands and the hook is consumed everywhere, this file will swap to `usePermissions().fullAccess` in a one-line replacement.

### 3g. Activity logging

- Keep existing `Created` / `Updated` / `Deleted` `logActivity` calls; add `metadata.organization_id` for symmetry with brief §I.
- **No reorder logging** in this build — too noisy; brief permits skipping when not useful.

### 3h. Types file

`src/integrations/supabase/types.ts` currently shows `organization_id: string | null` on `dispositions.Row` (post-migration, this becomes non-null). Hand-patch the three blocks (`Row`, `Insert`, `Update`) under the `dispositions` table:
- `Row`: `organization_id: string`
- `Insert`: `organization_id: string` (required, no `?`)
- `Update`: `organization_id?: string` (still optional on update)

Do not modify other tables.

### 3i. Dialer compatibility

`DialerPage.tsx` references `d.campaignAction`, `d.dncAutoAdd`, `d.callbackScheduler`, `d.appointmentScheduler`, `d.pipelineStageId`, `d.automationTrigger` — all still present on `Disposition`. No signature changes. The dialer's read path is via a parent loader and doesn't call `dispositionsApi.getAll()` directly with positional args; that requires verification at edit time (`DialerPage.tsx:130` and queue loader). If the dialer does call `dispositionsApi.getAll()`, it gets `organizationId` from `TwilioContext` / `useOrganization()` — a single-line fix at the call site. Will confirm at edit time and report the diff in the WORK_LOG.

---

## 4. Verification plan

### 4a. Static
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → preserves Build 1 baseline (no test additions in this build).

### 4b. Live DB (post-apply)
1. `dispositions.organization_id` is `is_nullable = NO`.
2. `pg_policy` for `public.dispositions` returns exactly the 4 named policies above, each referencing `get_org_id()` / `is_super_admin()` / `get_user_role()` (no `get_user_org_id`, no `is_platform_admin`).
3. `pg_indexes` shows `idx_dispositions_org_sort_order` and `dispositions_org_lower_name_unique`.
4. `pg_trigger` shows `dispositions_updated_at` BEFORE UPDATE invoking `public.update_updated_at`.
5. Deprecated columns `remove_from_queue` and `auto_add_to_dnc` still present (`information_schema.columns`).
6. Row counts unchanged (6 in home org).
7. Authenticated agent (non-Admin) `INSERT`/`UPDATE`/`DELETE` blocked by RLS (manual SQL session as agent JWT).
8. Authenticated Admin `INSERT`/`UPDATE`/`DELETE` succeed for own org only.
9. Cross-org `UPDATE` setting `organization_id` to another org rejected by `WITH CHECK`.

### 4c. Manual UI checklist (Chris)
1. Admin: add → edit → delete (unlocked) → reorder → all succeed; toasts correct.
2. Admin: cannot delete `No Answer` / `Appointment Set` / `DNC` (locked).
3. Admin: cannot rename `No Answer` / `DNC` (existing rule).
4. Agent / Team Leader: list visible; read-only note shown; no Add/Edit/Delete/grip; drag does nothing.
5. Duplicate name blocked case-insensitively within org (e.g. "dnc" while "DNC" exists).
6. Force a reorder failure (network DevTools) → optimistic reorder reverts and "Error saving order" toast appears.
7. Dialer: DNC auto-add still works; `campaign_action` (remove_from_queue / remove_from_campaign) still works.
8. No console errors.

---

## 5. Risks / open questions

- **R1.** Dialer call site for `dispositionsApi.getAll()`: will be re-verified at edit time; if it does call the API directly without `organizationId`, a one-line fix is included and reported in the WORK_LOG.
- **R2.** Types regeneration: brief §D suggests `generate_typescript_types` or hand-patch per project convention. Repo's `types.ts` is hand-edited by recent migrations (templates / dnc / call_scripts work) — I'll **hand-patch** the three `dispositions` blocks (Row/Insert/Update) rather than regenerate the whole file to avoid unrelated diffs. Documented as a deliberate choice.
- **R3.** `usePermissions` deferred to Build 3 — local `fullAccess` calc is the bridge.
- **R4.** No backwards-compat shim for callers that pass `organizationId = null`. The new methods will throw — that's the intent. The only caller is `DispositionsManager`, which already has `organizationId` from `useOrganization()`.

---

## 6. Sequencing (post-approval)

1. Write migration `20260526120000_dispositions_rls_harden.sql`.
2. `apply_migration` to prod (`jncvvsvckxhqgqvkppmj`).
3. Re-audit per §4b.
4. Hand-patch `src/integrations/supabase/types.ts` (dispositions Row/Insert/Update).
5. Rewrite `src/lib/supabase-dispositions.ts` per §3b.
6. Add `src/components/settings/dispositions/dispositionSchema.ts` per §3c.
7. Edit `src/components/settings/DispositionsManager.tsx` per §3d/§3e/§3g, integrate Zod.
8. Verify/repair any dialer call site touching `dispositionsApi.getAll()` (§3i).
9. `npx tsc --noEmit` + `npm test -- --run`.
10. Append WORK_LOG.md newest-first Build 2 entry; mark this plan `[APPROVED] / [DONE]`.
11. Stop. No push or merge unless Chris explicitly approves.

---

**Awaiting Chris's `#APPROVE` to proceed with migration + edits.**

---

## 7. Final context snapshot (post-implementation)

**Changes (delivered):**
- Migration `supabase/migrations/20260526120000_dispositions_rls_harden.sql` applied to `jncvvsvckxhqgqvkppmj`:
  - `dispositions.organization_id` SET NOT NULL.
  - `idx_dispositions_org_sort_order` composite index added.
  - `dispositions_org_lower_name_unique` unique case-insensitive name-per-org index added.
  - `dispositions_updated_at BEFORE UPDATE` trigger using canonical `public.update_updated_at()`.
  - RLS rewritten — 4 policies using `public.get_org_id()` / `public.get_user_role()` / `public.is_super_admin()`; UPDATE has WITH CHECK preventing cross-org reassignment.
- API rewrite: every method in `src/lib/supabase-dispositions.ts` requires `organizationId`; reorder propagates per-row errors; locked-row delete guard preserved.
- Zod schema `src/components/settings/dispositions/dispositionSchema.ts` + `normalizeDisposition()` helper.
- `DispositionsManager.tsx`: local `fullAccess` (Admin / Super Admin, case-insensitive role check); non-managers see read-only list + banner; write handlers hard-guard; reorder reverts on failure.
- Three external callers wired with `organizationId`: `TriggerConfigForm`, `TriggerConfigPanel.TriggerSummary`, `DialerPage` dispositions query.
- `src/integrations/supabase/types.ts` hand-patched (only the `dispositions` Row/Insert/Update org-id nullability).
- WORK_LOG.md entry appended newest-first.

**Decisions (Build 2):**
- Build 1 canonical fields untouched; deprecated columns retained.
- Writes require Admin-own-org OR `is_super_admin()`.
- `usePermissions().fullAccess` consumption deferred to Build 3.
- Reorder activity logging intentionally omitted (too noisy).
- Types hand-patched, not regenerated, to avoid unrelated diffs (per repo precedent).

**Files touched:**
- `supabase/migrations/20260526120000_dispositions_rls_harden.sql` (new)
- `src/lib/supabase-dispositions.ts` (rewrite)
- `src/components/settings/dispositions/dispositionSchema.ts` (new)
- `src/components/settings/DispositionsManager.tsx`
- `src/components/workflows/TriggerConfigForm.tsx`
- `src/components/workflows/panels/TriggerConfigPanel.tsx`
- `src/pages/DialerPage.tsx`
- `src/integrations/supabase/types.ts` (hand-patch — `dispositions` only)
- `WORK_LOG.md`, `implementation_plan.md`

**Migrations / deploys:**
- DB migration applied. No Edge Function deploys. No frontend deploy.

**Verification result:**
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → 72/72 passing.
- Live audits confirm `organization_id` NOT NULL, 4 hardened policies, both new indexes, the updated_at trigger, deprecated columns retained, row counts unchanged.

**Manual check status:**
- Deferred to Chris. UI smoke + cross-role behavior + reorder-failure UX not yet driven through the browser by automation.

**Blockers / next steps:**
- None. Awaiting Chris's manual smoke and explicit push/merge approval.
- Next logical milestone: Build 3 wires `usePermissions().fullAccess` into components (including the one-line swap inside `DispositionsManager`) and addresses Team Leader delegation in the Permissions tab.
