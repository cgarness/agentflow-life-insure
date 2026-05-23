# Implementation Plan — Settings → Email & SMS Templates: Agency/Personal scopes + RLS harden

**Owner:** Chris Garness | **Status:** Awaiting Chris's `#APPROVE` before any edits, migrations, or deploys.
**Date:** 2026-05-23

---

## 0. Product decision (locked)

- Templates have only **two scopes**: `agency` and `personal`.
- **No Global runtime templates.** Launch defaults will later be copied into each new org as editable Agency templates (out of scope here).
- **Agency templates** — org-wide; created/edited/deleted by **Admin** + **platform Super Admin** only.
- **Personal templates** — owned by `created_by = auth.uid()`; visible only to the owner (+ Super Admin via RLS for platform tooling).
- **Settings Super Admin precedent** (DNC / Call Scripts pattern): RLS uses `public.is_super_admin()`, frontend uses `useOrganization().isSuperAdmin`. **Do NOT** use Control Center `platform_role` / `is_platform_admin()` / `useIsPlatformAdmin()`.
- Permissions-tab delegation (Team Leader, etc.) **deferred**.

---

## 1. Live inspection findings (informs the migration)

### 1a. `public.message_templates` schema (production `jncvvsvckxhqgqvkppmj`)
- **Row count: 0** (production table is empty — safe to add NOT NULL and new constraints without backfill risk).
- Existing columns: `id, name (NOT NULL), type (nullable, CHECK ∈ {email,sms}), subject (nullable), content (NOT NULL), created_at, updated_at, organization_id (NULLABLE, FK → organizations), attachments (jsonb default '[]'), category (nullable, CHECK enum)`.
- **`scope` column does NOT exist** — net-new.
- **`created_by` column does NOT exist** — net-new.
- **`updated_at` trigger does NOT exist** — net-new (will use canonical `public.update_updated_at`).
- Indexes: only PK. Will add three composites.
- Constraints: PK, FK to organizations, type CHECK, category CHECK.

### 1b. Existing RLS on `message_templates`
| Policy | Cmd | Qual | With check |
|---|---|---|---|
| `message_templates_select` | SELECT | `organization_id = get_user_org_id()` | — |
| `message_templates_insert` | INSERT | — | `organization_id = get_user_org_id() AND get_user_role() = 'Admin'` |
| `message_templates_update` | UPDATE | `organization_id = get_user_org_id() AND get_user_role() = 'Admin'` | — |
| `message_templates_delete` | DELETE | `organization_id = get_user_org_id() AND get_user_role() = 'Admin'` | — |

**Gaps:** no Super Admin path; no Personal-vs-Agency split; no `organization_id IS NOT NULL` WITH CHECK on UPDATE.

### 1c. Helpers (all present)
- `public.is_super_admin()` ✓
- `public.get_org_id()` ✓ (canonical — JWT fast-path)
- `public.get_user_org_id()` ✓ (legacy — profile-only; will replace usage in this migration)
- `public.get_user_role()` ✓
- `public.update_updated_at()` ✓

### 1d. Storage — `template-attachments` bucket
- Bucket exists, private, 5 MB limit, mime list: pdf/png/jpeg/docx.
- Paths: `{organization_id}/{ts}_{safe_name}`.
- RLS policies on `storage.objects` scope SELECT/INSERT/DELETE by `split_part(name,'/',1) = profile.organization_id`.
- **Decision:** keep current storage path/policy (org-scoped). Personal/Agency attachments share the same bucket prefix; cross-org isolation preserved. No storage migration required in this pass — flagged below as R2 (acceptable).

### 1e. Frontend findings (every `message_templates` consumer)

