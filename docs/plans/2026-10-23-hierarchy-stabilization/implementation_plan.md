# Hierarchy Stabilization — upline_id authoritative, repaired paths, safe Team Leader authority

**Status (2026-10-23): GATE 1 APPROVED (rev 3) — development and testing only.** Chris approved Gate 1 with the
recommended D1–D15 defaults and two mandatory corrections (§R). Gate 1 does **not** authorize a merge, deployment,
migration apply, production data change or production RLS change; each production gate below still needs its own
explicit approval, and the four-row repair fingerprint is preserved.

**Rev 2 status (superseded):** PLAN ONLY — awaiting Chris's explicit approval. No source file, migration, RLS
policy, function, Edge Function, deployment or production row has been changed. Every production contact was a
read-only `SELECT` against `jncvvsvckxhqgqvkppmj` (catalog, aggregates, 8-character id prefixes). Throwaway local
PostgreSQL 16 clusters in the session scratchpad reproduced the defects and proved the design; they were stopped and
held no production data.

Rev 2 folds in an independent four-lens review (security, migration engineering, brief compliance, frontend), which
found and fixed: a TL reassign-then-delete bypass of D5; ltree operators failing at runtime under a
`pg_catalog, pg_temp` search_path; the true width of TL downline call UPDATE; a TL "Delete User" partial book transfer
after activation; M2 being able to activate authority before M3; and several test and file-list gaps.

Branch `claude/intelligent-lamport-r6hnx7` (from `main` `f03af3b`). Gates — each needs its own explicit approval:

| Gate | Authorizes | Production effect |
|---|---|---|
| **1** ✅ approved | Implementation on this branch: migration + rollback files, test harness + CI workflow, frontend, docs, local/CI verification, independent security review, full regression, one **draft PR** | none |
| **2a** | `apply_migration` **M1** (authorization boundaries) — `#APPROVE_RLS_CHANGE` | narrowing only; 0 rows change visibility today |
| **3** | Merge the PR and release the frontend (M2 and M3 stay in `migrations/pending/`, unapplied) | UI only; frontend safety protections live **before** any hierarchy activation path exists |
| **2b** | `apply_migration` **M2** (integrity triggers + guards) | no row written; from now on real upline edits / TL invites derive correct paths (§6.2) |
| **2c** | `apply_migration` **M3** (fingerprint-bound repair) — `#APPROVE_RLS_CHANGE` + invariant #28 checklist | **activates TL `f809493e`'s downline authority** (§4) |

Order (correction R2): **1 → 2a (M1) → 3 (frontend) → 2b (M2) → 2c (M3)**, conditional on the frontend ↔ database
compatibility suite (§8) passing for every state the release passes through. If it does not, the fallback is the
explicit activation guard in §R.

---

## R. Gate 1 corrections (mandatory, from Chris's approval)

**R1 — Close the stale-JWT role mismatch in hierarchy authorization.** The TL branches of 9 policies key on the JWT
role (`get_user_role()` = `app_metadata.role`), which survives a promotion, demotion or deactivation until the token
refreshes. Every hierarchy authorization decision becomes database-authoritative where it matters:
- `is_ancestor_of` grants strict ancestry only when the **ancestor's profile** (not the JWT) is `Active` and has role
  `Team Leader`, `Admin` or `Super Admin` (or `is_super_admin`). Combined with the policies' existing JWT role check,
  a TL branch now needs **both** the token and the database to say Team Leader: a demoted TL (DB `Agent`) with an old
  TL token gets no downline rows, a deactivated/deleted TL gets none, and a just-promoted TL with an old Agent token
  fails closed until the token refreshes. Agents never carry hierarchy authority (production: 0 Agent uplines).
- The new RESTRICTIVE contact-delete policies decide "is this a Team Leader" from the database through
  `profile_authz.actor_is_team_leader()` (`profile_authz` is the existing policy-helper schema; `authenticated` has
  USAGE, not on `private`).
- The new calls DELETE and UPDATE guards decide from the database: on a call row owned by someone else, only an
  actor whose **profile** is Admin/Super Admin of that org or `is_super_admin` may delete it or edit anything beyond
  `flagged_for_coaching` / `notes`. So a demoted TL — or any stale elevated token — cannot edit or delete downline
  calls, even through a direct API write.
- `tasks_select_team_leader` (TO public, inline ltree test, no status check) is recreated under the same name **TO
  authenticated**, using `is_ancestor_of(auth.uid(), assigned_to)` with the viewer's DB role check kept — narrowing
  only (0 rows today); TO authenticated is required because anon keeps table SELECT on `tasks` and loses EXECUTE on
  `is_ancestor_of`.
- Already database-authoritative and unchanged: `can_update_profile`, `enforce_profile_field_authorization`, the
  `commission_level` guard, `private.campaign_actor()` (10 TL-capable functions: DB role, Active, org match).
- Tests (§8): promotion, demotion, deactivation (Inactive and Deleted) and forged/stale-token direct API writes
  (PostgREST with minted tokens whose role/org claims disagree with the database), per module.

**R2 — Frontend safety protections live before M2 can activate hierarchy access.** Order M1 → frontend → M2 → M3.
M2 also stays in `migrations/pending/` until its own gate, so the merged `main` contains only applied migrations.
A compatibility suite runs the **real frontend data-layer modules** (supabase-js against local PostgREST) on every
database state the release passes through — S0 baseline, S1 M1, S2 M1+M2, S3 M1+M2+M3 — plus the rollback states.
**Fallback if compatibility fails:** M2 ships with a database activation guard (`private.hierarchy_activation`
single-row flag, default off) under which the new triggers keep paths frozen except through the reviewed repair; it
is switched on only at Gate 2c. Not built unless needed.

## 0. Sources read and conflict check (2026-10-23)

- `AGENT_RULES.md`: §3 (incl. "Downline profile scoping is query-enforced, not RLS-enforced"), invariants #6, #8, #20,
  #25, #26 ("Known fail-closed behaviour"), #28, #29, #30, #34, #37, #38, Phase 2A / Commissions sections, §7, §8, §9,
  §10, Known Tech Debt "🚨 Team Leader hierarchy predicate is unreliable". `VISION.md`. `WORK_LOG.md` newest entries.
