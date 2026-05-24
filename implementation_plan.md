# Implementation Plan — Agency Group Pass 1

**Goal:** Make Settings → Agency Group safe enough for a two-org smoke test by fixing the non-atomic group-creation flow, hardening shared resource uploads to match the live storage bucket exactly, improving load error handling, and verifying existing RLS / Edge Function behavior.

**Status:** Awaiting Chris approval before any code/migration/edge changes.

---

## Inspection Summary (live `jncvvsvckxhqgqvkppmj`, read-only)

### Row counts
| Table | Rows |
|------|------|
| `agency_groups` | 0 |
| `agency_group_members` | 0 |
| `agency_group_resources` | 0 |

Zero rows everywhere → safe to harden RLS without backfill.

### Storage bucket `agency-group-resources`
- exists, `public=false`
- `file_size_limit = 10,485,760` (10 MB)
- `allowed_mime_types`:
  - `application/pdf`
  - `application/msword`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `application/vnd.ms-powerpoint`
  - `application/vnd.openxmlformats-officedocument.presentationml.presentation`
  - `video/mp4`
  - `image/png`
  - `image/jpeg`
  - `text/plain`

App MUST mirror this list and limit exactly.

### Storage policies on `storage.objects` (agency-group-resources)
SELECT/INSERT/UPDATE/DELETE all gated by `bucket_id = 'agency-group-resources' AND (is_super_admin() OR active membership in the group whose UUID is the first folder segment)`. **No change planned to storage policies in this pass.**

### Current RLS on the three tables (matches repo)
- `agency_groups` SELECT requires an active OR invited membership for the caller's org. INSERT/UPDATE/DELETE: own master-org Admin or Super Admin.
- `agency_group_members` SELECT: same membership predicate. INSERT/UPDATE: master-org Admin or own Admin (for UPDATE only). DELETE: Super Admin only.
- `agency_group_resources` INSERT currently allows **any active member org Admin** (not just leader). **This must be tightened for Pass 1.**

### Triggers / Indexes / RPCs
- No triggers on the three tables.
- Unique partial index `idx_agency_group_members_one_active_group(organization_id) WHERE status IN ('active','invited')` is in place → enforces "one active/invited membership per org."
- Existing RPCs: `get_agency_group_leaderboard`, `is_agency_group_peer_organization` (both `SECURITY DEFINER`).
- **No `create_agency_group` RPC exists** → safe to add.

### Edge Functions
- All four (`invite-to-agency-group`, `accept-agency-group-invite`, `leave-agency-group`, `remove-from-agency-group`) deployed with `verify_jwt = false` and validate the bearer JWT in-code via `adminClient.auth.getUser(jwt)` (per AGENT_RULES §4 — ES256 gateway issue). `supabase/config.toml` matches.
- Spot-compared `invite-to-agency-group` deployed source byte-for-byte with `supabase/functions/invite-to-agency-group/index.ts` — identical.
- **No edge-function changes planned in this pass.**

### Stop-and-report check
- No existing rows would be affected (all tables empty).
- No atomic `create_agency_group` RPC exists.
- Storage bucket matches expected config.
- Edge Functions match repo, `verify_jwt=false` matches `config.toml`.
- RLS matches expected leader/member/super-admin model except for the resource-INSERT scope, which is in scope here.

→ Safe to proceed once approved.

---

## Files to touch

### New
- `supabase/migrations/20260524130000_agency_group_atomic_create.sql` — RPC `public.create_agency_group(p_name text)`.
- `supabase/migrations/20260524130100_agency_group_resources_insert_leader_only.sql` — tighten INSERT RLS on `agency_group_resources`.
- `src/components/settings/agency-group/agencyGroupSchema.ts` — Zod schemas + sanitized-filename helper.

### Modify
- `src/components/settings/agency-group/CreateGroupModal.tsx` — call RPC instead of two-step insert.
- `src/components/settings/AgencyGroupSettings.tsx` — propagate query errors, add error state + retry button.
- `src/components/settings/agency-group/AgencyGroupResourceList.tsx` — leader-only upload/delete gating, Zod file validation, sanitized storage path, delete order, signed-URL download already present (preserve).
- `src/components/settings/agency-group/AgencyGroupLeaderView.tsx` — pass `canManageResources={true}` to resource list; route invite email through new Zod schema.
- `src/components/settings/agency-group/AgencyGroupMemberView.tsx` — pass `canManageResources={false}` to resource list.
- `WORK_LOG.md` — newest-first entry.
- `implementation_plan.md` — final context snapshot at end.