| File | Issue |
|---|---|
| `src/components/settings/EmailSMSTemplates.tsx` | No role gate; `confirmDelete` not org-scoped; `duplicateTemplate` doesn't honor scope; no activity logging; no scope filter; no scope badge. |
| `src/components/settings/TemplateModal.tsx` + `useTemplateModalForm.ts` | No Visibility (scope) selector; no scope persistence. |
| `src/components/settings/saveMessageTemplate.ts` | Update is `.eq('id', …)` only — missing `.eq('organization_id', …)`. No `scope` / `created_by` on insert. |
| `src/components/settings/templateModalSchema.ts` | No scope; no name max(80); no subject max(120); no content max. |
| `src/components/settings/messageTemplateTypes.ts` | No `scope`, no `createdBy` on `Template`. |
| `src/components/settings/TemplatesListView.tsx` | No scope badge; no per-row action gating. |
| `src/components/settings/TemplatesFiltersRow.tsx` | No scope filter. |
| `src/components/messaging/MessageTemplatesPickerModal.tsx` | No explicit `organization_id` filter; relies on RLS; no per-user-personal-vs-agency filtering. |
| `src/components/workflows/panels/ActionConfigPanel.tsx` | No `organization_id` filter on `message_templates` query; relies on RLS. Should restrict to **Agency** templates for org-level workflows. |
| `supabase/functions/workflow-executor/index.ts` | Uses service role → bypasses RLS. Existing `template_id` references continue to resolve. **No change needed** — confirmed by reading SMS/email action handlers. |
| `src/components/settings/MasterAdmin.tsx` | Super Admin generic table viewer — no behavior change required; will automatically pick up the new `scope`/`created_by` columns. |
| `src/integrations/supabase/types.ts` | Will be regenerated/hand-patched post-migration. |

### 1f. WORK_LOG conflicts
- No conflicting in-flight work on `message_templates`. Latest entries: goal-progress fields (2026-05-23), DNC compliance (2026-05-23), Call Scripts P1/P2 (2026-05-23).

---

## 2. Files to touch (exact list, before any edit)

### Migrations (new)
1. `supabase/migrations/20260525120000_message_templates_scope_harden.sql`

### Backend / schema
2. `src/integrations/supabase/types.ts` — regen after migration (narrow `organization_id` non-nullable; add `scope`, `created_by`).

### Frontend — Settings tab
3. `src/components/settings/EmailSMSTemplates.tsx` — manage gates, scope filter, scope-aware fetch/delete/duplicate, activity logging.
4. `src/components/settings/TemplateModal.tsx` — Visibility selector (Agency/Personal), gating, edit-permission gate.
5. `src/components/settings/useTemplateModalForm.ts` — scope state, scope persistence, schema parsing.
6. `src/components/settings/saveMessageTemplate.ts` — accept `scope`, `createdBy`; UPDATE org-scoped; insert `created_by` on personal.
7. `src/components/settings/templateModalSchema.ts` — add `scope`; tighten `name (max 80)`, `subject (max 120)`, `content (max 10_000)`.
8. `src/components/settings/messageTemplateTypes.ts` — add `scope: 'agency' | 'personal'`, `createdBy: string | null`.
9. `src/components/settings/TemplatesListView.tsx` — scope badge, per-row Edit/Delete gating.
10. `src/components/settings/TemplatesFiltersRow.tsx` — scope filter (All / Agency / Personal).

### Frontend — picker + workflow builder
11. `src/components/messaging/MessageTemplatesPickerModal.tsx` — explicit org scoping via `useOrganization()` + `useAuth()`; show Agency + own Personal; empty/no-org guard.
12. `src/components/workflows/panels/ActionConfigPanel.tsx` — explicit org scoping; restrict to `scope = 'agency'` for org-level workflows.

### Docs
13. `implementation_plan.md` (this file).
14. `WORK_LOG.md` — append newest-first entry.

**Not touched (out of scope):**
- `supabase/functions/workflow-executor/index.ts` — service role, RLS-bypass; existing `template_id` references resolve unchanged.
- `src/components/settings/MasterAdmin.tsx` — generic admin viewer; auto-picks new columns.
- Email/SMS sending behavior, Email Setup, Twilio/dialer.
- `useTemplateFileAttachments.ts`, `templateAttachmentUtils.ts`, storage bucket / RLS.