- **Open PRs (14):** docs/release records and unrelated features (#481, #480, #478, #461, #444, #441, #429, #425,
  #398, #383, #382, #381, #378, #294). None touches hierarchy, profiles triggers, User Management or the files below.
- **Production migration head:** `20261022062539` (343 rows); re-checked before each Gate 2 step.
- **Repo vs live drift (hierarchy objects):** none — `md5(pg_get_functiondef)`, owner, definer flag, `proconfig` and
  ACL of all hierarchy functions and the 8 profiles triggers equal the repo (baseline `20260806000000`;
  `20260919183544` for `resolve_downline_ids`). PG16.15 reproduces production PG17.6 digests under the same pinned
  search_path, so preimage guards are testable locally.

## 1. Verified baseline (re-checked 2026-10-23, read-only)

| Measure | Value |
|---|---|
| Profiles / organizations | 16 / 6 (4 with profiles) |
| Direct upline relationships | 11 |
| Direct relationships `is_ancestor_of` does not recognise | 4 |
| Expected ancestor pairs (upline walk) / missing / extra | 15 / **6** / 0 |
| Stored `hierarchy_path` ≠ canonical | **4** — `4ef505e0`, `5f952f0d`, `89f2e994`, `e5c4ee04`; fingerprint `md5(sorted ids) = ddc1f53f3823c6e367310a748ea0ac85` |
| Cross-org edges / missing parents / self-parents / cycles | 0 / 0 / 0 / 0 |
| Longest reporting chain | 3 profiles |
| PostgreSQL / ltree | 17.6 / 1.3 in schema `public` |

All 4 stale rows are in org `a0000000…`: Admin `ecf2bb91` → TL `f809493e` (Active, 1 live session) → `4ef505e0`,
`e5c4ee04` (Active), `89f2e994` (Deleted, **not banned, 1 live session**); Admin → TL `86ca95f2` (Deleted, banned) →
`5f952f0d` (Deleted, banned). The 7 direct Admin → member edges are correct.

### Root cause (reproduced with the verbatim live objects; production counts reproduced exactly)

1. `trg_update_hierarchy_path` (BEFORE INSERT OR UPDATE OF `upline_id`) sets
   `NEW.hierarchy_path := compute_hierarchy_path(NEW.id)`, which walks `upline_id` from the **stored** row: INSERT →
   self-only path (`89f2e994`, invited under the TL); UPDATE → path of the **previous** upline (`4ef505e0`, `e5c4ee04`,
   moved Admin → TL, still `ecf2bb91.<self>`).
2. `cascade_hierarchy_update()` refreshes **direct children only**; its `SET hierarchy_path` never re-fires the
   `UPDATE OF upline_id` triggers, so grandchildren stay stale and a moved TL can lose ancestry over its own children.
3. Fail-open on reassignment: after TL1 → TL2 (or "None"), `is_ancestor_of(TL1, agent)` stays true (latent today).
4. No self-parent / cycle / cross-org guard (all reproduced, incl. a same-org Admin setting a cross-org upline over
   PostgREST); `compute_hierarchy_path` silently truncates chains at 20 levels.

### ⚠ Live risk — the Team Leader branches are one ordinary Save away from turning on

`UPDATE OF upline_id` triggers fire whenever the column is **in the SET list**. `UserProfileModal` always sends it
(`UserProfileModal.tsx:117` → `supabase-users.ts:411`), so an Admin saving TL `f809493e` — or **the TL saving their
own profile** — repairs the TL's children as `postgres` and switches on every TL branch in §4 without review. It
happened on 2026-10-17 20:35:13 UTC (4 children of `ecf2bb91` healed in one transaction; 3/11 → 7/11 correct edges).

**Interim (D14):** until Gate 2c, avoid saving `f809493e`, `4ef505e0`, `e5c4ee04` or `89f2e994` in User Management;
after 2b also avoid real reassignments in `f809493e`'s branch and TL invitations by `f809493e` (both now derive
correct paths and would activate authority before the reviewed repair). M2's no-op guard removes the "ordinary save"
trigger entirely.

## 2. Inventory — everything that depends on the hierarchy

**RLS (27 policies + 1 inherited; all PERMISSIVE today; none references `upline_id`):**

| Group | Policies | Hierarchy branch |
|---|---|---|
| `is_ancestor_of` direct (9) | `calls` Hierarchical Select/Insert/Update/Delete; `clients`, `leads`, `recruits` Hierarchical Access (**FOR ALL**); `contact_emails_select`; `profiles_select_hierarchical` | `role IN (Team Leader[, Team Lead]) AND organization_id = get_org_id() AND is_ancestor_of(auth.uid(), owner)` |
| raw `hierarchy_path` (1) | `tasks_select_team_leader` (TO public) | `subject.hierarchy_path <@ viewer.hierarchy_path` |
| via helper (17) | `profiles_update_authorized` → `profile_authz.can_update_profile`; 16 `policy_commission_*` → `policy_commission_authz.access` | TL branch = `is_ancestor_of`; commission reads also need "View Others' Commission Percentage" |
| inherited (1) | `contact_history_events_select` → `contact_history_event_visible` (invoker) | inherits leads/clients/recruits/tasks RLS |

Every hierarchy branch is ANDed with a same-org guard and a role check; every consumer checks owner/self first.

**Functions:** 29 mention a hierarchy primitive. **17 call `is_ancestor_of` directly**, all passing the caller as the
ancestor (`auth.uid()`, or `private.campaign_actor()` which also requires an Active actor): `_contacts_filtered_leads`,
`get_contact_scope_agents`, `private.performance_scope`, `_import_undo_context`, `convert_lead_to_client_atomic`,
`delete_contact`, `profile_authz.can_update_profile`, `private.can_administer_campaign`, `private.assert_may_assign_to`,
`notify_win`, `private.can_authorize_campaign_lead`, `create_client_with_sale`, `convert_lead_to_client_with_sales`,
`update_client_with_policy_sale`, `record_client_policy`, `policy_commission_authz.access`,
`update_client_with_policy_sale_handoff`. Depth-2 dependents include kanban / bulk-select, import finalize, campaign
attach and the performance RPCs. **Reports** (`report_access_v2`, `get_profile_book_stats`,
`get_profile_team_readiness`) use `private.resolve_downline_ids` — **unaffected**.

**Exposure:** `compute_hierarchy_path(uuid)` and `is_ancestor_of(uuid,uuid)` are `SECURITY DEFINER` in `public` with
EXECUTE for PUBLIC/anon/authenticated — anyone with the anon key and a profile UUID can read its upline chain or test
ancestry across orgs over `/rest/v1/rpc`. No client has called either since 2026-09-26. Only `authenticated` needs
`is_ancestor_of` (RLS runs as the invoker; 2 invoker RPCs). No TO-public policy, view or matview references either.

**Frontend profile query paths:** 107 `.from('profiles')` call sites (94 SELECT: 63 org-filtered, 31 RLS-only and
org-bounded by `profiles_select_org`; 13 UPDATE). Hierarchy scopers get code changes (§6.4); RLS-only, org-bounded
name/roster reads are accepted with explicit org filters added where §6.4 touches them; the rest are recorded (§12).

## 3. Design summary

1. **`profiles.upline_id` is the only authority**; `hierarchy_path` is a derived cache the database keeps equal to
   the canonical chain (same root-first `-`→`_` format, so `is_ancestor_of`, the GiST index and the tasks policy work
   unchanged).
2. **Derivation from the incoming row**: a builder walks from `NEW.upline_id`, org-checked at every ancestor,
   cycle-safe, capped at 100 levels (= `resolve_downline_ids` / `getAgentScopeIds`).
3. **Whole-subtree refresh** in one set-based statement when an upline really changes; **no-op saves change nothing**.
4. **Structural guards**: no self-parent, cycle, cross-org upline/ancestor, or org change stranding downline;
   invitations need an Active same-org upline.