### Not touched (deliberate)
- All four agency-group Edge Functions (deployed = repo, behavior correct).
- `agency_group_members` and `agency_groups` RLS policies.
- `agency_group_resources` SELECT / DELETE / UPDATE policies (DELETE policy already restricts to own-org Admin or Super Admin, which is acceptable for launch since uploads are leader-only).
- Storage `storage.objects` policies for the bucket.
- `get_agency_group_leaderboard`, `is_agency_group_peer_organization` RPCs.
- `types.ts`, `api.ts` (no shape change needed).

---

## Migrations (details)

### `20260524130000_agency_group_atomic_create.sql`

```sql
-- Atomic create_agency_group RPC.
-- Why: the frontend was inserting agency_groups then agency_group_members in
-- two separate statements. Because agency_groups SELECT requires an existing
-- agency_group_members row for the caller's org, the frontend could be unable
-- to read the new group back reliably, and a failed member insert would leave
-- an orphan group row. This RPC does both inside one SECURITY DEFINER
-- transaction. It also re-checks role/org server-side because SECURITY DEFINER
-- bypasses RLS.

CREATE OR REPLACE FUNCTION public.create_agency_group(p_name text)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_is_super boolean;
  v_clean text;
  v_existing int;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT organization_id, role, is_super_admin
    INTO v_org, v_role, v_is_super
  FROM public.profiles
  WHERE id = v_uid;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Caller has no organization' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_is_super = true OR v_role = 'Admin') THEN
    RAISE EXCEPTION 'Only Admins can create an Agency Group' USING ERRCODE = '42501';
  END IF;

  v_clean := btrim(coalesce(p_name, ''));
  IF char_length(v_clean) < 2 OR char_length(v_clean) > 80 THEN
    RAISE EXCEPTION 'Group name must be between 2 and 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Block if caller org has an active or invited membership anywhere.
  -- Matches idx_agency_group_members_one_active_group; explicit message wins
  -- over a raw unique-violation surfaced through PostgREST.
  SELECT count(*) INTO v_existing
  FROM public.agency_group_members
  WHERE organization_id = v_org
    AND status IN ('active', 'invited');

  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Your organization already has an Agency Group membership or pending invite'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.agency_groups (name, master_organization_id, created_by)
  VALUES (v_clean, v_org, v_uid)
  RETURNING id INTO v_new_id;

  INSERT INTO public.agency_group_members (
    agency_group_id, organization_id, role, status, joined_at, invited_by
  ) VALUES (
    v_new_id, v_org, 'leader', 'active', now(), v_uid
  );

  RETURN QUERY SELECT v_new_id, v_clean;
END;
$$;

REVOKE ALL ON FUNCTION public.create_agency_group(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_agency_group(text) TO authenticated;

COMMENT ON FUNCTION public.create_agency_group(text) IS
  'Atomically creates an agency_groups row and its leader agency_group_members '
  'row in a single SECURITY DEFINER transaction. Replaces the broken two-step '
  'frontend insert that could deadlock on the agency_groups SELECT RLS '
  'predicate (which requires a matching agency_group_members row) and could '
  'leave orphan groups if the second insert failed. Re-checks role/org '
  'server-side because SECURITY DEFINER bypasses RLS.';

NOTIFY pgrst, 'reload schema';
```

### `20260524130100_agency_group_resources_insert_leader_only.sql`

```sql
-- Tighten agency_group_resources INSERT to leader/master agency only.
-- Why: Pass 1 product decision is that shared resources are uploaded by the
-- leader (master agency) Admin or Super Admin only. The previous INSERT
-- policy allowed any active member org Admin to upload, which exceeds the
-- launch scope. SELECT/UPDATE/DELETE policies are unchanged.

DROP POLICY IF EXISTS agency_group_resources_insert ON public.agency_group_resources;

CREATE POLICY agency_group_resources_insert ON public.agency_group_resources
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.get_user_role() = 'Admin'
      AND uploaded_by_org_id = public.get_org_id()
      AND EXISTS (
        SELECT 1 FROM public.agency_groups g
        WHERE g.id = agency_group_resources.agency_group_id
          AND g.master_organization_id = public.get_org_id()
      )
    )
  );

NOTIFY pgrst, 'reload schema';
```

