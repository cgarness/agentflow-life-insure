# Contact Flow Build 4 — Custom fields hardening + classify null-org rows as system templates

**Branch:** `claude/nifty-gates-hrAJD`
**Status:** APPROVED + APPLIED. Migration live, frontend updated, AGENT_RULES + WORK_LOG updated, tsc clean.
**Owner:** Chris Garness

---

## A. Live inspection findings (pre-implementation)

### `public.custom_fields` schema (live)
- Columns: `id uuid PK`, `organization_id uuid NULL`, `name text NOT NULL`, `type text NOT NULL`, `applies_to jsonb NOT NULL default '[]'`, `required bool NULL default false`, `active bool NULL default true`, `default_value text NULL`, `dropdown_options jsonb NULL default '[]'`, `usage_count int NULL default 0`, `created_at timestamptz NULL default now()`, `updated_at timestamptz NULL default now()`, `created_by uuid NULL`.
- Indexes: `custom_fields_pkey`, `custom_fields_org_created_by_idx (organization_id, created_by)`. No unique-name index. No partial unique.
- Triggers: none on `custom_fields` (no `updated_at` trigger).

### Row counts (live, pre-migration)
| Bucket | Count |
|---|---|
| total | **73** |
| `organization_id IS NULL` | 72 |
| `created_by IS NULL` | 72 |
| `organization_id IS NULL AND created_by IS NULL` | **72** (system templates) |
| `organization_id IS NULL AND created_by IS NOT NULL` | **0** (clean — no surprises) |
| `organization_id IS NOT NULL` | 1 |
| `organization_id IS NOT NULL AND created_by IS NULL` | **0** (no agency-wide fields exist yet) |
| `organization_id IS NOT NULL AND created_by IS NOT NULL` | **1** (Chris's personal `Health Status` on home org) |
| `active IS NULL` | 0 |
| `required IS NULL` | 0 |

### System-template breakdown (the 72 null-org/null-creator rows)
| type | applies_to | required | active | count |
|---|---|---|---|---|
| Text | `["Leads"]` | false | true | 65 |
| Date | `["Leads"]` | false | true | 5 |
| Number | `["Leads"]` | false | true | 2 |

All 72 are Leads-only, non-required, active. Duplicates by `lower(btrim(name))` exist among the templates (`beneficiary` ×5, `gender` ×4, `have life insurance` ×4, `favorite hobby` ×4, `amount requested` ×4, `history of heart attack stroke cancer` ×4, `zip code` ×3, `beneficiary name` ×3, `city` ×3, several ×2). **Therefore we cannot add a unique constraint that includes the system-template rows.** Any uniqueness must be partial: org-scoped, and only on org-owned rows.

### Org-owned row preserved
- `id=fdb68293-…`, org `a0000000-…0001`, `created_by=ecf2bb91-…` (Chris), name `Health Status`, type Text, Leads, required=false, active=true. **Personal field** under the locked ownership model. Will be preserved untouched.

### Where custom field values are stored
- `public.leads.custom_fields jsonb`
- `public.clients.custom_fields jsonb`
- `public.recruits` has **no** `custom_fields` column (pre-existing limitation; out of scope for Build 4).
- **No separate `custom_field_values` table** (`SELECT column_name FROM information_schema.columns WHERE column_name ILIKE 'custom%fields%'` returns only the two jsonb columns above). Deleting / deactivating a `custom_fields` row will **not** orphan a side table.

### Current RLS policies on `custom_fields` (to be replaced)
Four policies all gated `authenticated`:
- `custom_fields_select` USING:
  `super_admin_own_org(organization_id) OR (organization_id IS NOT NULL AND organization_id = get_org_id() AND (get_user_role() IN ('Admin','Team Leader','Team Lead') OR created_by IS NULL OR created_by = auth.uid()))`
  → **Excludes** system templates (`organization_id IS NULL` branch is dropped). Frontend `getAll` filters by `organization_id` so users do not see system templates today anyway.
- `custom_fields_insert` WITH CHECK:
  `… AND ((created_by = auth.uid()) OR (created_by IS NULL AND get_user_role() IN ('Admin','Team Leader','Team Lead')))`
  → **Team Leader can currently create agency-wide fields. Must be removed.**
- `custom_fields_update` USING+CHECK: same role gate; **Team Leader can update agency-wide fields and other users' personal fields if role is Admin/TL.**
- `custom_fields_delete` USING: same gate.

### Helper functions present
`get_org_id`, `get_user_role`, `is_super_admin`, `update_updated_at`, `super_admin_own_org(uuid)` — all live. Pre-flight will gate on the first four. `super_admin_own_org` is still the cross-org pattern used elsewhere; this build will continue to use the same helper.

### Frontend callers of `customFieldsSupabaseApi`
- `src/lib/supabase-settings.ts` (definition)
- `src/components/settings/ContactManagement.tsx` (CustomFieldsTab, FieldLayout tab)
- `src/components/contacts/FullScreenContactView.tsx` (renders custom fields on contact)
- `src/components/contacts/ImportLeadsModal.tsx` (calls `create` with no `orgWide` → personal field; safe)
- `src/components/workflows/TriggerConfigForm.tsx` (read-only `.getAll`)
- `src/lib/custom-fields-settings.test.ts` (only checks `getAll(null/undefined/"")` returns `[]`)

Direct `custom_fields` reads outside the API: none in `src/`.

### Stop conditions — all green
- ✅ No null-org row has `created_by` not null (0).
- ✅ System templates are not referenced by any production UI today (`getAll` is `.eq("organization_id", organizationId)`, so the 72 templates are already invisible). No code path breaks if we keep them invisible in normal CRUD.
- ✅ No separate values table. Custom field data lives as JSON on `leads`/`clients`. Deactivating/deleting a `custom_fields` row will not orphan a side table.
- ✅ Duplicates exist among **system templates only**, so partial unique indexes scoped to org-owned rows are safe.
- ✅ All required helper functions present.
- ✅ RLS can represent the locked ownership model with helper-based policies.
- ✅ No destructive data migration required.

---

## B. Selected ownership strategy (locked)

| Bucket | `organization_id` | `created_by` | Read | Write |
|---|---|---|---|---|
| System template | NULL | NULL | (hidden from normal CRUD UI; visible at DB only via explicit policy carve-out — see C.5) | **Never** writable from authenticated app. |
| Agency-wide | set | NULL | All org users (any role). | Admin or Super Admin in same org only. |
| Personal | set | set | Creator; Admin/Super Admin in same org can also read for support/cleanup. | Creator only. Admin/Super Admin **cannot** edit/delete others' personal fields in Build 4 (matches the spec's recommended launch behavior). |