5. **Authorization boundaries before activation** (M1) so the repair grants nothing beyond the existing Contacts
   toggles, commission toggles and role boundaries.
6. **Controlled activation** by a fingerprint-bound, idempotent repair (M3) after M1, M2 and the frontend.
7. Deleted intermediates keep passing authority through (paths include them), as in the canonical resolver.

## 4. Effective authorization change of the repair (policy text unchanged)

Repair adds exactly 6 ancestor pairs, removes none: `f809493e→{4ef505e0, e5c4ee04, 89f2e994}`,
`ecf2bb91→{89f2e994, 5f952f0d}`, `86ca95f2→5f952f0d` (Deleted, banned; with D3 also inert in the database).

**Team Leader `f809493e`** (counts re-measured in the Gate 2c preflight):

| Module | Today | Repair, policy text unchanged | Repair **with M1** (recommended) |
|---|---|---|---|
| Leads | 61 visible (8 own + 53 imported unassigned pool) | +132 (85 + 47) SELECT / INSERT / UPDATE / **DELETE** | +132 SELECT / INSERT / UPDATE. TL direct DELETE (own rows included) only with `contacts.leads.delete` (default **off**) — same rule as `delete_contact` |
| Clients | 0 | +10 (9 + 1), same FOR ALL | +10 SELECT / INSERT / UPDATE; DELETE only with `contacts.clients.delete` |
| Recruits / tasks / contact_emails | — | +0 rows | +0 rows |
| Calls | 514 (324 own + 190 inbound-unassigned) | +4,590 SELECT; UPDATE of `created_at`, `started_at`, `ended_at`, `status`, `outcome`, `is_missed`/`missed_*`, `recording_url`, `recording_storage_path`, `transcript`, `notes`, `flagged_for_coaching` (Reports count by `created_at`); **DELETE** (cascades voicemails, inbound_route_attempts; nulls `wins.call_id`). INSERT for downline already blocked by `calls_guard_dialer_core` | +4,590 SELECT; UPDATE **only `flagged_for_coaching` and `notes`** (CallRecordingLibrary coaching); **no DELETE** |
| Contact history | — | +86 events | +86 events |
| Profiles UPDATE | self | 3 downline rows incl. **`commission_level`**, email, phone, NPN, licences (UV sync fires on name/email/phone/NPN/avatar) | 3 downline rows as designed since 2026-03, but **an existing downline's `commission_level` cannot change** (Admin-only); account-control fields stay Admin-only (unchanged) |
| Profiles SELECT | whole org | unchanged | unchanged |
| Contacts Team scope / assignable lists (`get_contact_scope_agents`) | self only | self + `4ef505e0` + `e5c4ee04` | same |
| Dashboard team (`performance_scope`) | self | self + 3 (incl. Deleted `89f2e994`, 0 activity) | same |
| Sale writers, conversion, `notify_win`, campaign/import branches | own | downline leads & clients (0 campaigns, 0 imports today) | same |
| `delete_contact` / `undo_contact_import` | own | downline; delete honours the toggle; team import undo honours `contacts.leads.undo_team_import` (TL default on, 24 h, by design) | same |
| Commission rows | none | none — "View Others' Commission Percentage" **off** for TLs in `a0000000` (46 rows open only if an Admin enables it: Phase 2A design) | same; no new commission permission |
| Reports (`report_access_v2`) | self + `4ef505e0` + `e5c4ee04` | **unchanged** | unchanged |
| CampaignDetail TL filter (display) | own + unclaimed | — | after F7: also downline-claimed rows already in the payload (`campaign_leads_select` gives TLs all org campaign leads) |

Also: Admin `ecf2bb91`'s Leads "Team" filter gains Deleted `5f952f0d`'s 3 leads (`_contacts_filtered_leads` has no
role check); visibility unchanged (Admin already sees them under Agency). Contacts **view / edit / assign** toggles
stay UI-enforced for TL downline rows exactly as for own rows (TL defaults are on, so no change today; §12). Org
totals: 8,153 calls, 2,037 leads, 22 clients. No access is withdrawn from any current user.

## 5. Decisions for Chris (recommended defaults ★)

Reply "approve Gate 1 with the recommended defaults" or name any change.

| # | Decision | ★ Recommended | Alternatives |
|---|---|---|---|
| D1 | Canonical TL resolver | ★ Path-based `is_ancestor_of` (GiST-indexed, 27 policies) with `hierarchy_path` **kept correct by the database**; Reports keep `resolve_downline_ids`; parity tests pin the two | Per-row upline walk in `is_ancestor_of` (slower in RLS; tasks policy still reads paths) |
| D2 | `is_ancestor_of` semantics | ★ Same signature (9 policies depend on it). Add: same org for ancestor and descendant; **ancestor must be the caller** (`auth.uid() IS NULL OR ancestor_id = auth.uid()` — all 17 callers and 9 policies already pass the caller; closes the cross-org oracle for signed-in users). Self stays true; Deleted descendants stay included | Also exclude Deleted descendants (matches Reports; hides orphaned books) |
| D3 | Deleted / Inactive / demoted TLs (R1) | ★ Strict ancestry needs the ancestor's **profile** to be `Active` with role Team Leader / Admin / Super Admin or `is_super_admin`. Closes stale tokens after deactivation, deletion or demotion for the 9 policies, the tasks policy and the 7 non-`campaign_actor` functions; 0 effect today | Rely on token refresh / banning |
| D4 | TL edits of downline profiles (designed since 2026-03, dormant) | ★ Keep the TL branch. Additive trigger: **changing** another member's `commission_level` requires Admin/Super Admin of that org or `is_super_admin`, read from the actor's profile (fires `WHEN (OLD IS DISTINCT FROM NEW)`, so unchanged-value saves pass). UI mirrors all account-control fields (F6) | (b) TL self-only; (c) restore everything as designed |
| D5 | Contacts DELETE by TLs | ★ RESTRICTIVE DELETE policies on `leads`/`clients`/`recruits`: an actor whose **profile** is Team Leader (R1) needs `has_contacts_permission('contacts.<type>.delete')` for any direct delete (own rows included) — exactly `delete_contact`'s rule; closes reassign-to-self-then-delete. UI already hides delete without the toggle. Admin/Agent unchanged | Accept the bypass; or enforce for every role (wider change, out of scope) |
| D6 | Writes on other agents' call rows | ★ RESTRICTIVE DELETE on `calls`: own rows, or an actor whose **profile** is Admin/Super Admin of the org or `is_super_admin`. BEFORE UPDATE guard: on another agent's call, a non-admin **profile** may change only `flagged_for_coaching` and `notes` (direct client writes only; definer RPCs, webhooks and real Admins unaffected). Covers TLs and any stale elevated token (R1) | Restore the designed UPDATE/DELETE |
| D7 | Commission design | ★ No change. Confirm: TL + "View Others' Commission Percentage" = read downline commission rows; a TL-recorded downline sale captures with read access (Phase 2A). Note: `profiles.commission_level` itself is readable org-wide regardless of the toggle (§12) | Close the TL commission branch (a commission-permission change) |
| D8 | Upline rules | ★ Database enforces structure (self, cycle, cross-org, depth 100, org change stranding downline). Status/role rules are UI-only (pickers: Active Admin/TL, same org, excluding self + descendants). Invitations: database requires an **Active same-org upline** on INSERT or upline/org change | Enforce role/status for profiles too (breaks TL demotion / soft-delete flows that leave children in place) |
| D9 | Repair packaging | ★ M3 separate, in `migrations/pending/` until 2c; refuses unless the live stale set's fingerprint equals the reviewed one (`ddc1f53f…`), no-op when nothing is stale; repairs all 4 incl. the 2 Deleted rows; accepts 4 `updated_at` bumps and 8 unchanged-value `set_claim` writes | Repair inside M2; exclude Deleted rows |
| D10 | Grants & hygiene | ★ REVOKE `compute_hierarchy_path` from PUBLIC/anon/authenticated; `is_ancestor_of` from PUBLIC/anon; trigger functions from PUBLIC/anon/authenticated; `SET search_path` on `on_profile_update` (body unchanged) | Separate security change |
| D11 | Concurrency | ★ Proven design: statement-level transaction advisory lock + `FOR SHARE` ancestor walk (concurrent 2-cycle rejected under READ COMMITTED, 40001 under RR). Accept: all hierarchy-listing statements serialize on one key; ancestor login-sync waits for a mover's commit; rare detected deadlocks abort one side | Advisory lock only + refuse non-READ-COMMITTED hierarchy writes |
| D12 | Index | ★ `idx_profiles_upline_id ON profiles (upline_id) WHERE upline_id IS NOT NULL` | None |
| D13 | Frontend scope | ★ §6.4 F1–F12 (confirmed defects + safety mirrors). Task / appointment / import pickers keep direct reports (identical today) | Switch them to the full subtree now |
| D14 | Interim | ★ §1 interim guidance until Gate 2c | Frontend-only stop-gap first |
| D15 | Release order (R2) | ★ 1 → 2a (M1) → 3 (frontend) → 2b (M2) → 2c (M3), gated on the compatibility suite | Activation-guard fallback (§R) |

