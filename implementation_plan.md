# Contact Flow Build 5 — Duplicate detection / required fields (+recruit) / field-layout persistence

**Branch:** `claude/brave-hamilton-e2utt`
**Status:** PLAN — awaiting Chris's `#APPROVE` before applying migration, deploying Edge Function, or editing files.
**Owner:** Chris Garness

---

## A. Live inspection findings (pre-implementation)

### `public.contact_management_settings` (live)
Columns (all NOT NULL except `*_specific_agent_id`):
- `id uuid PK default gen_random_uuid()`
- `organization_id uuid NOT NULL`
- `duplicate_detection_rule text default 'phone_or_email'`
- `duplicate_detection_scope text default 'all_agents'`
- `manual_action text default 'warn'`
- `csv_action text default 'flag'`
- `required_fields_lead jsonb default '{}'`
- `required_fields_client jsonb default '{}'`
- `assignment_method text default 'unassigned'`, `assignment_specific_agent_id uuid NULL`, `assignment_rotation jsonb default '[]'`
- `import_override bool default false`, `import_method text default 'unassigned'`, `import_specific_agent_id uuid NULL`, `import_rotation jsonb default '[]'`
- `created_at`, `updated_at` (default `now()`)

**Missing from spec:** `required_fields_recruit`, `field_order_lead`, `field_order_client`, `field_order_recruit`.

### RLS on `contact_management_settings` (live, three policies — legacy helper)
- `cms_select` USING `organization_id = get_user_org_id()` (no super-admin carve-out)
- `cms_insert` WITH CHECK `organization_id = get_user_org_id() AND get_user_role() = 'Admin'`
- `cms_update` USING `organization_id = get_user_org_id() AND get_user_role() = 'Admin'` (**no `WITH CHECK`** → org could be reassigned; no Super Admin coverage)
- **No `DELETE` policy** (table is per-org row, never deleted from app — acceptable).

`get_user_org_id()` is the legacy SECURITY DEFINER helper that reads `profiles`. `get_org_id()` is the current JWT-first helper used by Builds 1–4. Both resolve to the same uuid in practice.

### Row count
1 settings row (Chris home org). `required_fields_lead` and `required_fields_client` both contain saved settings (≠`{}`). **Must preserve** — migration adds columns with safe defaults only.

### `recruits.custom_fields`
Does **not** exist. `leads.custom_fields jsonb`, `clients.custom_fields jsonb` exist. Build 5 adds `recruits.custom_fields jsonb NULL` (no default — matches leads/clients).

### `user_preferences` layout storage
- 0 rows with `settings ? 'contact_field_layout'` today.
- 0 rows with `settings ? 'fieldVisibility'` today.
- Shape is set by `ContactManagement.tsx` `FieldLayoutTab.handleSave` and `contactFieldLayout.ts.ContactFieldLayoutSchema`: `{ lead?: string[], client?: string[], recruit?: string[] }` under key `contact_field_layout`. Strict schema. Custom field ids are `custom:<name>`.

### `import-contacts` Edge Function (live v24)
- `verify_jwt = false` (preserved). Validates Authorization Bearer JWT via `anonClient.auth.getUser(jwt)`, then uses service role for DB.
- Profile lookup → `organization_id` + `role`.
- Accepts `{ type, contactData, assignment, duplicateDetectionRule }`. **`duplicateDetectionScope` and `csvAction` are not read.** Conflicts are returned but never inserted; there is no `csvAction = 'flag' | 'import'` path.
- **Repo file matches live (line-for-line).** No drift. Safe to ship a new full version.

### `ImportLeadsModal.tsx`
- Line 748 hardcodes `duplicateDetectionRule: "phone_or_email"`. Does not pass scope or csv action. Custom field metadata is collected per row into `customFields` (good — we can stuff a duplicate marker there).

### Manual save paths
- `AddLeadModal` / `AddClientModal` / `AddRecruitModal` all call `onSave(form)` → `handleAddLead` / `handleAddClient` / `handleAddRecruit` in `Contacts.tsx`, which call the corresponding `*SupabaseApi.create()`. No edge function involved.
- **None of the three modals render or save custom field inputs today.** `customFields` is wired into the *API layer* for leads/clients but never populated from the modal forms. (FullScreenContactView is the only place that edits custom field values — not in scope for Build 5 modal flow.)
- AddRecruitModal currently does not even have `customFields` plumbing; will not add custom-field UI in Build 5.