> Note: the storage-object INSERT policy still allows any active member to upload to the bucket folder. The DB-row INSERT being leader-only is sufficient for the launch — the orphan storage object would simply not be visible in the UI, and member upload is also gated in the frontend (button hidden + handler guard). A bucket-level INSERT tightening can be a Pass 2 follow-up alongside any "members can upload their own org-scoped resource" feature.

---

## Frontend changes (details)

### `agencyGroupSchema.ts` (new)
```ts
export const ALLOWED_RESOURCE_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "video/mp4",
  "image/png",
  "image/jpeg",
  "text/plain",
] as const;

export const MAX_RESOURCE_BYTES = 10 * 1024 * 1024; // 10,485,760
export const groupNameSchema = z.string().trim().min(2).max(80);
export const inviteEmailSchema = z.string().trim().toLowerCase().email();
export const resourceFileSchema = z.object({
  size: z.number().int().positive().max(MAX_RESOURCE_BYTES),
  type: z.enum(ALLOWED_RESOURCE_MIME_TYPES),
  name: z.string().min(1).max(255),
});
export function sanitizeFileName(name: string): string { … } // strip path chars, collapse whitespace, keep extension
```

### `CreateGroupModal.tsx`
Replace the two-step insert with a single `supabase.rpc("create_agency_group", { p_name: parsed.data.name })`. No `organization_id` or `master_organization_id` sent from the client. Friendly error mapping for `22023`, `42501`, `23505`. On success: toast, reset form, `onCreated()`, close.

### `AgencyGroupSettings.tsx`
- Capture `error` from each Supabase call.
- New states `loadError`, `loading`.
- On any error: set `loadError`, stop. Do not blank out to no-group state.
- Render error block with retry button calling `load()` when `loadError` is set.
- Preserve everything else.

### `AgencyGroupResourceList.tsx`
- New prop `canManageResources: boolean`.
- Hide upload `<label>` if `!canManageResources`.
- Guard `onUpload` handler immediately.
- Validate file via `resourceFileSchema` before upload. Friendly toast on validation failure ("File type not supported", "File too large — 10 MB max").
- Storage path: `${groupId}/${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(file.name)}`.
- `title` saved as sanitized display name (sanitize result, but keep extension).
- `file_name` saved as sanitized display name.
- Delete order: DB delete first → if success, attempt storage `remove([file_url])`. If storage delete fails after DB delete, surface a warning toast but don't resurrect the row.
- Hide delete button when `!canManageResources`.
- Download already uses `createSignedUrl(path, 60)` — preserve.

### `AgencyGroupLeaderView.tsx`
- Pass `canManageResources={true}` to `AgencyGroupResourceList`.
- Invite email runs through `inviteEmailSchema` (Zod), replacing the inline schema.

### `AgencyGroupMemberView.tsx`
- Pass `canManageResources={false}`.

---

## Activity logging
Hold off in Pass 1 — `useActivityLog` calls exist throughout the codebase but inspection didn't surface a clear pattern specific to Agency Group. Adding consistent logs (group created / resource uploaded / deleted) is best done in Pass 2 alongside the existing activity-log conventions for that module rather than ad-hoc here.

## Behavior preservation
- No-group, pending invite, leader, member, accept/decline, leave/remove, download flows untouched.
- Existing RLS boundaries preserved for `agency_groups` and `agency_group_members`.
- Super Admin access preserved via `is_super_admin()` branches.

## Verification plan
1. `npx tsc --noEmit` → 0 errors.
2. `npm test -- --run` → all passing.
3. Live audits (read-only via Supabase MCP):
   - `create_agency_group` RPC exists, `prosecdef = true`, `proconfig` includes `search_path=public`, EXECUTE granted to `authenticated`.
   - `agency_group_resources_insert` policy `with_check` references `g.master_organization_id = public.get_org_id()`.
   - `agency_group_resources_select` still allows active members to read.
   - Bucket still `public = false`, size & MIME list unchanged.
   - Row counts unchanged (0/0/0) unless I or Chris created smoke rows.

## Manual smoke checklist (to be performed by Chris with a second org)
1. Admin creates an agency group successfully.
2. Group + leader-member row both appear (one RPC call).
3. Non-Admin cannot create (RPC raises `Only Admins…`).
4. Leader can invite another agency.
5. Invited org sees pending invite, can accept/decline.
6. Member can view/download resources.
7. Member cannot upload (button hidden, handler guarded).
8. Leader uploads PDF under 10 MB — succeeds.
9. Leader attempts to upload `.svg`/`.csv`/`.webp` → blocked with friendly toast.
10. Leader attempts >10 MB file → blocked.
11. Storage path includes sanitized filename + random UUID + timestamp.
12. Download uses signed URL.
13. Leader deletes a resource → row removed first, storage object removed second, no orphan UI rows.
14. No console errors.