**Your action, outside code (not part of any gate):** (a) confirm Supabase Auth public sign-up is **off**
(`handle_new_user` trusts signup metadata for org, role and upline; the app only uses `admin.createUser`);
(b) separately decide whether to revoke `89f2e994`'s session / ban it (its own approval); (c) note the JWT lifetime
(DB setting 3600 s) bounds how long a demoted TL keeps JWT-role branches.

## 6. Exact changes

Common to all new SQL: no `BEGIN`/`COMMIT` in the file; `SET LOCAL lock_timeout`/`statement_timeout`;
`set_config('search_path', …, true)` pinned before hashing; `DO $guard$` comparing `md5(pg_get_functiondef)` of every
replaced object with its reviewed preimage **or** its documented post-rollback state (so replay is refused but
re-apply after rollback works); `CREATE OR REPLACE` only (never DROP `is_ancestor_of`); `CREATE OR REPLACE TRIGGER`
for existing profile triggers (ShareRowExclusive, readers not blocked); DDL on `profiles` placed after the function
definitions; `DO $post$` asserting bodies, ACLs, triggers and dependencies; `NOTIFY pgrst, 'reload schema'`.
Every new/replaced function: `SET search_path = pg_catalog, public, pg_temp` (ltree's `=`, `||` and `<@` live in
`public`; no client role has CREATE on `public`), schema-qualified relations, explicit
`REVOKE ALL … FROM PUBLIC, anon, authenticated` (default privileges auto-grant anon). Error messages never echo
organization UUIDs.

### 6.1 M1 — `supabase/migrations/20261023210000_hierarchy_authorization_boundaries.sql`

1. `public.is_ancestor_of(ancestor_id uuid, descendant_id uuid)` — same signature and parameter names, `LANGUAGE sql
   STABLE SECURITY DEFINER`:
   `EXISTS (SELECT 1 FROM public.profiles d JOIN public.profiles a ON a.id = ancestor_id WHERE d.id = descendant_id
   AND (auth.uid() IS NULL OR a.id = auth.uid()) AND d.organization_id = a.organization_id
   AND d.hierarchy_path <@ a.hierarchy_path AND (a.id = d.id OR (a.status = 'Active' AND (coalesce(a.is_super_admin,
   false) OR a.role IN ('Team Leader','Admin','Super Admin')))))` (D2, D3, R1).
   REVOKE EXECUTE FROM PUBLIC, anon; re-assert GRANT to authenticated, service_role.
1b. `profile_authz.actor_is_team_leader()` and `profile_authz.actor_is_org_admin(p_org uuid)` — `STABLE SECURITY
   DEFINER`, read the caller's own profile row (never the JWT), EXECUTE to authenticated only (R1).
1c. `tasks_select_team_leader` recreated (same name, SELECT, PERMISSIVE) **TO authenticated**:
   `EXISTS (viewer = auth.uid() profile, same org as the task, role IN ('Team Leader','Team Lead')) AND
   public.is_ancestor_of(auth.uid(), tasks.assigned_to)` (R1; narrowing only).
2. `private.guard_profile_commission_level()` + `trg_01_guard_profile_commission_level` — `BEFORE UPDATE OF
   commission_level ON public.profiles FOR EACH ROW WHEN (OLD.commission_level IS DISTINCT FROM
   NEW.commission_level)`: `auth.uid()` NULL passes; self passes (existing self-edit stays a follow-up); otherwise the
   actor's **profile** must be `is_super_admin` or role Admin/Super Admin in `OLD.organization_id`, else 42501 (D4).
   `enforce_profile_field_authorization` is not edited.
3. RESTRICTIVE `FOR DELETE TO authenticated` policies (D5, D6):
   - `leads_tl_delete_requires_contacts_permission`: `NOT profile_authz.actor_is_team_leader() OR public.has_contacts_permission('contacts.leads.delete')`
   - `clients_tl_delete_requires_contacts_permission`, `recruits_tl_delete_requires_contacts_permission`: same with `contacts.clients.delete` / `contacts.recruits.delete`
   - `calls_delete_own_rows_or_org_admin`: `agent_id = auth.uid() OR profile_authz.actor_is_org_admin(organization_id)`