- **Team Leader and Agent: personal fields only.** No agency-wide writes at DB or in UI.
- **Super Admin: org-scoped** via `super_admin_own_org(organization_id)` — same pattern as existing policies.
- **System templates: read-only forever from the app.** No INSERT/UPDATE/DELETE policy will allow `organization_id IS NULL AND created_by IS NULL` for authenticated users.

### Visibility of system templates in Build 4
Build 4 does **not** add a "Browse templates" UI. The 72 templates remain in the DB, untouched, but the normal Custom Fields list keeps its `.eq("organization_id", organizationId)` filter and therefore hides them. We will still add a SELECT branch that exposes them to authenticated users (read-only) so a future build can surface a template gallery without another RLS migration; the current UI just won't query for them. (If Chris prefers to defer that SELECT carve-out entirely, see §F open question.)

---

## C. Files / functions / migrations to touch

### 1) New migration
`supabase/migrations/<fresh_ts>_custom_fields_hardening.sql`

Contents:

1. **Pre-flight `DO` block** — raise if any of `get_org_id`, `get_user_role`, `is_super_admin`, `update_updated_at`, `super_admin_own_org` are missing.
2. **Nullability tightening** (safe — live counts show 0 NULL rows):
   - `UPDATE custom_fields SET active = true WHERE active IS NULL;` (no-op today)
   - `ALTER TABLE custom_fields ALTER COLUMN active SET NOT NULL;`
   - `UPDATE custom_fields SET required = false WHERE required IS NULL;` (no-op today)
   - `ALTER TABLE custom_fields ALTER COLUMN required SET NOT NULL;`
   - **Do not** touch `organization_id` or `created_by` — system templates require both nullable.
3. **Indexes:**
   - Keep `custom_fields_org_created_by_idx` (already exists).
   - Add `custom_fields_org_idx ON (organization_id) WHERE organization_id IS NOT NULL` (partial — system templates excluded).
   - Add `custom_fields_created_by_idx ON (created_by) WHERE created_by IS NOT NULL` (partial).
   - **Partial unique for agency-wide names:**
     `CREATE UNIQUE INDEX custom_fields_agency_lower_name_unique ON custom_fields (organization_id, lower(btrim(name))) WHERE organization_id IS NOT NULL AND created_by IS NULL AND active IS TRUE;`
   - **Partial unique for personal names (per creator):**
     `CREATE UNIQUE INDEX custom_fields_personal_lower_name_unique ON custom_fields (organization_id, created_by, lower(btrim(name))) WHERE organization_id IS NOT NULL AND created_by IS NOT NULL AND active IS TRUE;`
   - **No** index that touches the 72 system-template rows (duplicates exist there).
