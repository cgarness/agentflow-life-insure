# Settings → Company Branding — Verification-First Implementation Plan

**Date:** 2026-05-22  
**Branch verified:** `main` @ `c575e26` (tracking `origin/main`)  
**Status:** Plan only — **no code, migrations, or Supabase commands executed**

---

## Pre-flight (completed)

| Step | Result |
|------|--------|
| Read `AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md` | Done |
| WORK_LOG conflicts | **None.** Newest entries are My Profile / Control Center (2026-05-22). No `[IN PROGRESS]` Company Branding work. Older Permissions phases are unrelated. |
| Active branch | `main` — not a stale feature branch from prior chats |

---

## Global search verification (required)

| Search term | Active `src/` | Branding-relevant hits |
|-------------|---------------|------------------------|
| `SINGLETON_ID` | **0** | Not used in application code |
| `00000000-0000-0000-0000-000000000000` | **0** | Not used in application code |
| `company_settings` | Yes | Org-scoped reads/writes in branding + TV banner + onboarding + super-admin provision |
| `SUPER_ADMIN_EMAIL` | Yes | `brandingConfig.ts`, `CompanyBranding.tsx` (favicon gate), `twilio-reputation-check` Edge Function |
| `cgarness.ffl@gmail.com` | Yes | Hardcoded in `SUPER_ADMIN_EMAIL` and unrelated scripts/Edge functions |
| `primary_color` | **0 in TS/TSX** | Column exists in DB/types only — not read or written by UI |

**Stale references (docs / other domains — not branding runtime):**

- `docs/SETTINGS_LAYOUT.md` still claims `SINGLETON_ID` for org-wide settings — **incorrect for `company_settings` on `main`**
- `00000000-…` UUID remains in **phone / inbound routing** migrations and legacy tables — **out of scope** for Company Branding

---

## Verified architecture facts

### 1. `CompanyBranding` reads/writes by `organization_id`

**Confirmed.** `src/components/settings/CompanyBranding.tsx`:

- Load: `.from("company_settings").select("*").eq("organization_id", orgId).maybeSingle()`
- Save: `.upsert({ organization_id: orgId, ... }, { onConflict: "organization_id" })`
- `orgId` from `profile?.organization_id`

### 2. `BrandingContext` reads by `organization_id`

**Confirmed.** `src/contexts/BrandingContext.tsx`:

- Resolves `profiles.organization_id` for `auth.uid()`
- Load: `.from('company_settings').select('*').eq('organization_id', orgId).maybeSingle()`
- Applies `companyName` + `faviconUrl` to `document.title` / favicon `<link>`

### 3. `company_settings.organization_id` unique constraint

**Confirmed** in repo migrations and generated types:

- Migration `20260417000001_company_settings_rls.sql`: `company_settings_org_unique UNIQUE (organization_id)`
- `src/integrations/supabase/types.ts`: relationship `isOneToOne: true` on `organization_id` → `organizations`

### 4. `primary_color` in UI / application

**Not wired.** Column default `#3B82F6` in `20260307235939_create_company_settings_table.sql`; present in `types.ts` only. No TSX/TS reads, writes, or CSS variable injection. Historical work log explicitly **removed** primary color UI and `--brand-primary` injection.

**Do not rebuild primary color** unless Chris requests it as a new product requirement.

### 5. Logo / favicon upload mechanism

**Confirmed: base64 data URLs.** `src/components/settings/BrandingUploadField.tsx` uses `FileReader.readAsDataURL()` and stores the full `data:image/...;base64,...` string in component state → persisted to `logo_url` / `favicon_url` on save.

### 6. Production rows with `data:` URLs

**Unverified in this session** (Supabase read-only SQL deferred per approval gate).

**Pre-approve audit query** (run after Chris approves read-only prod check):

```sql
SELECT organization_id,
       left(logo_url, 30) AS logo_prefix,
       left(favicon_url, 30) AS favicon_prefix,
       length(logo_url) AS logo_len,
       length(favicon_url) AS favicon_len
FROM public.company_settings
WHERE logo_url LIKE 'data:%' OR favicon_url LIKE 'data:%';
```

### 7. Supabase Storage bucket for branding

**None in repo.** Migrations define:

| Bucket | Public | Org path pattern |
|--------|--------|------------------|
| `template-attachments` | false | `{organization_id}/...` |
| `agency-group-resources` | false | `{agency_group_id}/...` |
| `call-recordings` | false | `{org_id}/{date}/...` |

`agency_materials` is used in `useResources.ts` / `useTraining.ts` via `getPublicUrl` but **no bucket migration found in `supabase/migrations/`** (prod may predate repo — flag for `list_tables` / bucket audit).

**No `company-branding` / branding bucket exists.**

### 8. Storage / RLS patterns to mirror

**Best reference:** `20260418170000_enhance_message_templates.sql` + `src/components/settings/useTemplateFileAttachments.ts`

- Private bucket, org-prefixed paths, `split_part(name, '/', 1) = profiles.organization_id::text`
- Upload/remove from client; DB stores **storage path** (not base64)