4. `private.guard_team_leader_downline_call_update()` + `calls_00_guard_team_leader_downline_update` (BEFORE UPDATE,
   sorts before `calls_guard_dialer_core` / `calls_reporting_fields`, so it sees the client-supplied row): returns
   immediately unless `current_user = 'authenticated'` (definer RPCs, webhooks and service role untouched), the
   caller is not the row's `agent_id`, `OLD.agent_id IS NOT NULL`, and the caller's **profile** is not Admin/Super
   Admin of the row's org nor `is_super_admin`; in that case `to_jsonb(NEW) - {flagged_for_coaching, notes,
   updated_at}` must equal the same for `OLD`, else 42501 (D6, R1).
5. Postconditions: `count(DISTINCT objid) = 9` policies depending on `is_ancestor_of` with the exact name set; ACLs;
   the 4 restrictive policies; both triggers and their order.

**Effect at apply time:** narrowing only; `f809493e` has 0 `is_ancestor_of` descendants, so no visible row changes
(re-verified in the 2a preflight).

### 6.2 M2 — `supabase/migrations/pending/20261023210100_hierarchy_integrity.sql` (moved out of `pending/` at Gate 2b)

From the locally proven prototype, with the two plan additions (no-op return, cascade `WHEN`) **proven in the review
run** on stale data (Admin no-op save, TL self-save, Admin save of a stale row: only `updated_at` changes; real moves
cascade a 6-row depth-5 subtree and pass `trg_00`; mixed multi-row statements end canonical):

1. `private.build_hierarchy_path(p_self, p_upline, p_org, p_lock boolean DEFAULT false) RETURNS public.ltree` —
   VOLATILE (required for `FOR SHARE`), SECURITY DEFINER; walks from `p_upline`; rejects reaching `p_self` (cycle), a
   revisited node, > 100 levels, a missing upline (23503) and any ancestor whose org ≠ `p_org` (23514).
2. `public.compute_hierarchy_path(uuid)` — same signature/output; delegates to the builder without locks (the enforce
   trigger keeps comparing against it). REVOKE from PUBLIC, anon, authenticated.
3. `public.update_hierarchy_path()` (BEFORE ROW): self-parent → error; **UPDATE with `upline_id`,
   `organization_id` and `hierarchy_path` all unchanged → `RETURN NEW`**; org change while children remain in the old
   org → error; else `NEW.hierarchy_path := build(NEW.id, NEW.upline_id, NEW.organization_id, true)`.
   `trg_update_hierarchy_path` → `BEFORE INSERT OR UPDATE OF upline_id, organization_id, hierarchy_path FOR EACH ROW`
   (any direct path write, even by a system caller, is overwritten with the canonical value).
4. `public.cascade_hierarchy_update()` (AFTER ROW): one `UPDATE … FROM` recursive CTE recomputing the changed row and
   its whole subtree, writing only differing rows; `trg_cascade_hierarchy_update` → `AFTER UPDATE OF upline_id …
   WHEN (OLD.upline_id IS DISTINCT FROM NEW.upline_id)`. Its own `SET hierarchy_path` cannot re-fire it.
5. `private.lock_profile_hierarchy()` + `trg_update_hierarchy_path_lock` (BEFORE INSERT OR UPDATE OF the same
   columns FOR EACH STATEMENT): `pg_advisory_xact_lock(hashtextextended('agentflow.public.profiles.hierarchy', 0))`.
6. `private.validate_invitation_upline()` + `trg_validate_invitation_upline` (BEFORE INSERT OR UPDATE ON
   `public.invitations`; on UPDATE only when `upline_id` or `organization_id` changes): upline must exist, be in the
   invitation's org and be `Active` (D8). Live: no invitation triggers today, 0 unexpired pending invitations;
   invite-user, TL invites, revoke, resend, create-user claim/release and accept all keep working. A rejected
   invite surfaces through invite-user as a generic error (no Edge redeploy); the pickers only offer valid uplines.
7. `idx_profiles_upline_id` (D12).
8. `private.hierarchy_consistency()` (postgres-only): profiles, edges, expected pairs (upline walk), stored-path
   containment pairs, missing, extra, stale, NULL paths, self-parents, cross-org edges, unreachable rows — on
   **paths**, not `is_ancestor_of`, so D2/D3 filters do not distort it.
9. Hygiene (D10): REVOKE EXECUTE on `update_hierarchy_path()`, `cascade_hierarchy_update()`, `on_profile_update()`;
   `ALTER FUNCTION public.on_profile_update() SET search_path = public, pg_temp`.
10. `$post$` probe that **fires the triggers**: inside a `BEGIN … EXCEPTION` sub-block, a no-op `SET upline_id =
    upline_id` and a `hierarchy_path` rewrite on one existing row, then a deliberate raise to roll the probe back — any
    runtime operator-resolution error aborts the migration.

Documented behaviour changes: a multi-row INSERT listing a child before its parent is rejected (the FK alone allowed
it; no app path does this); `provision_organization` on a founder who has an upline is rejected (self-serve is
disabled in live create-user); every statement listing these columns takes the hierarchy lock (F1 stops the modal
listing `upline_id`).

**Effect at apply time:** no row written, access unchanged. **Afterwards** every real upline change, and every
accepted invitation, derives correct paths — so a real move in `f809493e`'s branch (or of `ecf2bb91`/`86ca95f2`) or a
new TL-invited agent activates TL authority before 2c (hence D14 and D15).

### 6.3 M3 — `supabase/migrations/pending/20261023210200_hierarchy_path_repair.sql`

Kept in `pending/` (outside the CLI glob) until Gate 2c, then moved to its stamped version.

- Preconditions: M1 and M2 post-images present (`is_ancestor_of` md5, `trg_01_*`, the 4 restrictive policies, the
  calls guard, the cascade `WHEN` clause, the lock trigger, `private.hierarchy_consistency`); self-parents = 0,
  cross-org = 0, unreachable = 0.
- Stale set: none → no-op (CI replays); otherwise `md5(string_agg(id::text, ',' ORDER BY id))` must equal
  `ddc1f53f3823c6e367310a748ea0ac85` (the reviewed 4 rows; re-confirmed at 2c) — else refuse and re-review.
- `RAISE NOTICE` per row (id prefix, old/new depth); `UPDATE public.profiles p SET hierarchy_path = canon.path FROM
  canon WHERE p.id = canon.id AND p.hierarchy_path IS DISTINCT FROM canon.path`.
- Postconditions: stale = 0, NULL = 0, missing = extra = 0 (15/15); a second run updates 0 rows.
- Side effects: the path trigger and the lock trigger **do** fire on the 4 rows (they re-derive the identical value
  and briefly hold `FOR SHARE` on `ecf2bb91`, `f809493e`, `86ca95f2`, delaying their login-sync for milliseconds);
  the cascade does not fire. 4 `updated_at` bumps; `on_profile_update` → 8 `set_claim` writes of unchanged
  `organization_id`/`role` (adds the absent keys to banned `5f952f0d`); no `auth.users.updated_at` bump, session,
  realtime, UV or notification effect. Takes effect on the next query (no hierarchy in the JWT). A lock timeout is a
  retryable failure.

### 6.4 Frontend (Gate 3; every item narrows queries or changes display — safe to ship before the DB changes)

- **F1** `src/lib/user-management/profileSavePayload.ts` `buildProfileSavePayload(original, form, {isAdminViewer,
  isSelf})`: `upline_id` and `commission_level` only when changed vs the mapped original (uuid → None sends `null`);
  never `commission_level` when read-only. Upline candidates are validated before step 1, so a refused upline does not
  leave a committed role/status change; the remaining two-PATCH partial-save case is documented and tested.
- **F2** `src/lib/hierarchy/uplineCandidates.ts`: org-scoped loader (Active Admin/TL, explicit org, independent of
  table filters) excluding the target and its subtree (`getAgentScopeIds`); fails closed on scope error; a current
  upline outside the set shows as a disabled "current" option. Used by `UserProfileTab` (read-only for non-Admins) and
  `InviteUserModal` managers. Database guard messages reach the toast.
- **F3** `UserTeamTab` via `src/hooks/useTeamMembers.ts`: explicit org filter, Deleted excluded, error ≠ empty
  states, "Add Agent" excludes the TL's ancestors (`getUplineChainIds`), `onTeamChanged` refreshes the parent list.
- **F4** `HierarchyTree`: `getAgentScopeTraversal({viewerId, organizationId}) → {scopedIds, traversedIds}` (same BFS;
  `getAgentScopeIds` becomes a thin wrapper, contract unchanged) and `getUplineChainIds` (org-filtered every hop,
  visited-set, capped) in `supabase-users.ts`; slim batched loader `src/lib/hierarchy/hierarchyTreeData.ts`
  (display columns, includes traversed Deleted rows, never `getByIds`, no `hierarchy_path`); Admin: explicit org
  filter; TL/Agent: scope + upline chain only; no re-filter of a query-scoped set; Deleted intermediates rendered
  muted and attached (one rule, also applied to Team Profile); fail closed without an org; error state; presentational
  `VisualOrgNode` moved to `src/components/settings/hierarchy/`.
- **F5** `UserManagement` via `src/hooks/useUserManagementMembers.ts`: Admin/Super Admin → `getAll`; TL →
  `getAgentScopeTraversal` (cached per viewer/org) → `getByIds` with role/status params; Agent → self; scope failure →
  error, never a `getAll` fallback; Manager column from a filter-independent `managerNamesById` lookup (fixes blanks
  for the viewer's own row and under Admin role filters); remove the false "RLS enforces the deep ltree" comment.
- **F6** Account-control mirror (UI only, not authorization): a non-Admin editing another member gets role, status,
  upline, billing and commission disabled and no Delete / Deactivate; `usersApi.deleteUser` refuses to start the
  contact reassignment unless the viewer is Admin/Super Admin of the org.
- **F7** `CampaignDetail`: `fetchAgents` org filter; TL display filter uses `getAgentScopeIds` via
  `src/hooks/useCampaignTeamScope.ts` (fails narrow to own + unclaimed); comment that it is a display filter over rows
  RLS already returns.
- **F8** `getDownlineAgents(uplineId, organizationId)`: explicit org filter, `[]` without org (callers
  `AddTaskModal`, `ImportLeadsPage`); direct-report semantics unchanged.
- **F9** `usersApi.getAll` schema fallback keeps the Deleted / status / role / search filters.
- **F10** `FullScreenContactView` Assigned Agent options narrowed by a pure `resolveAssignableAgents({role, viewerId,
  isSuperAdmin, orgAgents, teamAgents})` extracted from `Contacts.tsx:1155-1162` (Admin/Super → org roster, TL →
  team, Agent → self, current assignee kept); explicit org filters on `FullScreenContactView.tsx:425`,
  `Contacts.tsx:1131`, `ImportLeadsPage.tsx:41`.
- **F11** Stale comments/fixtures: `supabase-users.ts:178-190, 265-266`; `profile-queries.ts:21-22, 321-322`;
  `profile-org-view.ts:16-21`; `Contacts.tsx:303-306`; `useContactScope.ts` header; `agentScopeTraversal.test.ts`
  header and PRODUCTION_SHAPE (synthetic: TL with 2 Active + 1 Deleted child; Deleted TL with Deleted child);
  `profileContracts.test.ts:113, 122`.
- **F12** Each new loader carries "query scoping, not authorization — `profiles_select_org` permits same-org reads".
  Touched components must not grow past their current size; logic goes to the named `src/lib` / `src/hooks` files.

## 7. Trigger and JWT side effects

- BEFORE on profiles: statement lock → `profiles_updated_at` → `trg_00_enforce_profile_field_authorization` →
  `trg_01_guard_profile_commission_level` → `trg_update_hierarchy_path`. AFTER: `on_profile_update_trigger` →
  `trg_cascade_hierarchy_update` → `trg_zz_*` → `uv_profile_saved/deleted`. BEFORE on calls:
  `calls_00_guard_team_leader_downline_update` → `calls_guard_dialer_core` → `calls_reporting_fields`.
- `enforce_profile_field_authorization` stays byte-identical; cascade writes pass it because
  `compute_hierarchy_path` returns exactly what the cascade writes.
- A real move of an N-row subtree: N `updated_at` bumps and 2N unchanged-value `set_claim` writes (each fires
  `sync_last_login_at`, a no-op unless `last_sign_in_at` changes). `uv_profile_saved` never fires for path or upline
  changes. `profiles` is in no publication; no cron job touches it.
- `custom_access_token_hook` (enabled) reads role/org/`is_super_admin` from profiles; hierarchy is never in the JWT.

## 8. Tests and verification

**Harness** (guards of `run_seal_list_unrestricted_users_tests.sh`, inventory/rollback steps of
`run_lead_conversion_preservation_tests.sh`, block extraction of `policy_sale_fixture.py`):
`scripts/hierarchy_fixture.py` extracts the **verbatim baseline** objects — profiles/invitations/leads/clients/
recruits/calls/contact_emails/tasks/wins/role_permissions/commission columns used; the 8 profiles triggers; enforce,
`can_update_profile`, `has_contacts_permission`, `_contacts_permission_default`, `get_org_id`, `get_user_org_id`,
`get_user_role`, `super_admin_own_org`, `is_agency_group_peer_organization`, `calls_guard_dialer_core`,
`guard_call_reporting_fields`, `private.campaign_actor`, `policy_commission_toggle`, `policy_commission_authz.*`, all
17 direct callers, `report_access_v2`/`get_report_scope_v2`, `contact_history_event_visible`, the 27 policies,
`resolve_downline_ids`; counting `set_claim` stub; parents emitted before children.
`scripts/run_hierarchy_stabilization_tests.sh` applies files by **explicit list** on a disposable loopback cluster;
CI `.github/workflows/hierarchy-stabilization.yml` on `postgres:17.6` installs PostgREST 12.2.3, sets
`POSTGREST_BIN`, and the runner **fails in CI** if it is missing. Invalid-shape fixtures (T8's 2-cycle, self-loop,
cross-org edge) are seeded with triggers disabled or kept out of harnesses that load M2.

| Area | Cases |
|---|---|
| Reproduce | production-shaped fixture on the preimage objects shows the 4 stale paths and 6 missing pairs |
| Derivation | INSERT with upline; A→B; TL1→TL2 (old TL loses access); remove → NULL (revoked); move a TL with grandchildren; depth 5; re-parent a middle node; depth 25 (old 20-cap fixed); multi-row moves |
| Integrity | self-parent; 2-cycle (two statements, one multi-row); move under own descendant; cross-org upline on INSERT/UPDATE; org change stranding downline; child-before-parent multi-row INSERT; `provision_organization` with an upline; depth > 100; invitation with cross-org / Deleted / Inactive upline — all rejected; deleted intermediate keeps ancestry |
| Consistency | `hierarchy_consistency()` = 0/0/0 after every step; full ordered-pair truth table vs upline walk |
| No-op (**Gate 1 exit criterion**) | on STALE data, before and after M2: TL self-save and Admin save with unchanged upline change no other row and heal nothing |
| TL permissions (as `authenticated` with `request.jwt.claims`) | leads, clients, recruits, calls, contact_emails, tasks, contact history, profiles UPDATE — Agent, TL, Admin, Super Admin, `is_super_admin` TL, Deleted/Inactive TL with live JWT, demoted TL with stale JWT, cross-org TL; before M1 / after M1 / after M3; delete toggle on/off incl. TL reassign-to-self-then-delete (row survives); calls: TL coaching flag/notes accepted, `created_at`/`status`/`is_missed` rejected, owner and Admin unchanged; TL unchanged-`commission_level` downline save accepted, change rejected, Admin accepted; view/edit/assign toggles pinned as UI-only |
| RPCs (all 17 direct callers) | TL-downline allowed; non-downline / cross-org / Deleted-target refused; Deleted TL with live JWT refused — incl. 4 sale writers + handoff (TL capture with read access when toggle on), conversion, `delete_contact` toggle, `notify_win`, import undo/finalize, campaign admin/authorize/assign, kanban/bulk-select, `performance_scope`; `get_report_scope_v2('team')` identical before/after; `is_ancestor_of` vs `resolve_downline_ids` parity (documented Deleted difference) |
| Ported full-stack cases | `p0_profile_authorization.sql` T5c/T13/T19, `import_campaign_attachment.sql` T4, `contacts_permissions_integration.sql` TL cases — ported onto the verbatim objects with M1–M3; the original full-stack suites are marked NOT EXECUTED unless a stack is available |
| Stale / forged tokens (R1) | per module, with tokens whose role/org claims disagree with the database: **promotion** (DB TL, token Agent → fail closed; refreshed token → allowed), **demotion** (DB Agent, token TL → no downline read, update, delete or call edit, incl. coaching flag), **deactivation** (DB Inactive / Deleted, token TL → nothing), stale Admin token on a demoted Admin → no call edits/deletes on others' rows; all as direct PostgREST writes and reads |
| Compatibility (R2) | the real frontend data-layer modules (`supabase-users.ts`, `uplineCandidates`, `hierarchyTreeData`, `profileSavePayload` + `updateProfile`, User Management / Team tab loaders, CampaignDetail scope, assignee resolver) via supabase-js against local PostgREST on S0, S1, S2, S3 and each rollback state: every call succeeds or fails exactly as designed (e.g. guard messages only from S2) |
| Forged requests (PostgREST) | anon/authenticated `/rpc/compute_hierarchy_path` denied; anon `/rpc/is_ancestor_of` denied; authenticated `is_ancestor_of` on two foreign ids and a foreign self-pair = false; PATCH `hierarchy_path` denied; cross-org/cyclic upline PATCH rejected; TL PATCH of downline upline/`commission_level` rejected; TL DELETE of downline lead/call → 0 rows and the row survives |
| Side effects | repair touches exactly the stale rows; path + lock triggers fire, cascade does not; `set_claim` stub = 2 per row; no UV/notify |
| Migrations | preimage guard refuses on drift; replay refused; re-apply after rollback accepted (M1, M2); `$post$` trigger probe; M3: fingerprint mismatch refused, synthetic fingerprint (runner-substituted copy) passes, second run 0 rows, no-op on 0 stale; rollbacks restore exact preimage md5s; ACL and `count(DISTINCT objid)` assertions; grep: no BEGIN/COMMIT |
| Concurrency | concurrent X→Y / Y→X; insert under a moving node; ancestor login-sync during a move (RC and RR); deadlock pattern aborts one side cleanly |
| Regression dispatch | policy-sale-recording, policy-commission-tracking, reports-backend, reporting-integrity, contact-history-backend, lead-conversion-preservation, commission-grids, group-leaderboard, rls-phase1, uv-profile-sync, dialer-dnc — recorded as non-regression of their own modules only (they hand-roll `is_ancestor_of`) |

Frontend (Vitest): `profileSavePayload.test.ts`; `userProfileModalSave.test.tsx` (no `uplineId` key when untouched;
TL viewer controls disabled, no Delete; Admin self commission editable; guard message reaches toast);
`uplineCandidates.test.ts`; `userTeamTab.test.tsx`; `hierarchyTree.test.tsx`; `userManagementScope.test.tsx`
(Admin → getAll; TL → scope + getByIds, never getAll; role/status narrowing; Agent → self; fail closed; Manager column);
`campaignDetailTeamFilter.test.tsx`; `supabaseUsersQueries.test.ts`; `resolveAssignableAgents.test.ts`; refreshed
`agentScopeTraversal`, `profile-org-tree`, `profileScopeAndOrgTree`, `profileContracts`; TS and SQL T8 shapes generated
from one data file (`src/lib/__tests__/hierarchyFixture.ts`). Re-run unchanged: contactsAgentsScope, InviteUserModal,
teamLeaderInvitations, useContactScopeViewAs, viewAsCallerContract, addTaskModal*, campaignDetail*.

Commands: `npx tsc --noEmit`; `npx tsc -p tsconfig.app.json` vs main; focused + full `npx vitest run` vs main; ESLint
`--max-warnings 0` on touched files; `npm run build`; `git diff --check`; the runner on local PG16 and CI PG 17.6.
After each approved database change: read-back + Supabase security/performance advisors vs today (expected to clear:
anon-executable `compute_hierarchy_path`, `is_ancestor_of`, the trigger functions; mutable search_path on
`on_profile_update`). Every gate closes with a newest-first WORK_LOG entry and a context snapshot (decisions taken,
stamped migration versions, deployment ids, blockers, next steps).

## 9. Release procedure (each step separately approved)

1. **Gate 1** — implement, test, commit, push, one draft PR. Stop.
2. **Gate 2a** — read-only preflight: migration head; preimage md5s; §1 counts; `f809493e` still 0 descendants.
   `apply_migration` M1; read back bodies, ACLs, policies, triggers, `pg_depend`, advisors. Reconcile the file to the
   stamped version (`git mv`, forward bytes unchanged); re-pin the pending M2/M3 files and runner references to sort
   after it. Never `supabase db push` (baseline row unreconciled).
3. **Gate 3** — merge (squash, expected-head guard; M2/M3 still in `pending/`); confirm the Vercel production
   deployment; non-destructive smoke checks only.
4. **Gate 2b** — preflight as 2a plus "still 4 stale, same fingerprint"; `apply_migration` M2 from `pending/`; read
   back; `$post$` trigger probe; consistency; advisors; move the file to its stamped version in a docs commit.
5. **Gate 2c** — `#APPROVE_RLS_CHANGE` plus the invariant #28 elements: separate exact approval of the stale set
   (fingerprint `ddc1f53f…`), read-only preflight re-measuring §4, bounded targets (4 rows), recovery plan (§10).
   Forensic snapshot `(id8, depth, updated_at)` into `verification.md`. Apply M3; post-check 15/15, 0 stale; re-run
   is a no-op. Move the file out of `pending/` to its stamped version in a docs commit.

