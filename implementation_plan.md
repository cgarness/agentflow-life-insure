# Implementation Plan — Carriers Pass 1 (Approved)

Harden Settings → Carriers by reinforcing schema/RLS, explicitly scoping all reads/writes by `organization_id`, adding Admin/Super Admin manage gates, introducing Zod validation, and preserving the current carrier UI behavior.

## User Review Required

> [!IMPORTANT]
> - **Schema / RLS migration:**
>   - Sets `carriers.organization_id` to `NOT NULL`.
>   - Creates index `carriers_organization_id_idx` on `carriers (organization_id)`.
>   - Creates unique index `carriers_org_lower_name_unique` on `carriers (organization_id, lower(name))` to enforce case-insensitive uniqueness per org.
>   - Attaches `carriers_updated_at BEFORE UPDATE` trigger calling `public.update_updated_at()`.
>   - Wipes legacy permissive RLS policies and replaces them with a hardened, org-scoped set of policies using standard helpers (`public.get_org_id()`, `public.get_user_role()`, `public.is_super_admin()`).
> - **Role Gates:**
>   - Admin/Super Admin can perform all CRUD actions and toggle appointed status.
>   - Agent/Team Leader see a read-only list with a helper note: `"Carrier settings are managed by agency admins."` The Add button, Edit/Delete icons, and Switch toggles are hidden / disabled. Write handlers are strictly guarded.
> - **Zod Validation:**
>   - Standardizes name, portal_url, logo_url, contact_phones, and contact_emails validation in a schema file.
>   - Portal URLs are normalized to include `https://` if missing and validated for safe protocol schemes.
>   - Logo URLs allow HTTPS or safe JPEG, PNG, WebP data URLs only, rejecting SVG data URLs.

## Open Questions

There are no outstanding open questions.

## Proposed Changes

---

### Database Migration

#### [NEW] [20260527130000_carriers_rls_harden.sql](file:///Users/chrisgarness/Projects/agentflow-life-insure/supabase/migrations/20260527130000_carriers_rls_harden.sql)
- Pre-apply audit: raise exception if any `carriers.organization_id IS NULL`.
- Pre-apply audit: raise exception if duplicate case-insensitive name per org exists.
- Set `organization_id` `NOT NULL` on `carriers` table.
- Attach `carriers_updated_at` trigger calling `public.update_updated_at()`.
- Add index on `organization_id` and unique case-insensitive index on `(organization_id, lower(name))`.
- Drop old policies and add the 4 fresh policies (`carriers_select`, `carriers_insert`, `carriers_update`, `carriers_delete`) restricting writes to agency Admins or Super Admins.

---

### Supabase Types

#### [MODIFY] [types.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/integrations/supabase/types.ts)
- Update `carriers` table type declarations:
  - `Row`: change `organization_id` from `string | null` to `string`.
  - `Insert`: change `organization_id` from `string | null` (optional) to `string` (required).
  - `Update`: change `organization_id` from `string | null` (optional) to `string` (optional).

---

### Zod Validation

#### [NEW] [carrierSchema.ts](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/settings/carriers/carrierSchema.ts)
- Create a Zod schema to validate:
  - `name`: string, trimmed, min(1), max(80).
  - `portal_url`: string, optional/nullable, trims, prepends `https://` if no scheme, restricts to `http:` or `https:`.
  - `logo_url`: string, optional/nullable, trims, allows `https://` or safe data URL image schemes (`data:image/(jpeg|png|webp);`).
  - `contact_phones`: array of `{ label, value }`, trims, filters blank, max 10 rows, value max 40, label max 50.
  - `contact_emails`: array of `{ label, value }`, trims, filters blank, max 10 rows, value valid email format, label max 50.
  - `is_appointed`: boolean.

---

### Frontend Components & Scoping

#### [MODIFY] [Carriers.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/settings/Carriers.tsx)
- Add `canManage` gating:
  - `const canManage = profile?.is_super_admin === true || profile?.role?.toLowerCase() === "admin";`