---

## 3. Migration design — `20260525120000_message_templates_scope_harden.sql`

Pseudocode (final SQL written on approval):

```
-- 1. Add scope:       text NOT NULL DEFAULT 'agency' + CHECK in ('agency','personal').
-- 2. Add created_by:  uuid REFERENCES auth.users(id) ON DELETE SET NULL.
-- 3. Defensive backfill (no-op: prod has 0 rows):
--      UPDATE message_templates SET scope = 'agency' WHERE scope IS NULL;
-- 4. organization_id SET NOT NULL  (safe: 0 rows pre-apply; idempotent guard raises if any null org).
-- 5. Add CHECK: scope = 'personal' implies created_by IS NOT NULL  (DEFERRABLE-style DO guard).
-- 6. Indexes (IF NOT EXISTS):
--      idx_message_templates_org              (organization_id)
--      idx_message_templates_org_scope        (organization_id, scope)
--      idx_message_templates_org_created_by   (organization_id, created_by)
-- 7. Trigger: message_templates_updated_at BEFORE UPDATE → public.update_updated_at().
-- 8. Drop existing four policies (message_templates_{select,insert,update,delete}).
-- 9. Create new four policies per §4.
-- 10. NOTIFY pgrst, 'reload schema';
```

**Safety guards:**
- Pre-`SET NOT NULL`: `IF EXISTS (SELECT 1 FROM message_templates WHERE organization_id IS NULL) THEN RAISE EXCEPTION ...`.
- All ADD COLUMN / CREATE INDEX use `IF NOT EXISTS`.
- DROP POLICY uses `IF EXISTS`.
- CHECK constraint adds are wrapped in DO blocks that test `pg_constraint` first.

---

## 4. RLS policy design (drop + recreate four)

### SELECT — `message_templates_select`
```
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      scope = 'agency'
      OR (scope = 'personal' AND created_by = auth.uid())
    )
  )
)
```

### INSERT — `message_templates_insert`
```
WITH CHECK (
  organization_id IS NOT NULL
  AND scope IN ('agency','personal')
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND (
        (scope = 'agency'   AND public.get_user_role() = 'Admin')
        OR (scope = 'personal' AND created_by = auth.uid())
      )
    )
  )
)
```

### UPDATE — `message_templates_update`
```
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      (scope = 'agency'   AND public.get_user_role() = 'Admin')
      OR (scope = 'personal' AND created_by = auth.uid())
    )
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND scope IN ('agency','personal')
  AND (scope = 'agency' OR created_by IS NOT NULL)
  AND (
    public.is_super_admin()
    OR (
      organization_id = public.get_org_id()
      AND (
        (scope = 'agency'   AND public.get_user_role() = 'Admin')
        OR (scope = 'personal' AND created_by = auth.uid())
      )
    )
  )
)
```
**Note on scope flips:** RLS technically permits an Admin to flip Personal→Agency if they're the owner; a non-Admin cannot promote because they fail the Admin branch. Frontend will treat Visibility as **read-only on edit** so this stays defense-in-depth, not a UX path.

### DELETE — `message_templates_delete`
```
USING (
  public.is_super_admin()
  OR (
    organization_id = public.get_org_id()
    AND (
      (scope = 'agency'   AND public.get_user_role() = 'Admin')
      OR (scope = 'personal' AND created_by = auth.uid())
    )
  )
)
```

---

## 5. Frontend behavior changes

### 5a. `EmailSMSTemplates.tsx`
- Pull `{ organizationId, role, isSuperAdmin } = useOrganization()`.
- `canManageAgency = isSuperAdmin || role === 'Admin'`.
- `currentUserId` from `useAuth()` (existing pattern) — needed for ownership checks and Personal inserts.
- `fetchTemplates`: bails on missing `organizationId`; query already filters `.eq('organization_id', organizationId)`. RLS guarantees scope/personal isolation; defense-in-depth client filter optional.
- New filter state: `filterScope ∈ {all, agency, personal}`.
- `confirmDelete` adds `.eq('organization_id', organizationId)` and gates by ownership/admin client-side.
- `duplicateTemplate`:
  - Agent/TL duplicating an Agency → defaults to **Personal**, sets `created_by = currentUserId`, name `Copy of …`.
  - Owner duplicating own Personal → stays Personal, `created_by = currentUserId`.
  - Admin duplicating an Agency → defaults to Agency (no `created_by`). Documented; simplest safe behavior.
