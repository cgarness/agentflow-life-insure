# Implementation Plan — Contacts Build 5: Permissions Framework + Contacts Permission Wiring

**Owner:** Chris Garness · **Date:** 2026-06-24
**Branch:** `claude/contacts-build5-permissions-cp2` (off `origin/main` `9b395f6`) — **created.**
**Status:** **CP2 COMPLETE (on-branch; not shipped).** Permission catalog + Settings UI + frontend gating implemented. No SQL/migration/RLS/RPC/Supabase mutation. Nothing committed/pushed/PR'd/merged/deployed. Build 6 not started.

> Build sequence: B1 Data Integrity + Assignment ✓ · B2 Scope/Filters/Bulk/Sort ✓ · B3 Import Undo + Lifecycle ✓ · B4 Kanban + List Consistency ✓ (shipped, PR #319) · **B5 Permissions Framework + Contacts Wiring (THIS BUILD)** · B6 UI Closeout + Refactor.

> **Direction change (2026-06-24):** Build 5 pivoted from "hardcode Contacts role gates" (original CP1) to a **configurable, per-agency permissions framework, Contacts-first, backend-enforceable** (CP1B). This plan supersedes the CP1 frontend-only approach. CP1/CP1B audit findings are retained in the session record + WORK_LOG.

---

## 1. Revised Build 5 architecture

**Reuse and extend the existing `role_permissions` framework — do NOT rebuild or add custom roles.**

The framework already exists ~70%: `role_permissions` is per-org (RLS: SELECT any org member, **write Admin-only**), the JSONB is module-grouped, defaults live in `permissionDefaults.ts`, `Permissions.tsx` is the Settings UI, and `usePermissions`/`PermissionGate` are the readers. The two gaps Build 5 closes: **(a) enforcement is UI-only today**, and **(b) the Contacts catalog was coarse + display-name-keyed.** Build 5 adds a **stable-key Contacts catalog**, a **normalized `contacts` JSONB block**, frontend wiring (CP2), and a backend enforcement layer (CP3, approval-gated).

**Live prod fact (de-risks migration):** only **2 `role_permissions` rows in 1 org**, both `permissions = {}` → the org runs on `permissionDefaults`. There is **no customization data to migrate or break**.

---

## 2. Locked CP1B decisions

- **D-roles:** built-in roles only (Agent, Team Leader, Admin, Super Admin). **Agent + Team Leader configurable; Admin locked full-access in-org; Super Admin locked full-access within home-org/approved platform boundary.** No custom roles; no configurable Admin/Super Admin columns yet.
- **D-storage:** new **normalized `contacts` block** in `role_permissions.permissions` (flat `{ "contacts.x.y": bool }` for that row's role). Legacy display-name-keyed `f` array stays for **non-Contacts** modules until they migrate; Contacts backend logic never reads `f`.
- **D-unassigned-default:** Agent `view_unassigned = false`; Team Leader `= true`; Admin/Super Admin always true (locked).
- **D-scope-model:** for Contacts, the new catalog keys supersede the legacy Data Access "Leads & Contacts" own/team/all pill. The legacy Data Access system is **not** removed globally; other modules unchanged.
- **D-import-enforcement (CP2):** gate import in frontend via the catalog; keep the existing INSERT/RLS floor; **no dedicated import RPC in CP2** (revisit in CP3).

**Conversion — locked product rule:** Lead → Client conversion is **not configurable**. No catalog key, never rendered as a toggle, never gated. Available to any user who can legitimately access a lead through org-scoped workflows. Hard boundaries always apply: same org, no cross-org, no service-role exposure, no `organization_id` bypass, no telemetry loss, no duplicate client, existing atomic safeguards. **Conversion RPC is NOT changed in CP2;** CP3 audits whether its authorization needs a small alignment.

**Hardcoded non-configurable boundaries:** tenant isolation by `organization_id`; no cross-org CRM access from Contacts UI; no frontend service-role keys; telemetry integrity; Twilio/Dialer safety invariants; conversion lineage/telemetry preservation; backend enforces sensitive mutations (not just UI).

---

## 3. Contacts permission catalog (`CONTACTS_PERMISSIONS`)

25 keys, namespaced `contacts.<entity>.<action>`. Defaults ✅ on / ⬜ off; **Admin + Super Admin = ✅ always (locked).** **No conversion key.**

| Key | Group | Agent | Team Leader | Danger |
|---|---|:--:|:--:|:--:|
| `contacts.leads.view_assigned` | Leads | ✅ | ✅ | |
| `contacts.leads.view_unassigned` | Leads | ⬜ | ✅ | |
| `contacts.leads.view_all` | Leads | ⬜ | ⬜ | |
| `contacts.leads.create` | Leads | ✅ | ✅ | |
| `contacts.leads.edit` | Leads | ✅ | ✅ | |
| `contacts.leads.delete` | Leads | ⬜ | ⬜ | ⚠️ |
| `contacts.leads.import` | Leads | ⬜ | ✅ | ⚠️ |
| `contacts.leads.undo_own_import` | Leads | ⬜ | ✅ | ⚠️ |
| `contacts.leads.undo_team_import` | Leads | ⬜ | ✅ | ⚠️ |
| `contacts.leads.assign` | Leads | ⬜ | ✅ | |
| `contacts.leads.bulk_assign` | Leads | ⬜ | ✅ | |
| `contacts.leads.bulk_status` | Leads | ✅ | ✅ | |
| `contacts.leads.update_status` | Leads | ✅ | ✅ | |
| `contacts.leads.add_to_campaign` | Leads | ⬜ | ✅ | |
| `contacts.clients.view` | Clients | ✅ | ✅ | |
| `contacts.clients.edit` | Clients | ✅ | ✅ | |
| `contacts.clients.delete` | Clients | ⬜ | ⬜ | ⚠️ |
| `contacts.recruits.view` | Recruits | ✅ | ✅ | |
| `contacts.recruits.create` | Recruits | ✅ | ✅ | |
| `contacts.recruits.edit` | Recruits | ✅ | ✅ | |
| `contacts.recruits.delete` | Recruits | ⬜ | ⬜ | ⚠️ |
| `contacts.notes.manage` | Engagement | ✅ | ✅ | |
| `contacts.tasks.manage` | Engagement | ✅ | ✅ | |
| `contacts.appointments.manage` | Engagement | ✅ | ✅ | |
| `contacts.messages.manage` | Engagement | ✅ | ✅ | |

*(There is intentionally NO `contacts.clients.create` key — manual client create stays universally available, not agency-configurable.)*

---

## 4. Default role presets

- **Agent** — own book: view/create/edit assigned leads, status/Kanban (own), bulk status, view/edit clients, recruit CRUD-minus-delete, notes/tasks/appointments/messages, **convert (hardcoded)**. Off: delete, import, assign/bulk-assign, add-to-campaign, view-unassigned, view-all.
- **Team Leader** — Agent + downline mgmt: assign/bulk-assign, import + undo own/team, add-to-campaign, **view-unassigned ON**. Off: delete, view-all.
- **Admin** — full Contacts access (locked) in-org.
- **Super Admin** — full Contacts access (locked) within home-org boundary.

---

## 5. Backend enforcement architecture (Hybrid, tiered) — CP3 design (not implemented in CP2)

| Action(s) | Enforcement |
|---|---|
| view-assigned, create, edit, update-status, view/edit clients, recruit CRUD-minus-delete, notes/tasks/appointments/messages | **Existing RLS** (already owner/org/downline-correct) + FE gate |
| assign, bulk-assign, bulk-status, add-to-campaign, import | **FE gate + existing RLS floor** (RLS blocks cross-owner/cross-org) |
| **delete leads/clients/recruits** | **SECURITY DEFINER RPC `delete_contact(p_id, p_type)`** with `has_contacts_permission` + org/ownership check |
| **view unassigned** (and later view-all) | **One additive permissive SELECT RLS policy** gated by `has_contacts_permission` (only true RLS change → `#APPROVE_RLS_CHANGE`) |
| undo own/team import | **Existing DEFINER RPCs** (already importer/Admin/TL-over-importer authorized) |
| **convert** | **Hardcoded** — existing atomic RPC; no toggle |
| tenant/cross-org/telemetry/service-role | **Hardcoded** |

**Permission helper (CP3):** `public.has_contacts_permission(p_key text)` — `STABLE SECURITY DEFINER`, `search_path = public, pg_temp`, `auth.uid()`+`get_org_id()` only (no caller-supplied identity), Admin/SA short-circuit, stored override → `_contacts_permission_default` fallback, anon-revoked. Single-row STABLE lookups (RLS-safe, cheap, no policy recursion).

---

## 6. Checkpoint plan

- **CP1 — DONE:** read-only audit (frontend + RLS/RPC + ownership). No P0; ownership data (507/517 leads unassigned).
- **CP1B — DONE:** revised architecture plan (this doc). Approved by Chris with locked decisions above.
- **CP2 — DONE (this checkpoint, on-branch):** permission catalog + Settings UI + `hasContactsPermission` + frontend gating + tests. No backend. **HOLD for approval.**
- **CP3 (approval-gated):** backend enforcement — `has_contacts_permission` + `_contacts_permission_default` helpers, `delete_contact` DEFINER RPC, additive unassigned SELECT policy (`#APPROVE_RLS_CHANGE`), conversion-authorization audit, optional lead-source anon-revoke/search_path hardening. Validate on a faithful harness branch first (replay-debt precedent); prod never first. Regenerate `types.ts`.
- **CP4:** validation + PR (tsc/vitest/ESLint/advisors/parity).
- **CP5:** merge → Vercel deploy → smoke → newest-first WORK_LOG closeout.

For each backend CP: files likely touched, migration (CP3 only), Supabase validation, test plan, approval gate, rollback (`REVOKE`+`DROP` additive objects; `git revert` frontend).

---

## 7. CP2 implementation summary (on-branch; nothing applied/committed)

### Files changed
**New:** `src/lib/__tests__/contactsPermissions.test.ts`, `pageGuardContacts.test.tsx`, `contactsGatingRender.test.tsx`, `permissionsSettingsContacts.test.tsx`.
**Edited:** `src/config/permissionDefaults.ts` (catalog + helpers + `RolePermissions.contacts`), `src/hooks/usePermissions.ts` (`hasContactsPermission` + stale-comment fix), `src/components/PageGuard.tsx` (`contactsPermission` prop), `src/components/settings/Permissions.tsx` (Contacts module + System Rules panel + persist `contacts` block + activity-log diff), `src/pages/Contacts.tsx` (gating), `src/components/contacts/FullScreenContactView.tsx` (edit/delete gating; convert ungated), `ContactKanbanBoard.tsx` / `KanbanColumn.tsx` / `KanbanCard.tsx` (`canDrag` gating), `src/App.tsx` (import route gate), `src/lib/__tests__/contactsRender.test.tsx` (mock `usePermissions`).

### Behavior changes
- **Settings → Permissions:** new "Contacts Permissions" module (first), rendered from the shared catalog, grouped Leads/Clients/Recruits/Engagement; danger chips + warning copy on delete/import/undo; a "System rules" panel listing the non-configurable boundaries (incl. conversion-for-all); Agent/Team Leader configurable, Admin/SA locked full; persists a normalized `permissions.contacts` block via the existing `(org, role)` upsert; missing keys fall back to defaults; legacy modules unchanged.
- **Contacts page:** import button + `/contacts/import` route, bulk delete (per-entity), bulk assign, bulk status, add-to-campaign, row edit/delete, create buttons, inline status selects, and Kanban drag are gated by the catalog. Disabled controls where it aids understanding; destructive actions hidden when not allowed. **Conversion (button, row action, modal, RPC, win trigger) is untouched and ungated.**
- **`hasContactsPermission(key)`:** Admin/SA → true; stored override → catalog default; never display-name-keyed; never gates conversion.

### Verification
`npx tsc --noEmit` clean · `npx vitest run` **328/328** (302 baseline + 26 new) · targeted ESLint **0 errors / 8 benign warnings** (pre-existing exhaustive-deps + unused-disable) · `git diff --check` clean.

---

## 8. CP3 backend enforcement proposal (do NOT implement in CP2)

CP3 (explicitly approval-gated) should evaluate + implement, on a harness branch first:
1. `has_contacts_permission(text)` + `_contacts_permission_default(text,text)` helpers (design §5).
2. `delete_contact(p_id, p_type)` DEFINER RPC with permission + org + ownership checks; route `*.delete` through it.
3. Additive permissive SELECT policy on `leads` for the unassigned pool gated by `contacts.leads.view_unassigned` (`#APPROVE_RLS_CHANGE`); evaluate `contacts.leads.view_all` similarly.
4. Add-to-Campaign backend parity (optional role check in `add_leads_to_campaign`).
5. Import backend parity (whether a DEFINER import RPC is warranted vs. the INSERT-RLS floor).
6. Lead-source `rename_lead_source`/`reassign_and_delete_lead_source` anon-revoke + `pg_temp` (CP1 P3 finding) — Chris's call (settings-adjacent).
7. **Conversion authorization audit:** confirm `convert_lead_to_client_atomic` matches the "legitimately accessed within org ⇒ convertible" rule; identify the smallest change only if a gap exists. **Do not change the conversion RPC without explicit approval.**

---

## 9. Non-goals (Build 5 CP2)

No SQL/migrations/RLS/RPC/Supabase mutation; no commit/push/PR/merge/deploy; no Build 6. Untouched: Twilio/Dialer, queue claim/advance, import-undo logic, Build 4 Kanban data contract, Clients Kanban, Control Center, unrelated settings/data cleanup, conversion RPC/win trigger, legacy non-Contacts permission modules (`f` array), custom roles, configurable Admin/Super Admin columns.

---

## 10. Process gate

CP2 implemented on-branch only. **No migration authored or applied, no production mutation, nothing committed/pushed/PR'd/merged/deployed. Build 5 not shipped. Build 6 not started.** Awaiting Chris approval before CP3 (backend enforcement).

---

# CHECKPOINT 3A — Backend enforcement design + migration draft (2026-06-24)

**Draft/review only. No SQL applied, no DDL on prod, no data mutation, no RLS change in prod, no Supabase branch, nothing committed/deployed.** All inspection below was read-only.

## 11. Read-only production inspection (confirmed current)

- **`role_permissions`:** `(id, organization_id NOT NULL, role text NOT NULL, permissions jsonb NOT NULL DEFAULT '{}', created_at, updated_at, updated_by)`, unique `(organization_id, role)`. RLS: SELECT org-scoped (any member); INSERT/UPDATE/DELETE Admin-only (`profiles.role='Admin'`). Table GRANTs are broad (anon/authenticated/service_role) but RLS gates them (anon fails closed). Live: 2 rows, 1 org, both `permissions={}`.
- **leads / clients / recruits RLS:** each a **single PERMISSIVE `FOR ALL`** policy on `{authenticated}` → an additive PERMISSIVE `FOR SELECT` policy ORs in cleanly. Agent-owner branch = `user_id=auth.uid()` (leads) / `assigned_agent_id=auth.uid()` (clients/recruits); TL via `is_ancestor_of`; Admin org-wide; SA home-org via `super_admin_own_org`.
- **FKs referencing leads** (delete impact): `calls.lead_id`, `campaign_leads.lead_id`, `messages.lead_id` — all **ON DELETE SET NULL** (telemetry rows survive). No CASCADE referencing leads/clients/recruits. Polymorphic children (notes/activities/tasks/appointments/contact_emails/workflow_executions via `contact_id`) have **no FK** → a hard delete orphans them (this is the **existing** `*.delete` behavior, not a regression).
- **Triggers on leads/clients/recruits:** INSERT/UPDATE-only (sync user_id, notify-assigned, workflow created/updated, client workflow insert). **No DELETE-firing trigger** → a hard delete has no workflow/telemetry side-effects.
- **Helpers:** `get_org_id()` (JWT + profiles fallback), `get_user_role()` (JWT-only, no search_path), `is_super_admin()` (JWT-only, no search_path), `super_admin_own_org()` (home-org bound), `is_ancestor_of()` (DEFINER ltree).
- **`convert_lead_to_client_atomic` / `add_leads_to_campaign` / `finalize`/`undo`/`preview`/`_import_undo_context`:** bodies re-read (unchanged since CP1); authorization summarized in §17–§18 below.

## 12. `_contacts_permission_default` (DRAFT — owner-only helper)

Matches the CP2 TS catalog exactly. IMMUTABLE pure map. Owner-only (called only by `has_contacts_permission`, which is DEFINER/owner `postgres`), mirroring `_import_undo_context` least-privilege.

```sql
CREATE OR REPLACE FUNCTION public._contacts_permission_default(p_role text, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT CASE p_role WHEN 'Agent' THEN d.agent WHEN 'Team Leader' THEN d.team_leader ELSE false END
     FROM (VALUES
       ('contacts.leads.view_assigned',  true,  true),
       ('contacts.leads.view_unassigned',false, true),
       ('contacts.leads.view_all',       false, false),
       ('contacts.leads.create',         true,  true),
       ('contacts.leads.edit',           true,  true),
       ('contacts.leads.delete',         false, false),
       ('contacts.leads.import',         false, true),
       ('contacts.leads.undo_own_import',false, true),
       ('contacts.leads.undo_team_import',false,true),
       ('contacts.leads.assign',         false, true),
       ('contacts.leads.bulk_assign',    false, true),
       ('contacts.leads.bulk_status',    true,  true),
       ('contacts.leads.update_status',  true,  true),
       ('contacts.leads.add_to_campaign',false, true),
       ('contacts.clients.view',         true,  true),
       ('contacts.clients.edit',         true,  true),
       ('contacts.clients.delete',       false, false),
       ('contacts.recruits.view',        true,  true),
       ('contacts.recruits.create',      true,  true),
       ('contacts.recruits.edit',        true,  true),
       ('contacts.recruits.delete',      false, false),
       ('contacts.notes.manage',         true,  true),
       ('contacts.tasks.manage',         true,  true),
       ('contacts.appointments.manage',  true,  true),
       ('contacts.messages.manage',      true,  true)
     ) AS d(key, agent, team_leader)
     WHERE d.key = p_key),
    false  -- unknown key → deny
  );
$$;
REVOKE ALL ON FUNCTION public._contacts_permission_default(text, text) FROM PUBLIC;
-- (no anon/authenticated grant: internal helper, invoked only by has_contacts_permission)
```

## 13. `has_contacts_permission` (DRAFT)

```sql
CREATE OR REPLACE FUNCTION public.has_contacts_permission(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_role text;
  v_is_super boolean;
  v_val jsonb;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL THEN
    RETURN false;
  END IF;

  -- Role read from profiles, SCOPED to the caller's org. A Super Admin only matches
  -- here when get_org_id() = their home org → home-org full-access boundary (D-roles).
  SELECT p.role, COALESCE(p.is_super_admin, false)
    INTO v_role, v_is_super
  FROM public.profiles p
  WHERE p.id = v_uid AND p.organization_id = v_org;

  IF NOT FOUND OR v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'Admin' OR v_is_super THEN
    RETURN true;  -- locked full-access
  END IF;

  -- Configurable roles: stored override wins, else hardcoded catalog default.
  SELECT rp.permissions -> 'contacts' -> p_key
    INTO v_val
  FROM public.role_permissions rp
  WHERE rp.organization_id = v_org AND rp.role = v_role;

  IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'boolean' THEN
    RETURN v_val::boolean;
  END IF;

  RETURN public._contacts_permission_default(v_role, p_key);
END;
$$;
REVOKE ALL ON FUNCTION public.has_contacts_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_contacts_permission(text) TO authenticated, service_role;
```

- No caller-supplied uid/org; reads role from `profiles` scoped to `get_org_id()`; Admin/SA → true (SA home-org-bounded); stored override → default fallback; unknown key → false. STABLE, safe search_path, anon revoked. Reads only `profiles`/`role_permissions` (never `leads`) → **no RLS recursion** when used inside a leads policy. Two indexed single-row lookups → cheap/cacheable.

## 14. `delete_contact` (DRAFT — single RPC)

Hard-delete **parity** with today's `*.delete` (telemetry preserved via existing SET-NULL FKs; no new cascade). Adds the permission *capability* gate on top of the existing ownership *scope* (mirrored in-function because DEFINER bypasses RLS).

```sql
CREATE OR REPLACE FUNCTION public.delete_contact(p_contact_type text, p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid := public.get_org_id();
  v_role text;
  v_is_super boolean;
  v_type text := lower(btrim(coalesce(p_contact_type, '')));
  v_perm_key text;
  v_owner uuid;
  v_row_org uuid;
  v_deleted int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no_org' USING ERRCODE='28000'; END IF;
  IF v_type NOT IN ('lead','client','recruit') THEN
    RAISE EXCEPTION 'invalid_contact_type:%', p_contact_type USING ERRCODE='22023';
  END IF;

  SELECT p.role, COALESCE(p.is_super_admin,false) INTO v_role, v_is_super
  FROM public.profiles p WHERE p.id = v_uid AND p.organization_id = v_org;
  IF NOT FOUND OR v_role IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;

  v_perm_key := 'contacts.' || CASE v_type WHEN 'lead' THEN 'leads' WHEN 'client' THEN 'clients' ELSE 'recruits' END || '.delete';
  IF NOT public.has_contacts_permission(v_perm_key) THEN
    RAISE EXCEPTION 'permission_denied:%', v_perm_key USING ERRCODE='42501';
  END IF;

  IF v_type = 'lead' THEN
    SELECT organization_id, user_id        INTO v_row_org, v_owner FROM public.leads    WHERE id = p_contact_id FOR UPDATE;
  ELSIF v_type = 'client' THEN
    SELECT organization_id, assigned_agent_id INTO v_row_org, v_owner FROM public.clients  WHERE id = p_contact_id FOR UPDATE;
  ELSE
    SELECT organization_id, assigned_agent_id INTO v_row_org, v_owner FROM public.recruits WHERE id = p_contact_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('deleted', false, 'reason', 'not_found'); END IF;
  IF v_row_org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'cross_org' USING ERRCODE='42501'; END IF;

  -- Ownership/scope boundary (mirrors hierarchical RLS), ON TOP of the permission capability.
  IF NOT (
       v_role = 'Admin'
    OR v_is_super
    OR v_owner = v_uid
    OR (v_role IN ('Team Leader','Team Lead') AND v_owner IS NOT NULL AND public.is_ancestor_of(v_uid, v_owner))
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;

  IF v_type = 'lead' THEN
    DELETE FROM public.leads    WHERE id = p_contact_id AND organization_id = v_org;
  ELSIF v_type = 'client' THEN
    DELETE FROM public.clients  WHERE id = p_contact_id AND organization_id = v_org;
  ELSE
    DELETE FROM public.recruits WHERE id = p_contact_id AND organization_id = v_org;
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted > 0, 'contact_type', v_type, 'id', p_contact_id);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_contact(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_contact(text, uuid) TO authenticated, service_role;
```

**Hard-delete vs archive:** recommend **hard-delete (parity)** — telemetry (`calls`/`call_logs`/`campaign_leads`) is preserved (SET NULL, rows survive), and orphaned polymorphic children are pre-existing behavior. A future **archive/deactivate** model (soft-delete flag) is the safer long-term design but is **out of CP3 scope** unless Chris approves (it needs a schema column + read-path filtering everywhere).

## 15. Unassigned-lead additive SELECT policy (DRAFT) — `#APPROVE_RLS_CHANGE required before CP3B implementation/apply.`

```sql
CREATE POLICY leads_select_unassigned_pool ON public.leads
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND user_id IS NULL
    AND assigned_agent_id IS NULL
    AND public.has_contacts_permission('contacts.leads.view_unassigned')
  );
```

- **Additive PERMISSIVE SELECT** → OR-ed with the existing `FOR ALL` policy; never restricts. Only ADDS visibility of **org-scoped, fully-unassigned** leads when the permission is on. Never cross-org. Does NOT broaden UPDATE/DELETE (those stay under the ALL policy → unassigned remain Admin-only to mutate). The owner/downline/admin policy is untouched.
- **Necessary but not sufficient for the UI:** `_contacts_filtered_leads` (INVOKER) honors RLS, but its scope filter keys `mine` on `user_id=auth.uid()` (unassigned won't match `mine`) and `agency` on org. **CP3B frontend must surface unassigned** (e.g., an "Unassigned" scope/toggle, or include unassigned in the agent's view) for the policy to be visible in the list. Queue/Dialer and Build 4 Kanban data contract are unaffected (Kanban reuses the same filtered helper → newly permitted rows simply appear).

## 16. `view_all` — DEFER (designed, not implemented)

Recommend **defer backend enforcement**: the catalog toggle exists (default OFF for Agent+TL) but is **not consumed by any CP2 gate** and no UI currently requires org-wide visibility for non-admins. When needed, mirror §15: `CREATE POLICY leads_select_all_org ... USING (organization_id = public.get_org_id() AND public.has_contacts_permission('contacts.leads.view_all'))` (+ a frontend "all" scope). **CP3B note:** add a "not yet enforced" hint to the `view_all` toggle help text (or hide it) to avoid a UI/backend mismatch until implemented. **Decision for Chris.**

## 17. Add-to-Campaign backend — recommendation

`add_leads_to_campaign` (DEFINER) today: no role check; org-scoped + campaign-type rules (Personal=owner, Team=downline, Open=any org lead); also used by the import-to-campaign path. **Recommend: leave backend as-is (frontend-gated) for CP3** because (a) it's org-scoped (no cross-org risk) and no broader than the `campaign_leads` INSERT RLS, (b) it's a Campaigns-domain RPC shared with import — adding a Contacts key couples the two, (c) Campaigns will get its own permission module later. *Alternative (if Chris wants server enforcement now):* add `IF NOT public.has_contacts_permission('contacts.leads.add_to_campaign') THEN RAISE ... END IF;` at the top — smallest change, but note the import-path coupling. **Do not change in CP3A.**

## 18. Import backend — recommendation

Import = client-side batch INSERT (`importLeadsToSupabase`, gated by leads INSERT RLS: `user_id=auth.uid()` or admin) → `finalize_contact_import` (DEFINER, authorized via `_import_undo_context`). **Recommend: leave as-is — FE gate (CP2) + existing INSERT/RLS floor**, no dedicated import RPC (locked D-import-enforcement). Residual gap is UX-only (an agent could API-insert their *own* leads, which `contacts.leads.create` already allows). Undo already maps to `undo_own_import`/`undo_team_import` semantics (importer / TL-over-importer / Admin). Revisit a DEFINER import RPC at Contacts closeout if deeper enforcement is wanted.

## 19. Conversion audit — result: NO CHANGE NEEDED

`convert_lead_to_client_atomic` authorization: server-derived uid/org; **same-org enforced** (cross_org raised); **idempotent on `clients.lead_id`** (no duplicate client); telemetry/lineage preserved (per AGENT_RULES §5); authorized = owner (`user_id`/`assigned_agent_id`=uid) OR unassigned (both null) OR Admin OR SA(home-org) OR TL-over-owner. This is exactly the **"legitimately accessible within org"** set (own + org pool + downline + admin) and matches Chris's universal-within-legitimate-access rule. **No change.** *Only* if Chris wants literal "any org member may convert ANY lead regardless of ownership/visibility" would a change apply (drop the ownership block, keep same-org) — **not recommended** (would allow converting a peer's lead the user can't otherwise see). **Do not change conversion in CP3.**

## 20. Least-privilege hardening — SEPARATE optional migration (not mixed with core)

CP1 P3 items, in a **separate** `..._contacts_permissions_hardening.sql` if Chris approves, ordered by safety:
- **Safe:** `REVOKE EXECUTE ON FUNCTION rename_lead_source(...), reassign_and_delete_lead_source(...) FROM anon;` + `SET search_path = public, pg_temp` on both (they already fail closed; this is defense-in-depth). `ALTER FUNCTION get_user_role() SET search_path = public; ALTER FUNCTION is_super_admin() SET search_path = public;`
- **Riskier (defer / explicit approval):** revoking broad `anon` table grants and converting `{public}`→`{authenticated}` policies (Supabase default pattern; could affect other flows); dropping `OR organization_id IS NULL` SELECT branches on `contact_notes`/`contact_activities` (0 rows today, latent). **Do not bundle with the core Contacts permission migration.**

## 21. SQL integration test plan (DRAFT — to run on harness/branch, transactional ROLLBACK)

- **`has_contacts_permission`:** Admin→true(all keys); agent no-block→catalog defaults (delete=false, view_assigned=true, import=false, view_unassigned=false); agent stored override wins (both true→false and false→true); TL defaults (import=true, view_unassigned=true); unknown key→false; no-uid/anon→false; cross-org (uid∉org)→false; SA home-org→true.
- **`_contacts_permission_default`** (via SET ROLE postgres): spot-check keys vs the TS catalog; unknown→false.
- **`delete_contact`:** agent w/o perm→`permission_denied` + row remains; agent w/ perm + own lead→deleted; agent w/ perm + peer's lead→`not_authorized` + remains; TL w/ perm + downline→deleted, non-downline→`not_authorized`; Admin→any in org; cross-org→`cross_org`; not_found→`{deleted:false}`; invalid type→`invalid_contact_type`; **telemetry: a deleted lead's `calls` row survives with `lead_id` NULL; `campaign_leads` row survives**.
- **`leads_select_unassigned_pool`:** agent w/o perm cannot SELECT an unassigned org lead; agent w/ perm CAN; cross-org unassigned still hidden; assigned leads unaffected; UPDATE/DELETE on unassigned still denied for the agent.
- **ACLs:** `has_contacts_permission`/`delete_contact` → anon ✗, authenticated ✓, service_role ✓; `_contacts_permission_default` → owner-only.

## 22. Harness / branch validation plan

Project replay debt persists (fresh branch = `MIGRATIONS_FAILED`). Two options for CP3B validation:
- **(A, preferred, needs cost approval)** ONE temporary Supabase dev branch (Build 3/4 precedent, ~$0.013/hr, created→validate→**deleted**): build a faithful minimal harness (real `get_org_id`/`is_ancestor_of`/`profiles`/`role_permissions`/`leads`/`clients`/`recruits` + the four contacts helpers verbatim), apply the draft migration, run §21, capture advisors + EXPLAIN, delete the branch.
- **(B, no cost)** local Supabase stack harness if available.
**Production is never the first DB to run the new SQL.** `#APPROVE_SUPABASE_BRANCH_COST` requested before option A.

## 23. Files likely to touch in CP3B

- **New migration** `supabase/migrations/<ts>_contacts_permissions_enforcement.sql` (§12–§15).
- (Optional, separate) `supabase/migrations/<ts>_contacts_permissions_hardening.sql` (§20).
- `src/lib/supabase-contacts.ts` / `supabase-clients.ts` / `supabase-recruits.ts` — route `delete` through `delete_contact` RPC.
- `src/integrations/supabase/types.ts` — regen post-apply; drop any temp casts.
- `src/pages/Contacts.tsx` / `useContactScope` — surface unassigned-pool visibility for `view_unassigned` (or defer); `view_all` toggle note (§16).
- `supabase/tests/contacts_permissions_integration.sql` (authored as a draft at CP3B).
- `implementation_plan.md` + `WORK_LOG.md`.

## 24. Risks / rollback (CP3B)

| Risk | Mitigation / rollback |
|---|---|
| RLS policy broadens visibility incorrectly | Additive PERMISSIVE SELECT, tightly scoped (org + both-null + permission); harness §21 proves cross-org still hidden + no UPDATE/DELETE broadening. Rollback: `DROP POLICY leads_select_unassigned_pool`. |
| `delete_contact` DEFINER bypasses tenant/ownership | Org + ownership mirrored in-function; cross_org raises; harness tests peer/cross-org denial. Rollback: `DROP FUNCTION` + revert frontend to direct delete. |
| `has_contacts_permission` perf in RLS | Single-row indexed lookups, STABLE; EXPLAIN on harness. Inert if unused. Rollback: `DROP FUNCTION` (after policy/RPC dropped). |
| `view_all` inert toggle (CP2) | Defer + UI note (§16). |
| Conversion/add-to-campaign/import unchanged | Documented as intentional (§17–§19). |
| Branch replay debt | Faithful harness (option A/B), prod never first. |

## 25. Approvals needed before CP3B

1. **`#APPROVE_RLS_CHANGE`** — required for the unassigned-lead SELECT policy (§15).
2. **`#APPROVE_SUPABASE_BRANCH_COST`** — required if validating on a temporary dev branch (§22, option A).
3. **Delete model:** confirm **hard-delete parity** (recommended) vs. archive/deactivate (future).
4. **`view_all`:** defer + UI note (recommended) vs. implement now (§16).
5. **Add-to-Campaign:** leave frontend-gated (recommended) vs. add server check (§17).
6. **Least-privilege hardening:** separate migration now (safe items only) vs. defer (§20).

## 26. CP3A process gate

Design + draft SQL only. **No migration authored on disk, no SQL applied, no DDL on prod, no data mutation, no RLS change in prod, no Supabase branch created, nothing committed/pushed/PR'd/merged/deployed. Conversion/add-to-campaign/import/queue/Twilio untouched. Build 5 not shipped; Build 6 not started.** Awaiting the §25 approvals before CP3B.

---

# CHECKPOINT 3B — Backend enforcement implemented + validated on a non-production branch (2026-06-25)

**Approvals consumed:** `#APPROVE_RLS_CHANGE` (additive read-only `view_unassigned` + `view_all` SELECT policies only); `#APPROVE_SUPABASE_BRANCH_COST` (one temp branch @ **$0.01344/hr** — identical to the prior range, so no material difference; created → validated → **deleted**). `view_all` implemented now (not deferred), per Chris's CP3A change.

**Migration file:** `supabase/migrations/20260624120000_contacts_permissions_enforcement.sql` (NOT applied to prod) — SHA-256 **`a77168c3a66b888d0bf3d73eb96ca2fb75dfe8a4e07ea582529702ca1afedccd`**.

## 27. What CP3B implemented

### Migration (branch-validated; prod-apply is CP3C)
- `public._contacts_permission_default(text,text)` — IMMUTABLE, `search_path=public,pg_temp`, **owner-only** (`REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` — the explicit role revoke was required because Supabase default-privileges grant EXECUTE to anon/authenticated; `REVOKE FROM PUBLIC` alone left them callable — **caught + fixed during branch validation**). 25-key map; **parity-checked against `CONTACTS_PERMISSIONS` — exact match (25/25)**.
- `public.has_contacts_permission(text)` — STABLE SECURITY DEFINER, `search_path=public,pg_temp`, anon✗/authenticated✓/service_role✓; uid+org server-derived; Admin/SA(home-org) full; stored→default fallback; unknown→false.
- `public.delete_contact(text,uuid)` — SECURITY DEFINER, anon✗/authenticated✓/service_role✓; permission capability + same-org + owner/downline/admin scope; **hard-delete parity** (lead branch removes `campaign_leads` first then the lead — exactly matching the prior `leadsSupabaseApi.delete`; telemetry `calls` preserved via ON DELETE SET NULL).
- Additive PERMISSIVE SELECT policies `leads_select_unassigned_pool` (view_unassigned) + `leads_select_view_all_pool` (view_all) — OR with the untouched hierarchical ALL policy; SELECT-only (never broaden UPDATE/DELETE); never cross-org.
- `_contacts_filtered_leads` — reproduced verbatim + ONE additive `unassigned` scope branch (org + `user_id IS NULL` + `assigned_agent_id IS NULL`); all other clauses unchanged → `search_contacts_leads` / `get_contacts_lead_kanban` contract intact.
- `NOTIFY pgrst, 'reload schema'`.

### Frontend
- `supabase-contacts.ts` / `supabase-clients.ts` / `supabase-recruits.ts` — `delete()` now calls `delete_contact` RPC (narrow `(supabase as any)` cast until CP3C type regen; lead path no longer deletes `campaign_leads` client-side — server-side now).
- Scope wiring (**D-scope-model**): `ContactScope` += `"unassigned"`; `scopeLabel`/`ContactScopeSelector` get an "Unassigned" entry; `resolveOwnerAgentIds` treats `unassigned` as self for Clients/Recruits (Leads-only scope, never widens). `useContactScope.computeAvailableScopes` now driven by the catalog keys (mine always; team if downline; `unassigned` if `view_unassigned`; `agency` if `view_all`) — superseding the legacy Data-Access pill; persistence accepts `unassigned`. `Contacts.tsx` filters `unassigned` off non-Leads tabs + resets it on tab-away.
- Tests: `contactScope.test.ts` updated for the new signature + `unassigned`/`view_all`/`view_unassigned` cases.

## 28. Non-production branch validation (branch `contacts-build5-perms-test`, ref `nhvvyozbugjxjfqrreiv` — DELETED)
Replay debt persists (branch `MIGRATIONS_FAILED`, like `main`), so a **faithful minimal harness** was built (real `get_org_id`/`get_user_role`/`is_super_admin`/`super_admin_own_org`/`is_ancestor_of` + prod-typed `organizations`/`profiles`/`role_permissions`/`leads`/`clients`/`recruits`/`campaign_leads`/`calls` + the real leads/clients/recruits hierarchical ALL policies + RLS). Migration applied → `{success:true}`.

**Integration tests — ALL PASS** (`supabase/tests/contacts_permissions_integration.sql`, MCP-executable form):
- **T1 has_contacts_permission:** anon✗; Agent defaults (view_assigned✓/delete✗/view_unassigned✗/unknown✗/create✓); TL defaults (view_unassigned✓/import✓/delete✗); Admin✓; Super-Admin home-org✓; cross-org✗; stored true/false override wins; missing key→default.
- **T2 delete_contact:** deny-without-perm + row remains; invalid type rejected; peer-owned→not_authorized + remains; owner deletes own→`deleted:true` **and the telemetry `calls` row survived with `lead_id` SET NULL**; cross-org→blocked + remains; not-found→`deleted:false`; TL deletes downline; Admin deletes any org lead.
- **T3 RLS policies:** view_unassigned off→hidden, on→visible, cross-org hidden, **UPDATE not broadened (0 rows)**; view_all off→hidden, on→visible, cross-org hidden, **DELETE not broadened (0 rows)**.
- **T4:** `_contacts_filtered_leads('{"scope":"unassigned"}')` returns exactly the org-pool lead.

**ACL posture (branch):** has_contacts_permission + delete_contact = DEFINER, search_path set, anon✗/authenticated✓/service_role✓; `_contacts_permission_default` = owner-only (anon✗/auth✗/svc✗) after the revoke fix; `_contacts_filtered_leads` = INVOKER, STABLE, search_path set.

**Advisors — migration-attributable:** Security = **2 WARN** (`authenticated_security_definer_function_executable` on has_contacts_permission + delete_contact) — intentional RPC pattern, mirrors prod's `convert_lead_to_client_atomic`/`undo_contact_import`; my functions absent from `function_search_path_mutable` + `anon_security_definer_function_executable`. Performance = **1 WARN** (`multiple_permissive_policies` on leads SELECT — the expected, accepted cost of the additive-policy design). All other advisor lints (rls_disabled on harness tables, extension_in_public ltree, rls_policy_always_true on harness clients/recruits, search-path on get_user_role/is_super_admin/the convert stub, unindexed FKs, auth_rls_initplan on the pre-existing hierarchical policies) are **harness artifacts or pre-existing prod findings**, not introduced by this migration.

**EXPLAIN:** leads SELECT under the 3 OR'd policies = Seq Scan + filter, ~1.4 ms on the harness; `has_contacts_permission('const')` is a constant-arg STABLE call (no per-row explosion).

**Branch deleted; billing stopped** (confirmed absent from `list_branches`). No production mutation.

## 29. Repo verification (post-CP3B)
`npx tsc --noEmit` clean · `npx vitest run` **331/331** · targeted ESLint **0 errors** (benign pre-existing unused-disable + exhaustive-deps warnings only; my delete lines add none) · `git diff --check` clean.

## 30. CP3C production-apply recommendation
Apply `20260624120000_contacts_permissions_enforcement.sql` (SHA `a77168c3…`) to prod via MCP `apply_migration` with a pre-apply guard (migration not recorded; the 3 functions/2 policies absent; `_contacts_filtered_leads` body diff = ONLY the added `unassigned` branch). Post-apply: ACL/security verification, advisor delta (expect only the 2 intentional DEFINER WARNs + the multiple-permissive-policies WARN), read-only parity (existing scopes unchanged; `unassigned` scope returns the pool), regenerate `types.ts` + drop the narrow `delete_contact` casts. Then CP4 (PR) → CP5 (deploy + smoke + WORK_LOG shipped). **Frontend is NOT deployed until after the migration is live in prod** (the `delete_contact` RPC + the new scopes must exist first).

## 31. Deferred / tracked separately (unchanged)
Add-to-Campaign backend parity (Campaigns module); dedicated import RPC (import closeout); least-privilege hardening migration (lead-source anon-revoke + `pg_temp`, `get_user_role`/`is_super_admin` search_path); conversion RPC (audited — no change needed). `view_all` UI: the catalog toggle now has real backend enforcement (no longer inert).

## 32. CP3B process gate
Backend enforcement implemented on-branch + validated on a deleted temporary dev branch. **Migration NOT applied to production; no production data mutated; no deploy; nothing committed/pushed/PR'd/merged. Conversion/add-to-campaign/import/queue/Twilio/Build-4-Kanban-contract untouched. Build 5 not shipped; Build 6 not started.** Awaiting CP3C production-apply approval.

---

# CHECKPOINT 3C — Backend enforcement APPLIED to production; frontend NOT deployed (2026-06-25)

**Applied to prod** (`jncvvsvckxhqgqvkppmj`) via MCP `apply_migration` name `contacts_permissions_enforcement` → `{success:true}`. **Recorded MCP version `20260625162731`** (on-disk file `supabase/migrations/20260624120000_contacts_permissions_enforcement.sql`, SHA-256 **`a77168c3a66b888d0bf3d73eb96ca2fb75dfe8a4e07ea582529702ca1afedccd`** — same dual-version pattern as Builds 3/4). **No production data mutated** (schema/functions/policies only).

**Pre-apply guard (all passed):** branch `claude/contacts-build5-permissions-cp2`; file SHA exact; migration not previously recorded; the 3 functions + 2 policies absent; current `_contacts_filtered_leads` had no `unassigned` branch; content scope clean (no Twilio/queue/conversion/import-undo/campaign_leads-policy/mutation-policy/anon-grant/hardening — the only `campaign_leads` reference is the approved DELETE inside `delete_contact`).

**Post-apply verification (read-only):**
- **Functions:** `_contacts_permission_default` = INVOKER/IMMUTABLE/`search_path=public,pg_temp`/owner postgres/**anon✗ auth✗ svc✗ (owner-only)**; `has_contacts_permission` = **DEFINER/STABLE**/search_path/**anon✗ auth✓ svc✓**; `delete_contact` = **DEFINER**/volatile/search_path/**anon✗ auth✓ svc✓**.
- **Policies:** leads policy count 1→**3**; `leads_select_unassigned_pool` + `leads_select_view_all_pool` both **SELECT + PERMISSIVE + authenticated**, quals `organization_id = get_org_id() AND … AND has_contacts_permission('…')` (unassigned also `user_id IS NULL AND assigned_agent_id IS NULL`). SELECT-only → cannot broaden UPDATE/DELETE.
- **`_contacts_filtered_leads`** now contains the additive `unassigned` branch.
- **No data change:** leads 517 / clients 0 / recruits 0 (unchanged).

**Permission behavior (real prod profiles, GUC simulated read-only, reset after):** Agent defaults (view_assigned✓/delete✗/view_unassigned✗/view_all✗/unknown✗); Team Leader (view_unassigned✓/import✓/delete✗); Admin✓; Super-Admin home-org✓; cross-org✗.

**Leads visibility (as `authenticated`, real prod data):** default **Agent → 0 unassigned visible** and **0 via `unassigned` scope** (hidden, as designed); **Admin → 517 total + 517 `agency` scope** (existing behavior unchanged; Build 4 list/Kanban total preserved) **+ 507 via `unassigned` scope** (the on-path, proven on real prod data — Admin has view_unassigned via full access). Both new policies are `FOR SELECT` only → no UPDATE/DELETE broadening.

**`delete_contact`:** verified by introspection only (DEFINER, anon✗/auth✓/svc✓, validated body with permission + org + ownership/downline/admin + cross-org guards). **NOT invoked on prod** (destructive — no prod test records created/deleted).

**Advisor delta — migration-attributable:** Security = **2 WARN** (`authenticated_security_definer_function_executable` on `has_contacts_permission` + `delete_contact` — intentional RPC pattern; mirrors prod `convert_lead_to_client_atomic`); **no new ERROR** (still 2 pre-existing: `app_config` + `webhook_debug_log` `rls_disabled_in_public`). Performance = **1 WARN** (`multiple_permissive_policies` on leads SELECT — the expected additive-policy trade-off); **0 ERROR**. My functions absent from `function_search_path_mutable`/`anon_security_definer`/`auth_rls_initplan`.

**Generated types:** `src/integrations/supabase/types.ts` regenerated from prod — diff **+9 lines / 0 removed** (exactly `_contacts_permission_default`, `delete_contact` (`Args:{p_contact_id,p_contact_type}`, `Returns: Json`), `has_contacts_permission` (`Args:{p_key}`, `Returns: boolean`); no unrelated drift). Removed the narrow `(supabase as any)` casts from the 3 `delete()` methods → typed `supabase.rpc("delete_contact", …)`.

**Repo (post-CP3C):** `tsc` clean · `vitest` **331/331** · targeted ESLint **0 errors** · `git diff --check` clean.

**CP3C gate:** Migration **live in prod**; **frontend NOT deployed** (the new `delete_contact` RPC + `view_unassigned`/`view_all`/`unassigned`-scope UI reachable only from the un-deployed Build 5 frontend; existing paths unaffected — additive policies/functions are inert for users without the permissions, and default-off keeps current behavior). **Nothing committed/pushed/PR'd/merged/deployed; Build 5 not shipped; Build 6 not started.** Next: **CP4** (commit Build-5 files → PR) → **CP5** (merge → Vercel deploy → smoke → WORK_LOG shipped).