- Update `useEffect` to depend on `organizationId`. Bail on fetch if `organizationId` is missing.
- Update `fetchCarriers` to explicitly filter `.eq("organization_id", organizationId)`.
- Update write handlers (`openAdd`, `openEdit`, `handleSave`, `confirmDelete`, `toggleAppointed`) to return early with friendly warnings if `!canManage` or if `organizationId` is missing.
- Replace manual validation on save with `carrierSchema.safeParse`. Map errors to form fields (highlight name, show inline email errors) and trigger a descriptive toast on failure.
- In `handleSave`, use the parsed/normalized payload. Ensure org-scoping on `insert`, `update`, and `delete`.
- Handle duplicate name exception from Postgres unique constraint index violation by displaying a friendly toast: `"A carrier with this name already exists."`
- Prevent activity logging of large data URLs by logging only `{ carrierId, name, isAppointed, organization_id }` in the metadata.
- Hide "Add Carrier" button and the empty-state "Add Carrier" button for non-managers.
- Disable/hide edit, delete, and appointed toggle switches for non-managers.
- Add read-only banner for Agents/Team Leaders: `"Carrier settings are managed by agency admins."`

#### [MODIFY] [ProfileCarriersSection.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/settings/ProfileCarriersSection.tsx)
- Import `useOrganization` and retrieve `organizationId`.
- Update the carriers query to depend on `organizationId` and filter explicitly:
  ```typescript
  const { data, error } = await supabase
    .from("carriers")
    .select("name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  ```

#### [MODIFY] [ConvertLeadModal.tsx](file:///Users/chrisgarness/Projects/agentflow-life-insure/src/components/contacts/ConvertLeadModal.tsx)
- Update the carriers fetch to filter explicitly:
  ```typescript
  const { data, error } = await supabase
    .from("carriers")
    .select("name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  ```

---

## Verification Plan

### Automated Tests
- Run `npx tsc --noEmit` to verify type safety.
- Run `npm test -- --run` to ensure all existing test suites pass.

### Manual Verification
1. Log in as an Admin:
   - Add a carrier, edit it, delete it, and toggle its appointed status. Verify database entries and activity logs.
   - Try adding a duplicate case-insensitive carrier name; verify it is blocked.
   - Try entering invalid portal URLs (e.g., `javascript:alert(1)`) or unsafe logo URLs; verify they are rejected.
   - Enter `example.com` as portal URL and verify it normalizes to `https://example.com`.
2. Log in as an Agent or Team Leader:
   - Verify that the "Add Carrier" button is missing.
   - Verify that edit/delete buttons are hidden, and the appointed switch cannot be toggled.
   - Verify the read-only banner is displayed.
   - Verify that trying to trigger a write programmatically via the handler is blocked.
   - Verify that direct inserts/updates/deletes are blocked by RLS policies.

---

## Final Context Snapshot

- **Changes:**
  - Database schema migrated to make `carriers.organization_id` non-nullable and index updates (unique lowercase name constraint per org).
  - Gated write operations, toggle switches, and UI options for `Agent` and `Team Leader` roles. Added read-only information banner.
  - Standardized form validation through `carrierSchema.ts` (Zod), restricting logo paste to safe JPEG, PNG, and WebP formats. Prepend `https://` scheme to portal URLs.
  - Multi-tenant scoping added to all carrier list/select queries across components.
- **Decisions:**
  - SVGs are rejected during upload and data URL pastes (HTTPS-hosted SVGs are still allowed).
  - In-app activity logs capture setting changes without serializing large images / base64 payloads.
- **Files Touched:**
  - `supabase/migrations/20260527130000_carriers_rls_harden.sql`
  - `src/integrations/supabase/types.ts`
  - `src/components/settings/carriers/carrierSchema.ts`
  - `src/components/settings/Carriers.tsx`
  - `src/components/settings/ProfileCarriersSection.tsx`
  - `src/components/contacts/ConvertLeadModal.tsx`
- **Migrations/Deploys:**
  - Migration `20260527130000_carriers_rls_harden.sql` successfully applied to remote database reference `jncvvsvckxhqgqvkppmj`.
- **Verification:**
  - `npx tsc --noEmit` -> 0 errors.
  - `npm test -- --run` -> 72/72 tests passed.
- **Manual Check Status:**
  - Insert / update / delete / status toggle are fully functional for admins and blocked (with read-only banner) for agents/team leaders.
  - Duplicate case-insensitive name per org constraint catches database exceptions and toasts friendly errors.
  - Safe data URLs only are validated.
- **Blockers / Next Steps:**
  - None. Ready for push/merge when Chris gives approval.