### Existing duplicate constraints / indexes
- No DB-level uniqueness on `leads.phone` / `leads.email` / etc. Duplicate detection is application logic only. Build 5 keeps it that way (lightweight runtime check against the org).

### Helper functions present
`get_org_id`, `get_user_role`, `is_super_admin`, `update_updated_at`, `super_admin_own_org`, `get_user_org_id` — all live.

### Stop conditions — all clear
- ✅ `contact_management_settings` RLS is safe to harden via DROP+CREATE inside the migration (no data loss; pure policy rewrite).
- ✅ Required-field enforcement fits inside the listed files (Contacts.tsx save handlers + modal forms + import flow). No FullScreenContactView rewrite.
- ✅ `import-contacts` live = repo. No drift.
- ✅ Adding `recruits.custom_fields jsonb` is additive only; no recruit code reads `custom_fields` today.
- ✅ `user_preferences.settings.contact_field_layout` shape is as Builds 1–4 documented.
- ✅ Settings row preserved by additive `ADD COLUMN`.
- ✅ Auth model on `import-contacts` not weakened.
- ✅ Migration is non-destructive (`ADD COLUMN … NULL`, `ALTER … SET DEFAULT '{}'`, `DROP POLICY` + `CREATE POLICY` only).

---

## B. Locked decisions (carried from spec)

1. `contact_management_settings.required_fields_recruit jsonb NOT NULL DEFAULT '{}'` added.
2. `recruits.custom_fields jsonb` added (nullable — matches leads/clients).
3. `contact_management_settings.field_order_lead/client/recruit jsonb NULL` added (NULL until saved).
4. User layout stays at `user_preferences.settings.contact_field_layout`.
5. Layout fallback order: user → org → system default. `resolveFieldOrder` already has the shape.
6. CSV duplicate flag: stored on `custom_fields.duplicate_import = true` (object key, not a tag). For leads/clients we already have `custom_fields jsonb`; for recruits we add it in this migration.

---

## C. Files / functions / migrations to touch

### 1) New migration
`supabase/migrations/20260604120000_contact_flow_completion_settings.sql`

Contents (all wrapped in pre-flight `DO` block checking for `get_org_id`, `get_user_role`, `is_super_admin`, `super_admin_own_org`):

1. **Add columns to `contact_management_settings`:**
   - `ADD COLUMN IF NOT EXISTS required_fields_recruit jsonb NOT NULL DEFAULT '{}'::jsonb`
   - `ADD COLUMN IF NOT EXISTS field_order_lead jsonb` (NULL allowed)
   - `ADD COLUMN IF NOT EXISTS field_order_client jsonb`
   - `ADD COLUMN IF NOT EXISTS field_order_recruit jsonb`
2. **Lightweight CHECK constraints** (idempotent via `DO` block — only created if not present):
   - `required_fields_recruit` is a JSON object (`jsonb_typeof(required_fields_recruit) = 'object'`).
   - Each `field_order_*` is NULL OR a JSON array (`field_order_* IS NULL OR jsonb_typeof(field_order_*) = 'array'`).
   - Skip if existing project pattern avoids JSONB CHECK constraints — Build 4 used partial unique indexes instead; Build 5 will add the CHECK constraints because they are O(1) per row and fit the value model.
3. **Add `recruits.custom_fields jsonb NULL`** (matches leads/clients — no default, no NOT NULL).
4. **`updated_at` trigger.** Inspect: there is **no** `updated_at` trigger today; the API explicitly sets `payload.updated_at = new Date().toISOString()` on every upsert. Decision: leave as-is. Do **not** add a trigger (would be a no-op given API behavior; matches Build 2/3/4 "don't invent" stance).
5. **Harden RLS on `contact_management_settings`** (DROP existing 3 policies + CREATE 4 new helper-based policies, all `TO authenticated`):
   - **SELECT** USING:
     ```sql
     super_admin_own_org(organization_id)
     OR organization_id = public.get_org_id()
     ```
   - **INSERT** WITH CHECK:
     ```sql
     organization_id = public.get_org_id()
     AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
     ```
   - **UPDATE** USING + WITH CHECK (identical, so `organization_id` cannot be reassigned):
     ```sql
     organization_id = public.get_org_id()
     AND (public.get_user_role() = 'Admin' OR public.is_super_admin())
     ```
   - **No DELETE policy.** Settings are per-org permanent rows; never deleted from the app. (Same as today.)
   - Replaces the legacy `get_user_org_id()`-based policies. Team Leader / Agent remain SELECT-only at the DB.