## Blockers / questions
- None blocking. Final context snapshot will be appended once code lands and tests pass.

---

> [!IMPORTANT]
> Awaiting Chris's explicit approval before:
> 1. Writing the two new migrations to disk and applying them via `apply_migration`.
> 2. Editing the listed frontend files.
> 3. Running `tsc` / tests.
> No Edge Function deploys are planned.

---

## Approval

Chris approved on 2026-05-24 with redlines:
- Use fresh migration timestamps later than the latest (`20260527130000`) — used `20260527140000` and `20260527140100`.
- Keep `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated` on the RPC.
- Keep `SET search_path = public`, derive caller org from `auth.uid()/profiles`, require Admin or `is_super_admin()`, enforce one-active-membership-per-org, do create + leader-member in one transaction.
- Resource INSERT RLS matches the leader/master spec.
- Continue using `createSignedUrl` for downloads.

All redlines applied as written.

---

## Final context snapshot

### Changes
- New atomic `public.create_agency_group(text)` RPC replaces the unsafe two-step frontend insert flow.
- `agency_group_resources` INSERT policy tightened to leader/master agency Admin (or Super Admin).
- New Zod schemas mirror the live private bucket exactly (10 MB, 9 MIME types) and feed `CreateGroupModal`, `AgencyGroupLeaderView`, and `AgencyGroupResourceList`.
- `AgencyGroupSettings.tsx` propagates per-query Supabase errors with a Retry UI.
- Resource list: leader-only upload/delete gating + Zod validation + sanitized random storage path + DB-first delete order; signed-URL download preserved.

### Decisions
- Group creation goes through `SECURITY DEFINER` RPC; no `organization_id` / `master_organization_id` sent from the frontend.
- Leader/master agency only uploads shared resources for launch; member orgs view/download only.
- Bucket is the source of truth for file validation.
- Storage `storage.objects` policies untouched in this pass; DB-row INSERT + frontend already gate to leader-only.
- Activity logging and invite-resend/expired UX deferred to Pass 2.
- No Edge Function changes; deployed source already matches repo and `verify_jwt=false` matches `config.toml`.

### Files touched
| Path | Kind |
|------|------|
| `supabase/migrations/20260527140000_agency_group_atomic_create.sql` | new |
| `supabase/migrations/20260527140100_agency_group_resources_insert_leader_only.sql` | new |
| `src/components/settings/agency-group/agencyGroupSchema.ts` | new |
| `src/components/settings/AgencyGroupSettings.tsx` | modified |
| `src/components/settings/agency-group/CreateGroupModal.tsx` | modified |
| `src/components/settings/agency-group/AgencyGroupResourceList.tsx` | modified |
| `src/components/settings/agency-group/AgencyGroupLeaderView.tsx` | modified |
| `src/components/settings/agency-group/AgencyGroupMemberView.tsx` | modified |
| `src/integrations/supabase/types.ts` | modified (hand-patch `Functions` block) |
| `WORK_LOG.md` | appended |
| `implementation_plan.md` | this file |

### Migrations / deploys
- `20260527140000_agency_group_atomic_create` applied live to `jncvvsvckxhqgqvkppmj`.
- `20260527140100_agency_group_resources_insert_leader_only` applied live to `jncvvsvckxhqgqvkppmj`.
- No Edge Function deploys.

### Verification
- `npx tsc --noEmit` → 0 errors.
- `npm test -- --run` → 72 / 72 passing.
- Live audits:
  - `create_agency_group` exists, `prosecdef = true`, `proconfig = ['search_path=public']`, EXECUTE granted only to `authenticated`.
  - `agency_group_resources_insert` `with_check` requires `master_organization_id = get_org_id()`.
  - Bucket `agency-group-resources` unchanged (`public=false`, 10,485,760 bytes, 9 MIME types).
  - Row counts: 0 / 0 / 0 (no smoke rows created).

### Manual check status
Pending Chris — see WORK_LOG manual smoke checklist (16 steps).

### Blockers / next steps
- None. Awaiting Chris's manual smoke with a second org and explicit push/merge decision.
- Pass 2 candidates: storage-object INSERT RLS tightening (defense-in-depth), activity logging, invite resend/expired UX polish.