**Display caveat:** Sidebar / `Logo.tsx` use `branding.logoUrl` directly as `<img src>`. Private buckets require **signed URLs** (see `TemplateAttachmentChips.tsx`, `AgencyGroupResourceList.tsx`) or a **public** bucket policy decision.

### 9. Who can edit branding today

| Actor | View Settings section | Edit `company_settings` (RLS) | Edit Company Branding UI | Favicon upload UI |
|-------|----------------------|-------------------------------|--------------------------|-------------------|
| **Admin** | Yes (`fullAccess` + default section access) | Yes (`get_user_role() = 'Admin'` + same org) | Yes (`canEdit`) | No — section hidden unless email matches |
| **Super Admin** (`is_super_admin`) | Yes | Yes, **home org only** via `super_admin_own_org(organization_id)` — not cross-tenant in CRM settings | Yes (`canEdit`) | Only if `profile.email === cgarness.ffl@gmail.com` |
| **Team Leader** | Yes (default) | **UPDATE only** for `leaderboard_tv_banner_text` (`company_settings_team_leader_update`) — not full branding | No (`canEdit` false) | No |
| **Agent** | Yes (default `agent: true` on section) | No write | No — read-only banner + disabled fields | No |
| **Platform admin** (`platform_role`) | N/A to branding | No special branding bypass | Same as agency role | No |

**Favicon-specific access:** Hardcoded email check in `CompanyBranding.tsx` — **not** role-based. Conflicts with multi-tenant / staff-account goals.

**RLS note:** Live policies on `main` come from `20260430203000_super_admin_scoped_own_org.sql` (replaced earlier `is_super_admin()`-only write with `super_admin_own_org`).

### 10. SINGLETON_ID for Company Branding

**NOT PRESENT on active branch** in `src/` or `CompanyBranding` / `BrandingContext` data paths.

- **Not a critical multi-tenancy bug** for branding on `main`
- **Critical if reintroduced** — treat as P0 regression

---

## Findings summary

### Confirmed issues

1. **Logo/favicon stored as base64 in Postgres** — large row payloads, slow saves, no CDN/cache, awkward for email/PDF surfaces later.
2. **Hardcoded favicon gate** — `canEditFavicon = profile?.email === SUPER_ADMIN_EMAIL` (`cgarness.ffl@gmail.com`). Should use `profile.is_super_admin` (and/or explicit platform permission), consistent with RLS and `useOrganization`.
3. **Branding save does not refresh global context** — `CompanyBranding` never calls `refreshBranding()` after upsert; app-wide logo/title/favicon may stay stale until full page reload.
4. **Stale documentation** — `docs/SETTINGS_LAYOUT.md` still documents `SINGLETON_ID` for org settings.
5. **Misleading upload error copy** — `BrandingUploadField` toast says “Admin or Super Admin” but Agents can open the section read-only (permissions allow view).

### Unconfirmed / no-op items

| Item | Verdict |
|------|---------|
| SINGLETON_ID on `company_settings` | **No-op on `main`** — already org-scoped |
| Rebuild `primary_color` UI | **No-op** — intentionally removed; column dormant |
| Cross-org Super Admin branding edit in CRM Settings | **By design** (`super_admin_own_org`) — not a bug unless product asks for per-org impersonation editing |
| Prod `data:` row count / sizes | **Unconfirmed** — needs approved SQL audit |
| `agency_materials` bucket RLS in repo | **Unconfirmed** — bucket used in code, migration not in repo |

### Required fixes (recommended scope)

**Phase A — Hardening (no Storage migration required)**

1. Replace favicon email gate with `profile?.is_super_admin === true` (align with `canEdit` semantics for platform owner).
2. After successful branding save, call `useBranding().refreshBranding()` so Sidebar / Logo / document title update immediately.
3. Update `docs/SETTINGS_LAYOUT.md` to describe `organization_id` upsert (remove SINGLETON_ID claim for branding).
4. Optional: tighten default `role_permissions.s` for `company-branding` to `agent: false` if agents should not see admin-only settings (product decision).

**Phase B — Storage migration (separate approval: `#APPROVE_RLS_CHANGE` + storage)**

1. Add bucket `company-branding` (private recommended) with org-prefixed paths: `{organization_id}/logo.{ext}`, `{organization_id}/favicon.{ext}`.
2. Storage RLS: mirror `template-attachments` (SELECT/INSERT/DELETE for authenticated users where path prefix = their `profiles.organization_id`; Super Admin via `super_admin_own_org` pattern on path prefix).
3. Client upload flow in `BrandingUploadField` (or thin `useBrandingUpload` hook):
   - Upload file → storage path
   - Store **HTTPS URL** in DB: either `getPublicUrl` (only if bucket is public) **or** signed URL refreshed in `BrandingContext` (if private).
4. On remove: delete storage object + null DB columns.
5. **Do not** use SQL-only migration to convert base64 → files (bytes require JS/Edge/script).

### Required migrations / storage policies

| Artifact | Purpose |
|----------|---------|
| `supabase/migrations/YYYYMMDD_company_branding_storage_bucket.sql` | Create `company-branding` bucket + `storage.objects` policies |
| (Optional) column comment migration | Document that `logo_url` / `favicon_url` hold public/signed URLs, not base64 |