- Add `logActivity` for create/update/duplicate/delete with metadata `{ template_id, name, type, scope, category, organization_id, actor_user_id }`. (Create/update logged inside `useTemplateModalForm.handleSave`; duplicate + delete inside this component.)

### 5b. `TemplateModal.tsx` + `useTemplateModalForm.ts`
- Add `Visibility` (Agency/Personal) selector. Visibility is **read-only on edit** to avoid scope-flip surprises; documented in UI tooltip ("Visibility is fixed after creation. Duplicate to change scope.").
- Visibility option gating:
  - If `canManageAgency` → both visible.
  - Else → only **Personal** (Agency option hidden).
- Edit gate: if editing an Agency template and not `canManageAgency`, modal opens read-only (Save hidden); if editing a Personal not owned by current user, same.
- Pass `currentUserId` so personal inserts include `created_by`.
- Schema accepts `scope` as required `'agency' | 'personal'`.

### 5c. `saveMessageTemplate.ts`
- Add `scope` and `createdBy` to input.
- UPDATE: `.eq('id', editTargetId).eq('organization_id', organizationId)` (org-scoping fix).
- INSERT: include `organization_id`; if `scope === 'personal'`, include `created_by = createdBy`; never set `created_by` when `scope === 'agency'`.
- UPDATE payload omits `scope` (read-only on edit) — defense-in-depth.

### 5d. `templateModalSchema.ts`
```
name:    z.string().trim().min(1).max(80)
type:    z.enum(['email','sms'])
subject: z.string().trim().max(120).optional().nullable()   (required for email via superRefine — existing)
content: z.string().trim().min(1).max(10_000)
scope:   z.enum(['agency','personal'])
category: existing enum or null
attachments: existing array
```
- SMS counter behavior preserved — no hard block on segment count.

### 5e. `TemplatesListView.tsx`
- Add scope badge: `Agency` (primary tone) / `Personal` (secondary tone).
- Hide Edit + Delete buttons for rows the current user cannot modify:
  - Agency row + non-Admin/non-Super-Admin → hide Edit/Delete.
  - Personal row + not the owner → hide Edit/Delete.
- Duplicate button always visible (everyone can duplicate to Personal).

### 5f. `TemplatesFiltersRow.tsx`
- Add a Select: `All Visibility / Agency / Personal`. Preserve existing search/type/category filters.

### 5g. `MessageTemplatesPickerModal.tsx`
- Pull `organizationId` from `useOrganization()` and `currentUserId` from `useAuth()` (no prop break for callers).
- Query: `.eq('organization_id', organizationId).or('scope.eq.agency,and(scope.eq.personal,created_by.eq.<uid>)')`.
- Empty/no-org guard.

### 5h. `ActionConfigPanel.tsx`
- Query: `.eq('organization_id', organizationId).eq('scope', 'agency')`.
- Rationale: org-level workflow steps should not depend on another user's Personal template. Executor itself uses service role (bypasses RLS), but the **builder UX** must reflect Agency-only.

### 5i. `workflow-executor/index.ts`
- **No code change.** Confirmed:
  - Uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS).
  - Loads templates by `template_id` directly; any existing `template_id` reference continues to work.
  - Prod has 0 templates; migration default `scope='agency'` covers any hypothetical pre-existing row.

---

## 6. Activity logging

Use existing `logActivity` (`src/lib/activityLogger.ts`). Category: `'settings'`.