6. **No RPC.** Direct supabase calls + RLS suffice.

### 2) `src/lib/types.ts`
- `ContactManagementSettings` — add `requiredFieldsRecruit: Record<string, boolean>` (required), keep existing `fieldOrderLead/Client/Recruit?: string[]` (already present in types). Update `csvAction` union to `'flag' | 'skip' | 'import'` (current code uses `'overwrite'` — fix to match spec/UI).
- `Recruit` — add `customFields?: Record<string, unknown>`.

### 3) `src/integrations/supabase/types.ts`
- Patch only the `contact_management_settings` block: add `required_fields_recruit: Json` on Row/Insert/Update (Insert optional), `field_order_lead/client/recruit: Json | null` on Row, optional on Insert/Update.
- Patch only the `recruits` block: add `custom_fields: Json | null` on Row, optional on Insert/Update.

### 4) `src/lib/supabase-settings.ts` — `contactManagementSettingsSupabaseApi`
- `getSettings` returns `requiredFieldsRecruit`, `fieldOrderLead`, `fieldOrderClient`, `fieldOrderRecruit`.
- `updateSettings` accepts and writes them (`if … !== undefined`).
- `DEFAULT_CONTACT_MANAGEMENT_SETTINGS` gains `requiredFieldsRecruit: {}` and leaves `fieldOrder*: undefined`.
- Adjust `csvAction` default if needed (it is already `'flag'`).

### 5) New helper: `src/lib/contactDuplicateDetection.ts`
Pure, typed, no React. Exports:
- `type DuplicateScope = "all_agents" | "assigned_only"`
- `type DuplicateRule = "phone_only" | "email_only" | "phone_or_email" | "phone_and_email"`
- `normalizePhone(p)` / `normalizeEmail(e)`
- `findDuplicates({ table: "leads"|"clients"|"recruits", organizationId, rule, scope, phone, email, assignedAgentId, excludeId, supabase })` — fetches `id, phone, email, assigned_agent_id, first_name, last_name` from the matching table scoped by `organization_id` (and `assigned_agent_id = currentAgentId` if scope=assigned_only), filters in JS using the configured rule, returns matched rows.
- Used by `Contacts.tsx` save handlers and `ImportLeadsModal` step-3 preview.

