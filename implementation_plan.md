# Settings → Call Scripts Pass 1 — Verification-First Implementation Plan

**Date:** 2026-05-23
**Branch:** `claude/pensive-lovelace-8VwlI` (to be created off latest `main`)
**Status:** Plan only — **no code, migrations, or Supabase commands executed yet**

---

## Pre-flight (completed)

| Step | Result |
|------|--------|
| Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` | Done |
| WORK_LOG conflicts | **None.** Newest entries are Company Branding (2026-05-22) and Custom Menu Links RLS harden (2026-05-22). No in-flight Call Scripts work. |
| Reference patterns identified | `20260524120000_custom_menu_links_rls_harden.sql` + `src/components/settings/CustomMenuLinks.tsx` + `customMenuLinkSchema.ts` — close analog (same canManage shape, same RLS shape). |

---

## A. Live verification gates (to run with Chris's read-only approval BEFORE the migration)

These are **read-only** checks via Supabase MCP. Listed here so Chris can approve the audit in one shot before any write.

1. `list_tables(schema='public', name='call_scripts')` → confirm columns `organization_id (uuid, nullable=?)`, `created_at`, `updated_at`.
2. `execute_sql`:
   ```sql
   SELECT column_name, is_nullable, data_type
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name='call_scripts'
   ORDER BY ordinal_position;
   ```
3. Foreign keys:
   ```sql
   SELECT conname, pg_get_constraintdef(oid)
   FROM pg_constraint
   WHERE conrelid='public.call_scripts'::regclass AND contype='f';
   ```
4. Trigger check:
   ```sql
   SELECT tgname, pg_get_triggerdef(oid)
   FROM pg_trigger
   WHERE tgrelid='public.call_scripts'::regclass AND NOT tgisinternal;
   ```
5. RLS policies:
   ```sql
   SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
          pg_get_expr(polwithcheck, polrelid) AS check_expr
   FROM pg_policy WHERE polrelid='public.call_scripts'::regclass;
   ```
6. Row count + NULL org check (gate the NOT NULL migration):
   ```sql
   SELECT count(*) AS total,
          count(*) FILTER (WHERE organization_id IS NULL) AS null_org
   FROM public.call_scripts;
   ```
   - If `total=0` → SET NOT NULL is low risk.
   - If `null_org > 0` → **STOP** and report before applying NOT NULL.
7. Helper parity (only if RLS rewrite is approved):
   ```sql
   SELECT public.get_org_id() AS new_helper, public.get_user_org_id() AS old_helper;
   SELECT proname FROM pg_proc WHERE proname IN ('get_org_id','get_user_org_id','is_super_admin','get_user_role');
   ```
   - If `get_org_id()` and `get_user_org_id()` diverge for the active user → **STOP** and report.

I will not run any of these without `#APPROVE` from Chris.

---

## B. Schema/RLS hardening migration (after audit passes)

**File:** `supabase/migrations/20260524130000_harden_call_scripts.sql`

Will include (idempotent, guarded):