## 10. Rollback strategy

| Step | Rollback | Notes |
|---|---|---|
| M1 | `rollback/20261023210000_….rollback.sql`: guarded by post-image md5s; restores the verbatim `is_ancestor_of`; drops the commission guard, the calls guard and the 4 restrictive policies; **no anon/PUBLIC re-grant** (security revokes are re-assert-only) | ⚠ With M3 live, this re-widens TL powers (downline deletes without the toggle, call edits, `commission_level`, Deleted-TL access) |
| M2 | `rollback/20261023210100_….rollback.sql`: restores verbatim `compute`/`update`/`cascade` bodies and trigger DDL (`CREATE OR REPLACE TRIGGER`); drops builder, lock trigger, invitation guard, consistency function, index; keeps revokes and the `on_profile_update` search_path hardening | Proven locally: preimage md5s restored; repaired paths stay correct; re-apply after rollback passes the guard |
| M3 | **Recovery path = operational revocation**: an Admin reassigns the affected agents' upline (fixed triggers revoke immediately) or changes the TL's role. No automatic data inverse — rolling back functions never removes granted authority. The Gate 2c snapshot is forensic only; a byte-exact restore would need an invariant #29 artifact (full-id CSV outside the repo, sha256, re-parsed and compared) plus M2 rolled back and its own approval | |
| Frontend | Revert the PR / promote the previous Vercel deployment | |