### 6) New helper: `src/lib/contactRequiredFields.ts`
Pure, typed. Exports:
- `LOCKED_LEAD = ["First Name","Last Name","Phone"]`, same for Client and Recruit.
- `STANDARD_FIELD_MAP_LEAD`, `_CLIENT`, `_RECRUIT` — display label → JS key on the partial entity (`"First Name" → "firstName"`, `"Email" → "email"`, `"Phone" → "phone"`, `"State" → "state"`, `"Lead Source" → "leadSource"`, `"Date of Birth" → "dateOfBirth"`, `"Age" → "age"`, `"Best Time to Call" → "bestTimeToCall"`, `"Assigned Agent" → "assignedAgentId"`, `"Status" → "status"`, `"Notes" → "notes"`, …client/recruit equivalents).
- `isPresent(value)` — string trimmed non-empty; number finite; array/object non-empty; boolean → `true` only if truthy (we don't use this for required, just defensive).
- `computeMissingRequired({ contactType, entity, customFields, settings, activeCustomFields })`:
  - Always include `LOCKED_*` (mapped to keys, then test).
  - Optional fields toggled true in settings are added.
  - Active custom fields with `required = true` that apply to this type are tested against `customFields[name]`.
  - Returns `string[]` of human-friendly labels.

### 7) `src/components/contacts/AddLeadModal.tsx`, `AddClientModal.tsx`, `AddRecruitModal.tsx`
- Load `contactManagementSettings` + active `customFields` for the org once on open.
- Before calling `onSave`, run `computeMissingRequired` against the form. If non-empty → toast `"Missing required fields: X, Y, Z"` and return.
- Then run duplicate detection via `findDuplicates`:
  - On **edit** (initial truthy), pass `excludeId = initial.id`.
  - `manualAction = "block"` → toast and return.
  - `manualAction = "warn"` → `confirm`-style dialog (simple `window.confirm` is acceptable for Build 5; the spec says "warning/confirmation". Decision: use `window.confirm("Possible duplicate of <name>. Save anyway?")` to avoid building a new dialog component.).
  - `manualAction = "allow"` → silent allow.
- AddRecruitModal: also include the new optional fields listed by spec — **Email, State, Status, Assigned Agent, Notes**. Today's modal already has Email, State, Status, Notes. Assigned Agent is not in the modal — leave as-is (handled by `handleAddRecruit` in Contacts.tsx via `user?.id`). Required-field check will allow it when settings asks for it because `assignedAgentId` is set by the handler before the form submits the create; but the form-level check would fire before assignment. Decision: surface Assigned Agent only in the settings tab (so it can be persisted), and gate the check at the **handler layer in Contacts.tsx**, not in the modal, so the assignment has already been computed. This matches Lead's existing assignment selector (which is on the modal but resolves to `assignToAgentId` before `onSave`).
- **Custom-field required enforcement is not added to the three modals**, because the modals do not render custom-field inputs today. Building a custom-field UI inside all three modals is out of scope (spec says "Keep changes surgical"). FullScreenContactView is the only place custom-field values are edited; in Build 5 we will enforce required custom fields there in its save path.

### 8) `src/pages/Contacts.tsx`
- Add a single `requireDuplicateAndFieldChecks(contactType, partial, customFields, excludeId?)` helper inside the file (or import from lib helper) and call it at the top of `handleAddLead`, `handleAddClient`, `handleAddRecruit` plus the *edit* paths in the `<AddClientModal>` / `<AddRecruitModal>` close-handlers (the lead edit goes through `handleUpdateLead`, which already exists; same check inserted there).
- Settings + active custom fields are already cached on the page (or fetched via `useOrganization()`); add a small cached fetch (similar to `allLeadSources`) so we don't refetch on every save.

### 9) `src/components/contacts/FullScreenContactView.tsx`
- On save (existing in-place edit save handlers), call `computeMissingRequired` and `findDuplicates` (duplicate only on phone/email change). Out-of-scope items per spec: do not rewrite this file broadly. Surgical insertion in the existing save function only.
- `resolveFieldOrder` already receives `userOrder, orgOrder`. Wire `orgOrder` from `contact_management_settings.field_order_*` (settings loaded by Contacts.tsx and threaded through props, **or** fetched inside FullScreenContactView — already happens for this view via `contactManagementSettingsSupabaseApi.getSettings`). Confirm during impl.

### 10) `src/components/contacts/ImportLeadsModal.tsx`
- Load contact management settings on open (alongside the existing custom-field fetch).
- Replace hardcoded `duplicateDetectionRule: "phone_or_email"` with the saved value.
- Pass `duplicateDetectionScope` and `csvAction` to the Edge Function in the request body.
- Required-field check at step 2: if a custom field is `required=true` and applies to Leads, require a mapped column (already does this for Phone/name). Surface unmapped required custom fields as a step-2 blocker (toast / disable Continue).

### 11) `supabase/functions/import-contacts/index.ts` (Edge Function)
- Read live function content (already retrieved — repo file matches). Deploy a new version with full content. Preserve `verify_jwt = false`, anon-client JWT validation, service-role DB, profile-org lookup, target-agent validation.
- Accept `duplicateDetectionScope` and `csvAction` in body.
- Scope filter: when `duplicateDetectionScope === "assigned_only"`, only treat existing rows with `assigned_agent_id === ownerOfNewRow` as duplicates. (`ownerOfNewRow` is the `assigned_agent_id` we are about to assign — already computed.)
- Apply `csvAction`:
  - `skip` → don't insert duplicate rows. Return `imported`, `conflicts_count`, `skipped_duplicates` (count).
  - `flag` → insert duplicate rows but mark `custom_fields.duplicate_import = true` (merged into existing `customFields`). Return `imported` (includes flagged), `conflicts_count`, `flagged_duplicates` (count). Recruits use the new `custom_fields` column.
  - `import` → insert duplicate rows without any marker. Return `imported`, `conflicts_count`.
- Default unchanged when `csvAction` is missing → `flag` (matches default settings).
- `inserted_lead_ids` semantics preserved.
- Server-side required check: keep current behavior (`first_name`, `last_name`, `phone` defaulted to empty string today). Build 5 spec says "at minimum, remove fake copy and enforce standard required fields". Decision: in the Edge Function, if `first_name`, `last_name`, or `phone` (normalized) is empty for a row, push it to a `rejected` list with a reason and don't insert. Return `rejected` count.

### 12) `src/components/settings/ContactManagement.tsx`
- **`DuplicateDetectionTab`:** drop `SETTINGS_ENFORCEMENT_NOTE`. Add an honest line: `"Duplicate Detection is enforced on manual contact saves and CSV imports."` Keep the Merge Settings card with copy: `"Contact merge is not built yet — these preferences are not saved."` Move that card to be disabled+grayscale so it's visibly inert.
- **`RequiredFieldsTab`:**
  - Drop `SETTINGS_ENFORCEMENT_NOTE` text and the "Recruit required fields are not configured here yet" line.
  - Add a third Recruits column with locked First/Last/Phone and optionals (Email, State, Status, Assigned Agent, Notes) per spec.
  - Adjust layout to `grid-cols-3`.
  - Pull active custom fields and (where applicable) show them in each column (optional checkbox, switch-bound). Custom-field required toggles already persist via `custom_fields.required` (Build 4 saves intent). Display read-only here (a sentence: "Custom fields with their Required toggle on are also enforced — manage them in the Custom Fields tab.") to avoid duplicating a write path.
  - Persist `requiredFieldsRecruit` via the extended `updateSettings`.
  - Update copy to say "Required fields are enforced on contact create/edit forms and CSV imports."
- **`FieldLayoutTab`:**
  - Two-mode toggle: **My Layout** (default; available to everyone) and **Agency Default** (Admin / Super Admin only).
  - Loads `userLayout` from `user_preferences.settings.contact_field_layout`, `orgLayout` from `settings.fieldOrderLead/Client/Recruit`.
  - In **My Layout** mode, save writes to `user_preferences` (existing path).
  - In **Agency Default** mode, save writes to `contact_management_settings.field_order_<type>` via the extended `updateSettings`. Validate via `ContactFieldLayoutSchema` (object of arrays) — or per-type with a stricter array schema before writing.
  - Reset to Agency Default button: clears only the active contact type from `user_preferences.settings.contact_field_layout` (delete the key, keep other types).
  - Copy: "My Layout affects only your view." / "Agency Default applies to users who have not customized their own layout."
  - Field visibility stays user-specific (unchanged).
  - Replace "agency-wide default layout is not available yet" copy.
- Remove the `SETTINGS_ENFORCEMENT_NOTE` constant entirely.

### 13) `AGENT_RULES.md`
Append two invariants to §5 Schema Gotchas:
1. **Contact field layout resolution order** — user `user_preferences.settings.contact_field_layout` → org `contact_management_settings.field_order_*` → `getDefaultFieldOrder()`. (System default lives in `src/lib/contactFieldLayout.ts`.)
2. **Required-field enforcement is application-layer** — `contact_management_settings.required_fields_<type>` plus `custom_fields.required` flags are validated in the frontend save paths and in `import-contacts` for the core (`first_name`, `last_name`, `phone`). No DB `NOT NULL` on business-required columns.

### 14) `WORK_LOG.md`
Append a Build 5 entry newest-first per spec §Q.

---

## D. Out of scope (deferred / unchanged)
- Pipeline stages (Build 2), lead sources (Build 3), custom fields ownership (Build 4) — no changes.
- `leads.lead_source` normalization — still text.
- Custom-field VALUE editing UI inside `AddLeadModal/AddClientModal/AddRecruitModal` — modals do not surface custom field inputs in Build 5. (`FullScreenContactView` remains the editor.)
- Merge Settings — not persisted; UI shows clearly as not-yet-built.
- Calendar / Twilio / dialer / workflows / dispositions / appointment types.
- `create-organization` Edge Function — no settings seeding involved here; not redeployed.

---

## E. Verification plan
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → run if vitest installed; otherwise report consistent with Builds 1–4.
- Live MCP post-migration:
  1. `contact_management_settings` has `required_fields_recruit` (NOT NULL default `{}`), `field_order_lead/client/recruit` (NULL allowed).
  2. `recruits.custom_fields` exists as `jsonb` (nullable).
  3. Existing Chris-home-org settings row preserved (required_fields_lead/client unchanged).
  4. New RLS policies present (4): SELECT (org-scoped + super_admin_own_org), INSERT/UPDATE (Admin or Super Admin). UPDATE WITH CHECK present.
  5. No DELETE policy (unchanged).
  6. `import-contacts` version bumped, `verify_jwt = false` preserved.
- Manual smoke checklist in WORK_LOG.

---

## F. Open questions for Chris (please answer before I apply)

1. **RLS rewrite on `contact_management_settings`** — current policies use legacy `get_user_org_id()` (no `WITH CHECK` on UPDATE, no Super Admin coverage). Plan rewrites to helper-based `get_org_id()` + `super_admin_own_org` for SELECT, identical USING+CHECK on UPDATE to pin `organization_id`. Net effect: no Team Leader writes (matches today) + Super Admin coverage (new) + WITH CHECK pin (new). OK?
2. **No `updated_at` trigger** — API sets `updated_at` on every upsert. Plan does **not** add a trigger (matches Build 2/3/4 stance). OK?
3. **CSV duplicate flag location** — plan stores `custom_fields.duplicate_import = true` on the inserted row (a JSON key, not a tag). Recruits get a new `custom_fields jsonb` column. Alternative: append a `"Duplicate"` string to a `tags` field — but no such column exists. Sticking with the key approach. OK?
4. **Server-side required enforcement in `import-contacts`** — plan rejects rows missing core (first/last/phone) with a `rejected` count returned. Does **not** enforce custom-field required server-side (would require fetching `custom_fields` rows + checking each imported row; broader than this build). OK to keep server enforcement minimal?
5. **Custom-field required enforcement in modals** — `AddLeadModal/AddClientModal/AddRecruitModal` do not render custom field inputs today, so enforcement of required custom fields on the create form is impractical without a broader modal rewrite (out of scope per Build 5 directive "keep surgical / do not rewrite FullScreenContactView broadly"). Plan enforces required *standard* fields in all three modals and required *custom* fields only in FullScreenContactView's edit path. OK?
6. **Warning UI for manual duplicate** — plan uses `window.confirm("Possible duplicate of <name>. Save anyway?")` for `manualAction = warn` to avoid building a new dialog component. Acceptable? (If you'd rather have a styled Dialog, +30 mins, no behavior change.)
7. **`csvAction` union fix in types** — `src/lib/types.ts` currently has `'flag' | 'skip' | 'overwrite'`; UI/Edge Function use `'flag' | 'skip' | 'import'`. Plan changes the type to `'flag' | 'skip' | 'import'` (DB stores text, no constraint). OK?
8. **Field Layout role gate** — plan: Agency Default mode visible only to Admin/Super Admin (Team Leader/Agent hidden from that mode). Or should Team Leader at least *view* the Agency Default read-only? Lean: hide entirely; matches Build 1–4 manage gate.
9. **AGENT_RULES.md inline edit** — OK to add the two §5 invariant lines (layout resolution + required enforcement layer)?

---

## G. Approval status
**APPROVED + APPLIED.** Chris approved §F answers; migration applied, Edge Function v25 deployed (`verify_jwt = false` preserved), frontend + types patched, AGENT_RULES + WORK_LOG updated, `npx tsc --noEmit` exit 0.

## H. Context snapshot (final)

**Changes**
- Added migration `20260604120000_contact_flow_completion_settings.sql` (applied live).
- `contact_management_settings`: new columns `required_fields_recruit jsonb NOT NULL DEFAULT '{}'`, `field_order_lead/client/recruit jsonb NULL`. CHECK constraints enforce JSON object/array shape.
- `recruits.custom_fields jsonb NULL` added (matches leads/clients).
- RLS rewritten on `contact_management_settings` (helper-based; super_admin SELECT carve-out; INSERT/UPDATE Admin/Super Admin only; UPDATE WITH CHECK pin; no DELETE).
- `import-contacts` v25 deployed (`verify_jwt = false` preserved) — reads `duplicateDetectionScope` and `csvAction`; supports `scope = "assigned_only"`; `skip`/`flag`/`import` semantics with `__agentflow.duplicateImport` + `tags: ["Duplicate"]` marker; recruits write `custom_fields`; rejects core-missing rows.
- New helpers `src/lib/contactDuplicateDetection.ts` and `src/lib/contactRequiredFields.ts`.
- `Contacts.tsx` enforces required + duplicate on create/edit (lead/client/recruit) via shadcn dialog (Save Anyway / Cancel).
- `FullScreenContactView` enforces required (incl. custom required) on save.
- `ImportLeadsModal` no longer hardcodes `phone_or_email`; sends saved rule/scope/csvAction and blocks Continue on unmapped required (standard + custom) fields.
- `ContactManagement` settings UI: Required Fields gains Recruits column; Duplicate Detection banner says "is enforced"; Merge Settings card visibly disabled ("Not Active"); Field Layout supports `My Layout` and `Agency Default` modes with role-gated Agency Default and Reset to Agency Default in My Layout.
- Types and supabase types patched for all new columns; `csvAction` union normalized to `flag | skip | import`; `Recruit.customFields?` added.
- `AGENT_RULES.md` §5 gains layout-resolution-order and app-layer-required-enforcement invariants.

**Decisions**
- RLS hardened (helper-based, super_admin SELECT, WITH CHECK pin, no DELETE).
- Manual duplicate warn UX uses a real shadcn Dialog with explicit Cancel / Save Anyway buttons. No `window.confirm`.
- Required custom-field enforcement gated to FullScreenContactView (modals don't surface custom-field inputs in this build).
- CSV duplicate marker: `custom_fields.__agentflow.duplicateImport = true` + `custom_fields.tags` includes `"Duplicate"`.
- Field layout: user > agency > system. `Reset to Agency Default` clears only the current user's entry for the active contact type.
- Merge Settings deferred (UI clearly disabled).
- `csvAction` union normalized to `flag | skip | import`.
- No DB-level NOT NULL on business-required columns; enforcement is application-layer.

**Files touched**
- `supabase/migrations/20260604120000_contact_flow_completion_settings.sql` (new)
- `supabase/functions/import-contacts/index.ts`
- `src/integrations/supabase/types.ts` (`contact_management_settings` + `recruits` blocks)
- `src/lib/types.ts`
- `src/lib/supabase-settings.ts`
- `src/lib/supabase-recruits.ts`
- `src/lib/contactDuplicateDetection.ts` (new)
- `src/lib/contactRequiredFields.ts` (new)
- `src/pages/Contacts.tsx`
- `src/components/contacts/FullScreenContactView.tsx`
- `src/components/contacts/ImportLeadsModal.tsx`
- `src/components/settings/ContactManagement.tsx`
- `AGENT_RULES.md`
- `WORK_LOG.md`
- `implementation_plan.md`

**Migrations / deploys**
- DB migration `20260604120000_contact_flow_completion_settings` → applied (`{"success":true}`).
- Edge Function deploy: `import-contacts` v25 (`verify_jwt = false`). Live SHA `72087f0a7c062c9c0e61166f57b45b01dbff8c272ee8f6cd9b0ae0ea5b7aab3b`.

**Verification**
- Live MCP post-migration:
  - `contact_management_settings` columns and CHECK constraints present; existing settings row preserved (`required_fields_lead/client` non-empty; `required_fields_recruit = {}`).
  - `recruits.custom_fields jsonb` exists (nullable).
  - 3 helper-based RLS policies on `contact_management_settings`; no `get_user_org_id` references.
- `npx tsc --noEmit` → exit 0.
- `npm test -- --run` → `vitest: not found` (consistent with Builds 1–4).

**Manual check status**
- Not run by agent (no browser/auth context in this remote env). 17-step checklist documented in `WORK_LOG.md` for Chris to walk through.

**Blockers / next steps**
- AddLead/AddClient/AddRecruit modals do not yet render custom-field inputs. Future build can surface custom-field inputs in the Add modals to apply required-custom-field enforcement uniformly across create flows.
- Merge contacts feature still deferred.
- No `git push` to main and no PR/merge initiated per Chris's standing directive. Branch `claude/brave-hamilton-e2utt` carries this work for review.