1. `ALTER TABLE public.call_scripts ALTER COLUMN organization_id SET NOT NULL;` — only if audit shows zero NULL rows.
2. Add FK only if missing:
   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid='public.call_scripts'::regclass
         AND contype='f'
         AND conname='call_scripts_organization_id_fkey'
     ) THEN
       ALTER TABLE public.call_scripts
         ADD CONSTRAINT call_scripts_organization_id_fkey
         FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
     END IF;
   END$$;
   ```
3. `updated_at` trigger — reuse canonical `public.update_updated_at()` (already used by `pipeline_stages`, `custom_fields`, `lead_sources`, `calendar_integrations`, etc.):
   ```sql
   DROP TRIGGER IF EXISTS call_scripts_updated_at ON public.call_scripts;
   CREATE TRIGGER call_scripts_updated_at
     BEFORE UPDATE ON public.call_scripts
     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
   ```
4. Replace permissive/legacy policies with the canonical shape (mirrors Custom Menu Links):
   - DROP existing `call_scripts_*` policies + the original "Allow authenticated users to view/manage call scripts".
   - SELECT: `organization_id = public.get_org_id() OR public.is_super_admin()`
   - INSERT WITH CHECK: `organization_id IS NOT NULL AND (is_super_admin() OR (organization_id = get_org_id() AND get_user_role() = 'Admin'))`
   - UPDATE USING: `is_super_admin() OR (organization_id = get_org_id() AND get_user_role() = 'Admin')`; WITH CHECK adds `organization_id IS NOT NULL`.
   - DELETE USING: same as UPDATE USING.
5. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` reaffirmed.
6. End with `NOTIFY pgrst, 'reload schema';`
7. Do **not** use `super_admin_own_org()` — platform Super Admin must reach across orgs for this table.

If audit shows existing rows with NULL `organization_id`, the NOT NULL step will be deferred and the migration will be rewritten or split — Chris notified first.

---

## C. Frontend manager / read-only gates

**File:** `src/components/settings/CallScripts.tsx`

1. Derive `canManage` consistent with Custom Menu Links:
   ```ts
   const { organizationId, role, isSuperAdmin } = useOrganization();
   const canManage = Boolean(isSuperAdmin || role?.toLowerCase() === "admin");
   ```
2. Hide write affordances for non-managers:
   - Header `Add Script` button
   - Empty-state `Add Script` button
   - Row `Switch` (active toggle)
   - Row kebab menu (Edit Name / Duplicate / Delete)
   - Editor name `<input>` → render as plain text
   - Product type Popover trigger → render as static badge
   - Toolbar mutation buttons + Merge Fields menu (hide entire toolbar when read-only)
   - `Save Changes` button
   - Textarea → swap for read-only rendered content (preview-style block; keep word count)
3. Add a small helper note above the list when `!canManage`:
   > Call scripts are managed by agency admins. Additional delegation will be handled through Permissions.
4. Guard every write handler at function entry:
   ```ts
   if (!canManage) return;
   ```
   Covers: `handleAdd`, `toggleActive`, `duplicateScript`, `confirmDelete`, `startRename`, `commitRename`, `changeProductType`, `changeEditorName`, `insertMergeField`, `wrapSelection`, `handleSave`. RLS remains the real boundary.

---

## D. Zod validation

**New file:** `src/components/settings/call-scripts/callScriptSchema.ts`

Exports:
```ts
export const PRODUCT_TYPES = ["Term Life","Whole Life","IUL","Final Expense","Annuities","Custom"] as const;
export const productTypeSchema = z.enum(PRODUCT_TYPES);

export const callScriptBaseSchema = z.object({
  name: z.string().trim().min(1, "Script name is required").max(60, "Max 60 characters"),
  product_type: productTypeSchema,
  active: z.boolean(),
  content: z.string().max(50_000, "Content too long").default(""),
});

export const callScriptInsertSchema = callScriptBaseSchema.extend({
  organization_id: z.string().uuid("Organization is required"),
});

export const callScriptUpdateSchema = callScriptBaseSchema.partial();
```

Component changes:
- Add modal parses with `callScriptInsertSchema` before insert and shows field error under name (already has the visual slot).
- Rename parses just `{ name }` via `callScriptBaseSchema.pick({ name: true })`.
- `handleSave` parses `{ name, product_type, content }` and only sends parsed/normalized values.
- Toggle/duplicate use base schema where applicable.

---

## E. Scope reads + mutations by `organization_id`

In `CallScripts.tsx`:

1. `fetchScripts()`:
   - If `!organizationId`: `setScripts([]); setLoading(false); return;`
   - Add `.eq("organization_id", organizationId)` to the SELECT.
   - Re-run via `useEffect` dependency on `organizationId` (currently `[]`).