| Action | Where | Metadata |
|---|---|---|
| `template_created` | `useTemplateModalForm.handleSave` on insert success | `{ template_id, name, type, scope, category, organization_id, actor_user_id }` |
| `template_updated` | `useTemplateModalForm.handleSave` on update success | `{ template_id, name, type, scope, category, organization_id, actor_user_id }` |
| `template_duplicated` | `EmailSMSTemplates.duplicateTemplate` | `{ source_template_id, new_template_id, name, type, scope, category, organization_id, actor_user_id }` |
| `template_deleted` | `EmailSMSTemplates.confirmDelete` | `{ template_id, name, type, scope, category, organization_id, actor_user_id }` |

`userName` populated when available.

---

## 7. Validation behavior

- Friendly inline field errors (existing `formErrors` pattern preserved).
- `superRefine`: subject required for email; otherwise existing behavior.
- SMS:
  - No hard block. Existing `TemplateSmsCounter` warns past segment thresholds.
  - Safety max: 10,000 chars (covers extreme paste cases).
- Attachments: existing 3-file/5 MB UX preserved; metadata shape unchanged.

---

## 8. Verification plan

1. `npx tsc --noEmit` — zero errors.
2. `npm test -- --run` — preserve the pre-existing 4 unrelated test-env failures (env loader). New tests not required by brief.
3. Live Supabase audit post-migration:
   - 4 policies on `message_templates`.
   - `scope` NOT NULL with check; `created_by` exists; `organization_id` NOT NULL.
   - `updated_at` trigger present.
   - 3 new indexes present.
4. Manual UI (deferred to Chris):
   - Admin: create Agency + Personal, edit/delete both, Visibility selector shows both options.
   - Agent/Team Leader: Visibility shows Personal only; sees Agency templates read-only (Edit/Delete hidden); can Duplicate Agency → Personal copy.
   - Super Admin: behaves as Admin in active org; cross-org via RLS where surfaces allow.
   - Picker (manual SMS/email): shows Agency + own Personal; not another user's Personal.
   - Workflow builder send_sms/send_email: only Agency templates selectable.
   - Console: no errors.

---

## 9. Sequencing

1. **Chris approves this plan.**
2. Write migration file, run `apply_migration` (MCP) on prod.
3. Re-audit: columns/policies/triggers/indexes; sanity-check 0 rows still.
4. Hand-patch the `message_templates` block in `src/integrations/supabase/types.ts` (project convention; full regen not standard).
5. Implement frontend changes in the file order above.
6. Run `npx tsc --noEmit` + tests.
7. Append `WORK_LOG.md` entry with full file list, RLS summary, verification, and decisions.
8. Stop. Do not push or merge unless Chris approves.

---

## 10. Risks / open questions

- **R1.** UPDATE policy technically permits an Admin to flip a Personal template to Agency if they own it. The UI hides scope editing post-creation; this stays defense-in-depth, not a security boundary. **Acceptable.**
- **R2.** Attachment paths are `{organization_id}/...` (not user-scoped). Personal-template attachments are not cross-user-isolated within an org via Storage RLS — the `template_attachments_select` policy allows any user in the same org to read any path in that org. This matches existing behavior. **Acceptable for v1**; storage path/user-scoped policies are a follow-up Pass.
- **R3.** `MessageTemplatesPickerModal` currently has no `organizationId`/`currentUserId` props. To avoid breaking callers, we'll source them via hooks inside the modal. Need to verify all callers still compile.
- **R4.** `ActionConfigPanel` restricting to `scope='agency'` means any pre-existing workflow referencing a Personal template would not surface that template on edit. Production has **0 templates**, so no impact. Documented in WORK_LOG.

---

## 11. Explicit non-goals (from brief)

- No Global runtime scope.
- No launch/default template seeding.
- No AI template generation.
- No workflow-executor overhaul (compatibility confirmed without change).
- No email/SMS send behavior changes.
- No Email Setup / Twilio / dialer changes.
- No broad Permissions infrastructure.

---

**Awaiting Chris's `#APPROVE` to proceed.**