No change required to `company_settings_org_unique` or core RLS unless favicon should be writable by all Admins (already allowed by RLS — only UI hides it).

### Data backfill need

**Conditional** on prod audit.

If `data:%` rows exist:

1. **Script** (recommended): `scripts/backfill-company-branding-storage.mjs`
   - Service role (local env only, never committed)
   - For each row: decode base64 → upload to `company-branding/{org_id}/...` → UPDATE `logo_url`/`favicon_url` to public or signed URL pattern
   - Idempotent: skip if URL already `https://`
   - Log per-org success/failure; dry-run mode
2. **Not** pure SQL migration for file bytes.

### Risks

| Risk | Mitigation |
|------|------------|
| Private bucket breaks `<img src>` without signed URLs | Resolve URLs in `BrandingContext.refreshBranding` (e.g. 24h signed) or use public bucket with unguessable filenames |
| Large base64 UPDATE timeouts during backfill | Batch script; off-hours; row-by-row |
| Super Admin provisions new org while bucket missing | Provision wizard already sets null URLs — safe |
| RLS drift between `20260417000001` and `20260430203000` | Confirm prod policies via `list_migrations` + policy names before applying storage policies |
| Removing email gate exposes favicon to all Admins | Intended for production; document in release notes |

---

## Verification plan (post-implementation)

### Automated

```bash
npx tsc --noEmit
npm test -- --run
```

### Manual — roles

| Test | Admin | Agent | Super Admin (home org) |
|------|-------|-------|------------------------|
| Open Settings → Company Branding | Section loads | Read-only banner, disabled fields | Can edit (home org) |
| Save company name | Persists + toast | N/A | Persists |
| Upload logo | Preview + save | Blocked | Works |
| Upload favicon | Visible after Phase A fix | Hidden | Visible if `is_super_admin` |
| Reload app | Title + sidebar logo match DB | Same read-only | Same |

### Manual — functional

- **Branding save/reload:** Change name → Save → sidebar title updates **without** hard refresh (after `refreshBranding` fix).
- **Logo/favicon upload/reload:** Upload → Save → navigate away and back → assets still render.
- **Cross-org isolation:** User in Org A must not see Org B `company_settings` via UI or direct client query (RLS denial).

### Prod audit (before backfill)

- Run `data:%` SQL above
- `list_migrations` for `company_settings_rls` + `super_admin_scoped_own_org`

---

## Recommended exact fix scope

**Minimum shippable (Phase A only):** favicon permission fix + `refreshBranding` on save + doc correction. ~3–4 files, low risk.

**Full hardening (Phase A + B):** above + Storage bucket + upload refactor + optional backfill script. ~8–12 files + 1 migration + 1 script; medium complexity due to signed URL vs public URL decision.

**Explicitly out of scope unless requested:**

- Reintroducing `primary_color` / theme tokens
- Changing Super Admin cross-org Agencies provisioning flow
- Fixing phone_settings / inbound_routing SINGLETON patterns

---

## Files likely to touch

**Phase A**

- `src/components/settings/CompanyBranding.tsx`
- `src/components/settings/brandingConfig.ts` (remove or repurpose `SUPER_ADMIN_EMAIL`)
- `src/contexts/BrandingContext.tsx` (if signed URL resolution added later)
- `docs/SETTINGS_LAYOUT.md`

**Phase B**

- `src/components/settings/BrandingUploadField.tsx`
- New: `src/lib/brandingStorage.ts` or `src/hooks/useBrandingUpload.ts`
- `supabase/migrations/YYYYMMDD_company_branding_storage_bucket.sql`
- `scripts/backfill-company-branding-storage.mjs` (if prod has `data:` rows)
- `src/integrations/supabase/types.ts` (regenerate after migration)

**Unlikely**

- `supabase/migrations/20260417000001_company_settings_rls.sql` (already correct)
- `BrandingForm.tsx` (unless adding Zod — optional polish)

---

## Model recommendation

| Scope | Model |
|-------|--------|
| Phase A only | **Sonnet-class** — surgical, well-bounded |
| Phase B (Storage + signed URLs + backfill script) | **Opus-class** — RLS/storage edge cases and backfill safety |

---

## Approval gate

**Chris: no file changes, migrations, or Supabase commands until you approve.**

Suggested approval messages:

- **Phase A only:**  
  `#APPROVE: Company Branding Phase A — favicon is_super_admin gate, refreshBranding on save, docs fix`

- **Phase A + B (includes Storage/RLS):**  
  `#APPROVE: Company Branding Phase A+B` and `#APPROVE_RLS_CHANGE` for `company-branding` storage bucket policies

- **Include prod backfill:**  
  Add: `Approved: run backfill script against prod after bucket migration`

---

## Context snapshot

- Conflicting prior analysis about SINGLETON_ID applied to **old** branding; **`main` is org-scoped**.
- Real gaps: **base64 assets**, **email-gated favicon**, **no post-save context refresh**, **no branding bucket**.
- WORK_LOG shows branding hardening landed ~2026-04-17; recent work does not block this task.