2. Realtime channel: keep, but the change handler still calls `fetchScripts(false)` which now scopes by org.
3. INSERTs (`handleAdd`, `duplicateScript`): require `organizationId`; bail with toast if missing. Drop `as any` casts now that types include `organization_id`.
4. UPDATEs (`toggleActive`, `commitRename`, `handleSave`, future product-type persist): add `.eq("organization_id", organizationId)` after `.eq("id", ...)` unconditionally.
5. DELETE (`confirmDelete`): add `.eq("organization_id", organizationId)`.
6. Do not add new `.maybeSingle()` lookups — none are needed.

---

## F. Optimistic update / error handling cleanup

- `toggleActive`: keep optimistic flip; on error → `fetchScripts(false)` (already there). Move success toast to fire **after** awaited response succeeds (currently OK, but ensure return early on error so toast only runs on success).
- `commitRename`: currently optimistic, then awaits; on error → `fetchScripts(false)` to revert. Keep, but move the success toast strictly after success branch.
- `duplicateScript`, `handleAdd`, `confirmDelete`: already update local state only after success — leave structure, ensure toasts only on the success path. Add `fetchScripts(false)` on failure paths where local state was already mutated (delete optimism stays as-is; insert/dup do not mutate before success).
- `handleSave`: already correct (success-then-local). Keep.
- `changeProductType` / `changeEditorName` are local-only edits buffered until `handleSave`. No backend call yet. Mark dirty.

---

## G. Component size

- CallScripts.tsx is currently 856 lines. Pass 1 will likely add a few dozen lines for `canManage` branches + Zod parsing. Full split is **Pass 2** — only the Zod schema file is extracted in Pass 1.

---

## Files to touch

**New:**
- `supabase/migrations/20260524130000_harden_call_scripts.sql`
- `src/components/settings/call-scripts/callScriptSchema.ts`

**Modified:**
- `src/components/settings/CallScripts.tsx`
- `WORK_LOG.md` (newest-first entry on completion)
- `implementation_plan.md` (this file, already drafted)

**Possibly regenerated (only if non-null FK changes type narrowing):**
- `src/integrations/supabase/types.ts` — only if `generate_typescript_types` MCP output differs and types are needed to remove `as any`. If not needed, skipped.

---

## Verification plan

```bash
npx tsc --noEmit
npm test -- --run
```

Manual (Chris):
- Admin: add/rename/edit content/change product type/toggle active/duplicate/delete — all rows carry `organization_id`.
- Super Admin: same controls via `useOrganization().isSuperAdmin`; settings UI mutations still `.eq("organization_id", organizationId)`.
- Agent / Team Leader: read-only banner shown, no controls visible, RLS denies direct writes.
- Validation: empty/long name rejected; invalid product type rejected; content saves.
- Realtime: subscription still triggers org-scoped refetch.
- No console errors.

---

## Approval gates

Chris, please reply with the approval message that matches the scope you want:

- **Read-only audit only (step A):**
  `#APPROVE: Call Scripts Pass 1 — run read-only audit (steps A1–A7)`
- **Full Pass 1 (after audit passes):**
  `#APPROVE: Call Scripts Pass 1 — apply migration + frontend changes` (this also implicitly includes `#APPROVE_RLS_CHANGE` for `call_scripts`)
- **Push to working branch only, no merge to main** — default; I will commit to `claude/pensive-lovelace-8VwlI` and not merge.

No file edits, migrations, or Supabase write operations will run until you reply with one of the above.

---

## Risk / scope guardrails

- Will not change Twilio/dialer behavior or `DialerPage` script consumption.
- Will not build campaign/product/lead-source script assignment.
- Will not build version history or permissions infrastructure changes.
- Will not fully split CallScripts.tsx in this pass.
- Will not touch realtime architecture beyond ensuring the refetch is org-scoped.
- Will not push to `main` without explicit approval.