## 11. Files to touch (Gate 1)

**Database (new files only; no applied migration edited):**
`supabase/migrations/20261023210000_hierarchy_authorization_boundaries.sql`,
`supabase/migrations/pending/20261023210100_hierarchy_integrity.sql`,
`supabase/migrations/pending/20261023210200_hierarchy_path_repair.sql`, and
`supabase/migrations/rollback/` `20261023210000_…`, `20261023210100_…`, `20261023210200_…` (`.rollback.sql`; M3's is a
refusal stub documenting §10).

**Tests / CI:** `scripts/hierarchy_fixture.py`, `scripts/run_hierarchy_stabilization_tests.sh`,
`supabase/tests/hierarchy_stabilization.sql`, `supabase/tests/hierarchy_stabilization_rls.sql`,
`supabase/tests/hierarchy_stabilization_rpcs.sql`, `supabase/tests/fixtures/hierarchy_shapes.json` (shared TS/SQL
shapes), `scripts/tests/hierarchy_stabilization/postgrest_forged.mjs`,
`src/test/integration/hierarchyFrontendCompat.integration.test.ts` (env-gated, run by the runner against PostgREST),
`.github/workflows/hierarchy-stabilization.yml`; expectation/comment updates only in
`supabase/tests/import_campaign_attachment.sql` (T4), `supabase/tests/p0_profile_authorization.sql` (INFO notes),
`supabase/tests/profile_book_stats_rpc.sql` (T8 from the shared data file).