4. **`updated_at` trigger** — add `BEFORE UPDATE` trigger `custom_fields_updated_at` → `public.update_updated_at()`.
5. **RLS rewrite** — drop the existing 4 policies and recreate (all `TO authenticated`):

   **SELECT** USING:
   ```sql
   super_admin_own_org(organization_id)
   OR (organization_id IS NULL AND created_by IS NULL) -- system templates: visible read-only
   OR (organization_id IS NOT NULL AND organization_id = public.get_org_id()
       AND (
         created_by IS NULL                                -- agency-wide
         OR created_by = auth.uid()                        -- own personal
         OR public.get_user_role() = 'Admin'               -- admin sees all org-owned
         OR public.is_super_admin()                        -- super admin sees all org-owned
       ))
   ```

   **INSERT** WITH CHECK:
   ```sql
   organization_id IS NOT NULL
   AND organization_id = public.get_org_id()
   AND (
     -- personal field
     (created_by = auth.uid())
     OR
     -- agency-wide field (Admin or Super Admin only)
     (created_by IS NULL AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
   )
   ```
   → Team Leader and Agent can only INSERT personal rows. System templates can never be inserted.

   **UPDATE** USING + WITH CHECK:
   ```sql
   organization_id IS NOT NULL
   AND organization_id = public.get_org_id()
   AND (
     (created_by IS NOT NULL AND created_by = auth.uid())
     OR
     (created_by IS NULL AND (public.get_user_role() = 'Admin' OR public.is_super_admin()))
   )
   ```
   → WITH CHECK is the **same** expression, so a row's `organization_id` cannot be reassigned (must remain caller's org) and `created_by` cannot escalate (personal owner cannot null it out; admin cannot adopt someone else's row).
   → System templates (`organization_id IS NULL`) never match.

   **DELETE** USING: same expression as UPDATE USING.

6. **No new RPC.** Direct Supabase calls with explicit `.eq("organization_id", organizationId).eq("id", id)` are sufficient. RLS does the rest.

### 2) `src/lib/supabase-settings.ts` — `customFieldsSupabaseApi`
Surgical rewrite of the four methods.

- `getAll(organizationId)`
  - Require `organizationId`; return `[]` if missing (current behavior — preserves test `getAll(null/undefined/"")`).
  - `.from("custom_fields").select("*").eq("organization_id", organizationId).order("name", { ascending: true })`.
  - System templates are not returned (predicate excludes NULL org). Matches §B.
- `create(data, organizationId, options)`
  - Require `organizationId`.
  - Fetch `auth.getUser()` → uid; require uid.
  - `created_by = options?.orgWide ? null : uid`.
  - Frontend gate still enforced; RLS is the safety net.
  - Map Postgres `23505` to friendly toast `"A custom field with this name already exists."`.
- `update(id, data, organizationId)`
  - **New signature.** Require `organizationId`.
  - `.eq("id", id).eq("organization_id", organizationId)` — never update by id alone.
  - `.select().maybeSingle()` so an RLS-blocked update (e.g., system template, someone else's personal field) returns 0 rows and we throw `"You don't have permission to modify this custom field."`.
  - Friendly duplicate-name error.
  - **Do not** allow callers to pass `organization_id` or `created_by` in `data`.
- `delete(id, organizationId)`
  - **New signature.** Require `organizationId`.
  - `.delete().eq("id", id).eq("organization_id", organizationId).select("id")`. If 0 rows, throw permission error.
- Existing `CreateCustomFieldOptions.orgWide` stays. Comment updated: "Admin or Super Admin only; Team Leader/Agent always create personal fields."

Caller updates (signature change for `update`/`delete`):
- `src/components/settings/ContactManagement.tsx` — `handleSave` / `handleDelete` / `handleDeactivate` / `handleToggleActive` (4 sites).
- `src/components/contacts/ImportLeadsModal.tsx` — only calls `create`; already passes `organizationId`. **No change needed.**
- `src/components/contacts/FullScreenContactView.tsx` — only calls `getAll`. No change.
- `src/components/workflows/TriggerConfigForm.tsx` — only calls `getAll`. No change.

### 3) `src/components/settings/contact-flow/contactFlowSchemas.ts`
Add `customFieldSchema`:
```ts
export const customFieldTypeSchema = z.enum(["Text","Number","Date","Dropdown","Email","Phone"]);
export const customFieldAppliesToSchema = z.array(z.enum(["Leads","Clients","Recruits"])).min(1, "Select at least one");
export const customFieldSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Name must be 40 characters or less"),
  type: customFieldTypeSchema,
  appliesTo: customFieldAppliesToSchema,
  required: z.boolean(),
  active: z.boolean(),
  defaultValue: z.string().max(200, "Default must be 200 characters or less").optional().or(z.literal("")),
  dropdownOptions: z.array(z.string()).optional(),
  orgWide: z.boolean(),
}).superRefine((val, ctx) => {
  if (val.type === "Dropdown") {
    const cleaned = (val.dropdownOptions ?? []).map(o => o.trim()).filter(Boolean);
    if (cleaned.length < 2) ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Add at least 2 options" });
    if (cleaned.length > 20) ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Maximum 20 options" });
    if (cleaned.some(o => o.length > 50)) ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Each option max 50 characters" });
    const lower = cleaned.map(o => o.toLowerCase());
    if (new Set(lower).size !== lower.length) ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Options must be unique (case-insensitive)" });
  }
});
export type CustomFieldFormValues = z.infer<typeof customFieldSchema>;
```

### 4) `src/components/settings/ContactManagement.tsx` — `CustomFieldsTab`
Surgical updates:

- **Ownership gates:**
  - `canManageAgencyFields = profile?.role === "Admin" || !!profile?.is_super_admin`
  - `canManagePersonalFields = !!profile && !!organizationId`
  - Replace existing `canOfferOrgWide` (currently `Admin || Team Leader` — **wrong** under locked model) with `canManageAgencyFields`.
- **Header copy:**
  `"Admins can create agency-wide fields visible to everyone. Anyone can create personal fields visible only to them."` (replaces the current line that says Admin / Team Leader can both make agency-wide fields).
- **Add Custom Field button:** shown if `canManagePersonalFields`. (Everyone with an org can add a personal field.)
- **`orgWide` toggle:** shown only when `canManageAgencyFields`. Removed for Team Leader/Agent.
- **Row badges:** add a Scope column next to Applies To showing one of
  - `Agency-wide` (organization_id set, created_by null)
  - `Personal` (organization_id set, created_by set)
  - `System template` (organization_id null) — not shown today because they're filtered out; future-proof.
- **Edit / Delete / Toggle controls per row:**
  - Compute `canEditRow = (row.createdBy === null && canManageAgencyFields) || (row.createdBy === profile?.id)`.
  - Edit pencil, deactivate switch, and trash icon all disabled when `!canEditRow`.
  - Tooltip when disabled: "Only the field's owner or an Admin can change this." (Agency rows → admin; personal rows → owner.)
- **Deactivate-first UX:** keep the current pattern (toggle off → confirm dialog → `active=false`). Delete dialog remains for inactive rows.
- **Required Field copy honesty:**
  Current dialog text: `"Agents must fill in this field before saving a contact"` — replace with: `"Required fields will be enforced on contact forms in a later release."` (matches scope: Build 4 does not enforce.)
- **Drop fake usage count from delete dialog:**
  Current copy says `"This field has data on {usageCount} contacts"`. `usage_count` is stale (we are not trusting it per spec). Replace with: `"Existing contact data for this field is preserved on each contact record. Deleting only removes the field from new forms."`
- **Zod wiring:**
  - On save, parse form through `customFieldSchema.safeParse(...)`. If failure → show first issue as toast.
  - Reuse cleaned `dropdownOptions` from schema (trim + filter empty).
- **Friendly error mapping:** when API throws `"A custom field with this name already exists."` show as destructive toast.

### 5) `src/lib/types.ts` — `CustomField`
- Add optional `scope?: "system" | "agency" | "personal"` (derived in `rowToCustomField`).
- Keep `createdBy?: string | null` (already exists).
- Leave `usageCount` typed as `number` for back-compat (we'll keep mapping it from `row.usage_count` but stop using it in primary UI).

### 6) `src/integrations/supabase/types.ts`
Patch only the `custom_fields` block:
- `Row.active: boolean` (was `boolean | null`).
- `Row.required: boolean` (was `boolean | null`).
- `Insert.active` and `Insert.required` remain optional (DB defaults exist).
- `organization_id` and `created_by` **remain nullable** (system templates).
No other table touched.

### 7) `AGENT_RULES.md` — §5 Schema Gotchas
Add one invariant line (low blast radius):
> **`custom_fields` ownership model.** System templates = `organization_id IS NULL AND created_by IS NULL` (read-only). Agency-wide fields = `organization_id` set, `created_by IS NULL` (Admin / Super Admin only). Personal fields = both set (creator only). Team Leader and Agent may manage personal fields only.

### 8) `WORK_LOG.md`
Append newest-first Build 4 entry per spec §I.

---

## D. Out of scope (deferred / unchanged)
- Lead sources (Build 3 complete).
- Pipeline stages (Build 2 complete).
- Required-field enforcement on contact forms, `required_fields_recruit`, duplicate detection enforcement, field layout persistence — **all Build 5**.
- `recruits.custom_fields` column (does not exist; deferred to whichever build adds it).
- Migrating / converting / deleting any of the 72 system templates.
- Setting `custom_fields.organization_id` NOT NULL.
- A separate `custom_field_values` table or normalization.
- Calendar / Twilio / dialer / workflows / dispositions / appointment_types.
- `create-organization` Edge Function (no custom_fields seeding involved).

---

## E. Verification plan
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` (likely `vitest: not found` on this remote env — consistent with Builds 1–3; report if so).
- Live MCP post-migration:
  1. `custom_fields.active` and `required` are `NOT NULL`; `organization_id` and `created_by` remain nullable.
  2. 72 system templates still present (`organization_id IS NULL AND created_by IS NULL` count = 72).
  3. Chris home org personal `Health Status` row preserved (id `fdb68293-…`).
  4. 4 RLS policies present and helper-based (no `Team Leader` / `Team Lead` strings in any policy expression).
  5. `custom_fields_updated_at` BEFORE UPDATE trigger present.
  6. Indexes present: `custom_fields_agency_lower_name_unique`, `custom_fields_personal_lower_name_unique`, `custom_fields_org_idx`, `custom_fields_created_by_idx`, plus existing `custom_fields_org_created_by_idx`.
  7. RLS smoke: simulate via `set local role authenticated` + `request.jwt.claims` for an Agent — INSERT with `created_by = null` should fail; INSERT with `created_by = uid` should succeed. (Or rely on app-level smoke.)
- Manual smoke checklist in WORK_LOG entry.

---

## F. Open questions for Chris (would like guidance before applying)
1. **System-template SELECT exposure.** Plan exposes the 72 system templates to authenticated users via RLS SELECT but **does not** add a UI to show them. Two options:
   - (A) Expose via RLS now (planned) — zero current UI impact, future template gallery needs no migration.
   - (B) Block via RLS until a UI ships — stricter; tighter blast radius.
   Lean: **(A)** because the rows are already in the DB and exposing them read-only is harmless.
2. **Admin reading other users' personal fields.** Plan = Admin / Super Admin can `SELECT` org-owned personal fields belonging to other users (support / cleanup) but **cannot** UPDATE/DELETE them. Two options:
   - (A) Admin sees all org-owned, edits only own + agency-wide (planned).
   - (B) Admin sees only own + agency-wide (stricter — no support visibility into personal fields).
   Lean: **(A)** per task spec's recommended launch behavior.
3. **`AGENT_RULES.md` inline edit.** OK to add the one-line invariant to §5 (mirrors Build 3's pattern)? If you'd rather it stay in WORK_LOG only, I'll skip the AGENT_RULES diff.
4. **Required-field UI copy.** Keep the "Required" toggle visible (with honest "enforced in a later release" copy) or hide it until Build 5? Lean: **keep visible** so configuration is captured; enforcement lands in Build 5.

---

## G. Approval status
**APPROVED** by Chris (`#APPROVE`) with answers to §F:
1. (A) Expose system templates via RLS SELECT read-only, no UI surfacing in Build 4.
2. (A) Admin / Super Admin can SELECT other users' personal fields in their org; cannot UPDATE/DELETE.
3. Inline AGENT_RULES.md §5 invariant added.
4. Required toggle stays visible with honest "enforcement ships in a later release" copy.

Migration applied, frontend updated, types patched, AGENT_RULES + WORK_LOG updated, `npx tsc --noEmit` exit 0.

---

## H. Context snapshot (final)

**Changes**
- Added migration `20260603120000_custom_fields_hardening.sql` (applied live).
- Hardened `custom_fields` schema: `active` and `required` are now `NOT NULL`; `organization_id` and `created_by` remain nullable (system templates).
- Added 4 indexes — partial `custom_fields_org_idx`, partial `custom_fields_created_by_idx`, partial unique `custom_fields_agency_lower_name_unique`, partial unique `custom_fields_personal_lower_name_unique`. Kept existing `custom_fields_org_created_by_idx`. No index covers the 72 system-template duplicates.
- Added `custom_fields_updated_at` BEFORE UPDATE trigger → `public.update_updated_at()`.
- Replaced 4 RLS policies with helper-based ownership-aware policies (system templates read-only-visible; agency-wide writes restricted to Admin/Super Admin; personal writes restricted to creator; Team Leader / 'Team Lead' strings purged).
- Rewrote `customFieldsSupabaseApi`: new `update`/`delete` signatures take `organizationId`; `.maybeSingle()` + zero-row → friendly permission error; `friendlyCustomFieldError` maps `23505`/`42501`/RLS messages.
- Rewrote `CustomFieldsTab`: locked ownership gates (`canManageAgencyFields = Admin || Super Admin`, Team Leader removed), Scope column with Agency/Personal/System badges, per-row Lock icon + tooltip when not editable, honest header + Required + delete copy, Zod-validated form with dropdown trim/min-2/max-20/max-50/case-insensitive-unique rules, "Agency-wide field" toggle hidden for Team Leader/Agent.
- Added `customFieldSchema` (Zod) + helper schemas to `contactFlowSchemas.ts`.
- Patched `CustomField` type with `scope` discriminator.
- Patched `src/integrations/supabase/types.ts` `custom_fields` block: `active`/`required` non-null on Row.
- Added `custom_fields` ownership invariant to `AGENT_RULES.md` §5.

**Decisions**
- System templates preserved (72 rows). Not converted, deleted, or migrated. Read-only via RLS for future template gallery; hidden from normal CRUD UI in Build 4.
- `custom_fields.organization_id` and `created_by` remain nullable because system templates require both nullable.
- Team Leader DB writes removed (no `'Team Leader'`/`'Team Lead'` in policies or UI gate).
- Admin / Super Admin can SELECT other users' personal fields (support/cleanup) but cannot UPDATE/DELETE them.
- Partial unique indexes scoped only to org-owned active rows (system-template duplicates left untouched).
- No new RPC (direct Supabase calls + explicit org scoping + RLS suffice).
- `usage_count` left in place for back-compat but ignored; delete dialog no longer references it.
- Required-field enforcement deferred to Build 5; toggle copy makes that explicit.

**Files touched**
- `supabase/migrations/20260603120000_custom_fields_hardening.sql` (new)
- `src/lib/supabase-settings.ts`
- `src/components/settings/ContactManagement.tsx`
- `src/components/settings/contact-flow/contactFlowSchemas.ts`
- `src/lib/types.ts`
- `src/integrations/supabase/types.ts` (`custom_fields` block only)
- `AGENT_RULES.md` (§5 invariant)
- `WORK_LOG.md`
- `implementation_plan.md`

**Migrations / deploys**
- DB migration `20260603120000_custom_fields_hardening` → applied via `apply_migration` (`{"success":true}`).
- No Edge Function deploys.

**Verification**
- Live MCP post-migration: `system_templates = 72`, `personal_preserved = 1`, `active_nullable = "NO"`, `required_nullable = "NO"`, `org_nullable = "YES"`, `created_by_nullable = "YES"`. Indexes confirmed (`custom_fields_agency_lower_name_unique`, `custom_fields_personal_lower_name_unique`, `custom_fields_org_idx`, `custom_fields_created_by_idx`, plus pre-existing `custom_fields_org_created_by_idx`, `custom_fields_pkey`).
- `npx tsc --noEmit` → exit 0.
- `npm test -- --run` → `vitest: not found` (consistent with Builds 1–3 on this remote env).

**Manual check status**
- Not run by an agent (no browser/auth context in this remote env). 14-step checklist documented in `WORK_LOG.md` for Chris to walk through.

**Blockers / next steps**
- None blocking. Next: **Build 5** — duplicate detection enforcement, required-field enforcement on contact forms (leads/clients/recruits), `required_fields_recruit`, field-layout persistence, and optional `recruits.custom_fields` column. No `git push` to main or PR/merge initiated, per Chris's standing directive.