**Frontend:** `src/lib/supabase-users.ts`, `src/lib/profile-org-tree.ts`, `src/lib/profile/profile-queries.ts`,
`src/lib/profile/profile-org-view.ts`; new `src/lib/user-management/profileSavePayload.ts`,
`src/lib/hierarchy/uplineCandidates.ts`, `src/lib/hierarchy/hierarchyTreeData.ts`,
`src/lib/contacts/resolveAssignableAgents.ts`, `src/hooks/useUserManagementMembers.ts`, `src/hooks/useTeamMembers.ts`,
`src/hooks/useCampaignTeamScope.ts`, `src/components/settings/hierarchy/VisualOrgNode.tsx`; edited
`src/components/settings/HierarchyTree.tsx`, `UserManagement.tsx`, `user-management/UserProfileModal.tsx`,
`UserProfileTab.tsx`, `UserTeamTab.tsx`, `InviteUserModal.tsx`, `TeamMembersTable.tsx`,
`src/components/contacts/FullScreenContactView.tsx`, `AddTaskModal.tsx`, `src/pages/Contacts.tsx` (extraction + org
filter + comment), `ImportLeadsPage.tsx`, `CampaignDetail.tsx`, `src/hooks/useContactScope.ts` (comment).
Tests: new `profileSavePayload.test.ts`, `userProfileModalSave.test.tsx`, `uplineCandidates.test.ts`,
`userTeamTab.test.tsx`, `hierarchyTree.test.tsx`, `userManagementScope.test.tsx`, `campaignDetailTeamFilter.test.tsx`,
`supabaseUsersQueries.test.ts`, `resolveAssignableAgents.test.ts`, `src/lib/__tests__/hierarchyFixture.ts`; updated
`agentScopeTraversal.test.ts`, `profile-org-tree.test.ts`, `profileScopeAndOrgTree.test.ts`,
`profileContracts.test.ts`.

**Docs:** `AGENT_RULES.md` (§3 Team Leader line; #20 hierarchy bullets; #26 "Known fail-closed behaviour"; Known Tech
Debt entry → new "Hierarchy integrity invariant"; Phase 2A "see the hierarchy debt above" cross-reference),
`WORK_LOG.md`, `implementation_plan.md`, `docs/plans/2026-10-23-hierarchy-stabilization/{implementation_plan.md,
verification.md}`.

**Not touched:** Edge Functions (no deploy; `create-user` must not be redeployed), sale writers, commission
functions, Reports RPCs, `enforce_profile_field_authorization`, `handle_new_user`, `tasks_select_team_leader`,
applied migrations, telephony.

## 12. Out of scope — recorded follow-ups

Contacts toggles: owner-row delete bypass for Agents; view/edit/assign not enforced in RLS for any role. Calls:
non-core column edits by owners. Commission: `profiles.commission_level` readable org-wide regardless of the toggle;
TL invites can set a new agent's level (invite-user); agents can still edit their own level, which feeds Phase 2A
estimates. Lifecycle: soft delete does not ban or revoke sessions; `deleteUser` does not warn about or re-parent direct
reports; `invite-user` does not require an Active caller; demoted-TL JWT window. Invitations: an Admin can POST any
role (incl. Super Admin) directly; TLs can revoke any org invitation; `get_invitation_by_token_rpc` returns
`upline_id` to token holders; legacy `accept-invite`. Signup: `handle_new_user` trusts metadata. Display: Contacts
Agents tab and `useContactScope` errors look like an empty downline; DialerPage roster and AgentModal `select('*')`
lack explicit org filters; bulk delete reports `ids.length`; task/appointment/import pickers direct-report only;
`fetchTeamRoster` unbatched; appointments TL scope on inert `team_id`; `tasks_select_team_leader` lacks the D3 status
check (0 rows). Platform: agency-group self-match in `is_agency_group_peer_organization`; `dialer_lead_locks_delete`
without org filter; `super_admin_all_users` anon-executable; legacy `'Team Lead'` literals; SECURITY DEFINER advisor
backlog (57 anon-executable); migration-history filename drift.
