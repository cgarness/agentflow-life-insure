# Hierarchy Stabilization — upline_id authoritative, repaired paths, safe Team Leader authority

**Status (2026-10-23): PLAN ONLY — awaiting Chris's explicit approval.** No source file, migration, RLS policy,
function, Edge Function, deployment or production row has been changed. Every production contact in this phase was a
read-only `SELECT` against `jncvvsvckxhqgqvkppmj` (catalog, aggregates, 8-character id prefixes only). A throwaway
local PostgreSQL 16 cluster in the session scratchpad reproduced the defects and proved the prototype; it was stopped
and holds no production data.

Branch: `claude/intelligent-lamport-r6hnx7` at `main` `f03af3b`. Gates (each needs its own approval):

| Gate | What it authorizes | Production effect |
|---|---|---|
| **1** | Implementation on this branch: migrations + rollbacks (files only), test harness + CI workflow, frontend, docs, local/CI verification, one **draft PR** | none |
| **2a** | `apply_migration` of **M1** (authorization boundaries) — needs `#APPROVE_RLS_CHANGE` | narrows only; 0 rows change visibility today |
| **2b** | `apply_migration` of **M2** (integrity triggers + guards) | no row changes; future upline edits become correct |
| **2c** | `apply_migration` of **M3** (idempotent path repair) | **activates Team Leader f809493e's downline authority** (§4) |
| **3** | Merge the PR and release the frontend | UI only |

2a and 2b may be approved together; 2c must come after both (§9).

---

## 0. Sources read and conflict check (2026-10-23)

- `AGENT_RULES.md`: §3 multi-tenancy and "Downline profile scoping is query-enforced, not RLS-enforced"; invariants
  #6, #8, #20 (profile authorization columns, three layers), #25 (applied migrations immutable), #26 ("Known
  fail-closed behaviour"), #28 (production read-only by default), #30/#34 (release mechanics: MCP `apply_migration`,
  then filename reconciliation), #37, #38 (Reports scoping through `private.resolve_downline_ids`), Phase 2A /
  Commissions sections (toggle-gated TL commission reads), §7 component standards, §8 workflow, §10 forbidden
  patterns, and Known Tech Debt "🚨 Team Leader hierarchy predicate is unreliable".
- `VISION.md` (telemetry first; roles Super Admin → Admin → Team Leader → Agent; `ltree` hierarchy).
- `WORK_LOG.md` newest entries (Add to Campaign #483, carrier selection #479, Google Sheets, Commissions): none touch
  profiles, hierarchy, `is_ancestor_of` or the files below.
- **Open PRs (14):** docs/release-record PRs and unrelated features (#481, #480, #478, #461, #444, #441, #429, #425,
  #398, #383, #382, #381, #378, #294). None touches hierarchy, profiles triggers, `supabase-users.ts`, User Management
  or the hierarchy SQL. No conflict.
- **Production migration head:** `20261022062539` (343 recorded rows). New versions must sort after it; re-check
  with `list_migrations` immediately before each Gate 2 step.
- **Repo vs live drift (hierarchy objects):** none. `md5(pg_get_functiondef)`, owner, `SECURITY DEFINER`,
  `proconfig` and ACL of `is_ancestor_of`, `compute_hierarchy_path`, `update_hierarchy_path`,
  `cascade_hierarchy_update`, `enforce_profile_field_authorization`, `handle_new_user`, `on_profile_update`,
  `set_claim`, `profile_authz.can_update_profile` and `private.resolve_downline_ids` equal the latest repo
  definitions (baseline `20260806000000`; `20260919183544` for the resolver). The 8 profiles triggers match too.

## 1. Verified baseline (re-checked 2026-10-23, read-only)

| Measure | Value |
|---|---|
| Profiles / organizations | 16 / 4 |
| Direct upline relationships | 11 |
| Direct relationships `is_ancestor_of` does not recognise | 4 |
| Expected ancestor pairs (upline walk) / missing from `is_ancestor_of` / extra | 15 / **6** / 0 |
| Stored `hierarchy_path` ≠ canonical | **4** (`4ef505e0`, `e5c4ee04`, `89f2e994`, `5f952f0d`) |
| Cross-org edges / missing parents / self-parents / cycles | 0 / 0 / 0 / 0 |
| Longest reporting chain | 3 profiles |
| PostgreSQL / ltree | 17.6 / 1.3 in schema `public` (local proof: 16.15 / 1.2) |

All 4 stale rows are in Chris's org `a0000000…`: Admin `ecf2bb91` → TL `f809493e` (Active) → `4ef505e0` (Active),
`e5c4ee04` (Active), `89f2e994` (Deleted, **not banned, 1 live session**); Admin → TL `86ca95f2` (Deleted, banned) →
`5f952f0d` (Deleted, banned). The 7 direct Admin → member edges are already correct.

### Root cause (reproduced verbatim on local PG16; production counts reproduced exactly)

1. `trg_update_hierarchy_path` (BEFORE INSERT OR UPDATE OF `upline_id`) runs `update_hierarchy_path()`, which sets
   `NEW.hierarchy_path := compute_hierarchy_path(NEW.id)`. `compute_hierarchy_path` walks `upline_id` from the
   **stored** row: on INSERT the row is not visible yet → self-only path (`89f2e994`, invited under the TL); on UPDATE
   it still holds `OLD.upline_id` → the path describes the previous upline (`4ef505e0`, `e5c4ee04`, moved from the
   Admin to the TL, still store `ecf2bb91.<self>`).
2. `cascade_hierarchy_update()` (AFTER UPDATE OF `upline_id`) updates only **direct children**, and its
   `SET hierarchy_path` does not re-fire the `UPDATE OF upline_id` triggers, so grandchildren never refresh. The moved
   row itself stays stale; a TL can even lose ancestry over its own direct children.
3. The stale data **fails open** on reassignment: moving an agent from TL1 to TL2 (or to "None") leaves
   `is_ancestor_of(TL1, agent) = true`. Latent today (0 extra pairs) — the next move creates one.
4. No guard against self-parents, cycles or cross-org uplines (all reproduced, including a same-org Admin setting a
   cross-org upline over PostgREST); `compute_hierarchy_path` silently truncates chains at 20 levels.

### ⚠ Live risk — the Team Leader branches are one ordinary Save away from turning on

`UPDATE OF upline_id` triggers fire whenever `upline_id` is **in the SET list**, even unchanged. `UserProfileModal`
always sends it (`UserProfileModal.tsx:117` → `supabase-users.ts:411`). So an Admin saving TL `f809493e` in User
Management — or **the TL saving their own profile** (self is allowed; the guard only rejects a *changed* upline) —
runs the cascade as `postgres` and repairs the TL's children, switching on every TL branch in §4 with no review. This
already happened once: on 2026-10-17 20:35:13 UTC one transaction healed 4 children of `ecf2bb91` (3/11 → 7/11
correct edges). `f809493e` has a live session; the upline-carrying PATCH ran 3 times in the last 4 weeks.

**Interim recommendation (no code):** until M1+M2 are applied, avoid saving `f809493e`, `4ef505e0`, `e5c4ee04` or
`89f2e994` in Settings → User Management. (The TL can still trigger it on their own row; M1+M2 close it — §9 orders
them first precisely because they change no access today.)

## 2. Inventory — everything that depends on the hierarchy

**RLS (27 policies + 1 inherited; none RESTRICTIVE today; none reference `upline_id`):**

| Group | Policies | Hierarchy branch |
|---|---|---|
| `is_ancestor_of` direct (9) | `calls`: Hierarchical Select / Insert / Update / Delete; `clients`, `leads`, `recruits`: Hierarchical Access (**FOR ALL**); `contact_emails_select`; `profiles_select_hierarchical` | `role IN (Team Leader[, Team Lead]) AND organization_id = get_org_id() AND is_ancestor_of(auth.uid(), owner)` |
| raw `hierarchy_path` (1) | `tasks_select_team_leader` (TO public) | `subject.hierarchy_path <@ viewer.hierarchy_path`, viewer role/org from `profiles` |
| via helper (17) | `profiles_update_authorized` → `profile_authz.can_update_profile`; 16 `policy_commission_*` → `policy_commission_authz.access` | TL branch = `is_ancestor_of`; commission reads also need the "View Others' Commission Percentage" toggle |
| inherited (1) | `contact_history_events_select` → `contact_history_event_visible` (invoker) | inherits leads/clients/recruits/tasks RLS |

Every hierarchy branch is ANDed with a same-org guard and a role check, so a cross-org edge could not expose another
tenant's rows; every consumer checks owner/self before `is_ancestor_of`, so `is_ancestor_of(x,x)=true` never grants
anything alone.

**Functions:** 29 mention a hierarchy primitive; **17 call `is_ancestor_of` directly**, all taking the ancestor from
`auth.uid()` (10 via `private.campaign_actor()`, which also requires an Active actor; 7 directly:
`can_update_profile`, `_contacts_filtered_leads`, `get_contact_scope_agents`, `_import_undo_context`,
`convert_lead_to_client_atomic`, `delete_contact`, `notify_win`). Notable dependents: the four sale writers + handoff
companions, `private.performance_scope` (Dashboard team), `private.can_administer_campaign`,
`private.can_authorize_campaign_lead`, `private.assert_may_assign_to`, kanban / bulk-select, import finalize.
**Reports** (`report_access_v2`, `get_profile_book_stats`, `get_profile_team_readiness`) use
`private.resolve_downline_ids` (upline walk) — **unaffected** by this project.

**Exposure:** `compute_hierarchy_path(uuid)` and `is_ancestor_of(uuid,uuid)` are `SECURITY DEFINER` in `public` with
EXECUTE for `PUBLIC`/`anon`/`authenticated`: anyone with the anon key and a profile UUID can read that profile's full
upline chain, or test ancestry/existence across orgs, over `/rest/v1/rpc`. No client has called either since
2026-09-26 (pg_stat_statements; 24 h edge logs). `authenticated` must keep EXECUTE on `is_ancestor_of` (RLS runs as
the invoker; 2 invoker RPCs call it). The trigger functions also carry anon EXECUTE (harmless, untidy).

## 3. Design summary

1. **`profiles.upline_id` is the only authority.** `hierarchy_path` becomes a strictly derived cache that the database
   keeps equal to the canonical upline chain (root-first, `-`→`_` labels — same format, so `is_ancestor_of`, the GiST
   index and `tasks_select_team_leader` keep working unchanged).
2. **Derivation from the incoming row:** a path builder walks from `NEW.upline_id` (not the stored row), org-checked
   at every ancestor, cycle-safe, capped at 100 levels (= `resolve_downline_ids` / `getAgentScopeIds`).
3. **Whole-subtree refresh** in one set-based statement when an upline really changes; **no-op saves change nothing**.
4. **Structural guards** in the database: no self-parent, no cycle, no cross-org upline or ancestor, no org change
   that strands downline in another org; invitations cannot carry a cross-org or Deleted upline.
5. **Authorization boundaries before activation** (M1): the repair must not create permissions beyond what the
   existing Contacts / commission toggles and role boundaries already allow (§5).
6. **Controlled activation:** the 4 stale rows are repaired by a separate, idempotent, guarded migration (M3) applied
   only on Chris's exact approval, after M1 and M2.
7. Deleted intermediates keep passing authority through (paths include them), matching the canonical resolver.

## 4. Effective authorization change of the repair (policy text unchanged)

Only one sign-in-capable Team Leader exists. Repair adds exactly 6 ancestor pairs and removes none:
`f809493e→{4ef505e0, e5c4ee04, 89f2e994}`, `ecf2bb91→{89f2e994, 5f952f0d}` (Admin — already sees the whole org;
moot), `86ca95f2→5f952f0d` (Deleted, banned TL — no effect; with D3 also blocked in the DB).

What **TL `f809493e`** gains when M3 runs (row counts re-measured at Gate 2c preflight). "With M1" = after the
recommended boundaries:

| Module | Today | After repair, policy text unchanged | After repair **with M1** (recommended) |
|---|---|---|---|
| Leads | 61 visible (8 own + 53 unassigned pool) | +132 downline (85 + 47): SELECT, INSERT, UPDATE, **DELETE** | +132 SELECT/INSERT/UPDATE; DELETE only if `contacts.leads.delete` (default **off**) |
| Clients | 0 | +10 (9 + 1), same FOR ALL | +10 SELECT/INSERT/UPDATE; DELETE only with `contacts.clients.delete` (off) |
| Recruits / tasks / contact_emails | — | +0 rows | +0 rows |
| Calls | 514 (324 own + 190 inbound-unassigned) | +4,590 SELECT; UPDATE of non-core columns; **DELETE** (cascades voicemails, inbound_route_attempts; nulls `wins.call_id`); INSERT for downline blocked by `calls_guard_dialer_core` | +4,590 SELECT; non-core UPDATE kept (coaching flag, notes); **DELETE blocked** (D6) |
| Contact history | — | +86 events | +86 events |
| Profiles UPDATE | self | 3 downline rows, incl. **`commission_level`**, email, phone, NPN, licences (UV sync fires on name/email/phone/NPN/avatar) | 3 downline rows, **`commission_level` Admin-only** (D4) |
| Profiles SELECT | whole org (`profiles_select_org`) | unchanged | unchanged |
| Contacts Team scope (`get_contact_scope_agents`) | hidden (self only) | self + `4ef505e0` + `e5c4ee04` | same |
| Dashboard team (`performance_scope`) | self | self + 3 (incl. Deleted `89f2e994`, 0 activity) | same |
| Sale writers / conversion / `delete_contact` / `notify_win` | own | downline leads & clients (credited to stored owner) | same; `delete_contact` still honours the toggle |
| Campaign / import RPC branches | own | downline (0 campaigns, 0 imports today) | same |
| Commission rows | none | none — "View Others' Commission Percentage" is **off** for TLs in `a0000000` (46 rows would open if an Admin turns it on: documented Phase 2A design) | same; no new commission permission |
| Reports (`report_access_v2`) | self + `4ef505e0` + `e5c4ee04` | **unchanged** | unchanged |

Org totals for context: 8,153 calls, 2,037 leads, 22 clients. No access is withdrawn from any current user.

## 5. Decisions for Chris (recommended defaults marked ★)

Reply "approve Gate 1 with the recommended defaults" or name any change.

| # | Decision | ★ Recommended | Alternatives |
|---|---|---|---|
| D1 | Canonical TL resolver | ★ Keep path-based `is_ancestor_of` (fast, GiST-indexed, used by 27 policies) with `hierarchy_path` **kept correct by the database**; Reports keep `resolve_downline_ids`; a parity test pins the two | Rewrite `is_ancestor_of` as a per-row upline walk (slower in RLS; `tasks_select_team_leader` would still read paths) |
| D2 | `is_ancestor_of` semantics | ★ Same signature (9 policies depend on it); **add same-org check**; self stays true; Deleted descendants stay included (no change vs today) | Also exclude Deleted descendants (aligns with Reports, hides orphaned books from TLs) |
| D3 | Deleted / Inactive Team Leaders | ★ `is_ancestor_of` requires the **ancestor to be `Active`** (except self). Closes "soft-deleted TL with a live token keeps downline access" for all 9 policies + 7 non-`campaign_actor` functions; 0 effect today | Leave as is and rely on banning (soft delete does not ban today) |
| D4 | TL edits of downline profiles (designed since 2026-03, dormant) | ★ Keep the TL branch; add an additive guard trigger making **`commission_level` changes on another user Admin/Super Admin only** (no new commission write); UI field read-only for TLs | (b) TL self-only (remove the branch); (c) restore everything as designed |
| D5 | Contacts DELETE by TL on downline (FOR ALL policies ignore the delete toggles) | ★ RESTRICTIVE DELETE policies on `leads`/`clients`/`recruits`: a TL deleting a row it does not own needs `has_contacts_permission('contacts.<type>.delete')` — same rule `delete_contact` applies. Own-row behaviour unchanged | Accept the bypass; or enforce toggles for every role (wider Contacts change — out of scope) |
| D6 | TL DELETE of downline call rows | ★ Block with a RESTRICTIVE DELETE policy on `calls` (no UI deletes calls; calls are canonical telemetry). Keep the designed non-core UPDATE (CallRecordingLibrary coaching flag) | Restore DELETE as designed |
| D7 | Commission design | ★ No change. Confirm: TL + "View Others' Commission Percentage" = read downline commission rows; a TL-recorded downline sale captures with read access (Phase 2A design) | Close the TL commission branch (would be a commission-permission change) |
| D8 | Upline rules | ★ DB enforces structure (self, cycle, cross-org, depth 100, org change stranding downline). Status/role rules are **UI-only**: pickers offer Active Admin/TL in the same org, excluding self and descendants. Invitations: DB rejects cross-org or Deleted upline at creation | Also enforce role/status in the DB (would break TL demotion / soft-delete flows that leave children in place) |
| D9 | Repair packaging | ★ Separate migration M3 (idempotent, no hard-coded ids, refuses if more than the 4 reviewed rows are stale or any structural violation exists); repair all 4 incl. the 2 Deleted rows so stored == canonical everywhere; accept 4 `updated_at` bumps (snapshot first) and 8 unchanged-value `set_claim` writes | Repair inside M2; exclude Deleted rows |
| D10 | Grants & hygiene | ★ REVOKE `compute_hierarchy_path` from PUBLIC/anon/authenticated; `is_ancestor_of` from PUBLIC/anon (keep authenticated); REVOKE EXECUTE on the profiles trigger functions from PUBLIC/anon/authenticated; `SET search_path` on `on_profile_update` (body unchanged) | Separate security change |
| D11 | Concurrency | ★ Prototype design: statement-level transaction advisory lock + `FOR SHARE` ancestor walk (proved against concurrent 2-cycle and stale-insert races; RR/SERIALIZABLE writers get 40001). Add a concurrent login-sync test | Advisory lock only + refuse non-READ-COMMITTED hierarchy writes |
| D12 | Index | ★ `CREATE INDEX idx_profiles_upline_id ON profiles (upline_id) WHERE upline_id IS NOT NULL` | None (16 rows today) |
| D13 | Frontend scope | ★ §6.4 items F1–F10 (confirmed defects only). Task / appointment / import pickers keep direct reports (identical today; follow-up) | Switch them to the full subtree now |
| D14 | Interim | ★ Avoid saving the 4 affected profiles until M1+M2 (§1) | Ship a frontend-only stop-gap first |

**Your action, outside code (not part of any gate):** (a) confirm in Supabase Auth settings that public sign-up is
**off** (`handle_new_user` trusts signup metadata for org, role and upline; the app only uses `admin.createUser`, so
turning it off breaks nothing); (b) decide separately whether to revoke the live session / ban `89f2e994`
(Deleted, not banned) — a production auth change needing its own approval; (c) note the JWT expiry (DB setting 3600 s)
bounds how long a demoted TL keeps JWT-role branches.

## 6. Exact changes

All new SQL follows the recent guarded pattern (`20261021200000`, `20261018060615`): `SET LOCAL lock_timeout /
statement_timeout`; `set_config('search_path', …)` pinned before hashing; `DO $guard$` comparing
`md5(pg_get_functiondef)` of every replaced object with the reviewed preimage (refuses on drift or replay);
`CREATE OR REPLACE` only (never DROP `is_ancestor_of` — 9 policies depend on it); `DO $post$` asserting bodies,
ACLs, triggers and dependencies; `NOTIFY pgrst, 'reload schema'`. Every new function: explicit
`REVOKE ALL … FROM PUBLIC, anon, authenticated` (default privileges in `public` auto-grant anon), schema-qualified
objects, `OPERATOR(public.<@)` / `public.text2ltree` because `ltree` lives in `public`. Error messages never echo
organization UUIDs.

### 6.1 M1 — `supabase/migrations/20261023210000_hierarchy_authorization_boundaries.sql`

1. `public.is_ancestor_of(ancestor_id uuid, descendant_id uuid)` — same signature, parameter names, `LANGUAGE sql
   STABLE SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`:
   `EXISTS (d JOIN a ON a.id = ancestor_id WHERE d.id = descendant_id AND d.organization_id = a.organization_id AND
   d.hierarchy_path OPERATOR(public.<@) a.hierarchy_path AND (a.id = d.id OR a.status = 'Active'))` (D2, D3).
   REVOKE EXECUTE FROM PUBLIC, anon; re-assert GRANT to authenticated, service_role.
2. `private.guard_profile_commission_level()` + trigger `trg_01_guard_profile_commission_level` (BEFORE UPDATE OF
   `commission_level`; sorts after `trg_00_*`): system callers (`auth.uid()` NULL) pass; self unchanged (pre-existing
   self-edit stays a documented follow-up); any other actor must be `is_super_admin` or Admin/Super Admin of the
   row's org (D4). `enforce_profile_field_authorization` itself is **not** edited.
3. RESTRICTIVE `FOR DELETE TO authenticated` policies (D5, D6):
   - `leads_delete_tl_requires_contacts_permission`: `user_id = auth.uid() OR coalesce(get_user_role(),'') <> 'Team Leader' OR has_contacts_permission('contacts.leads.delete')`
   - `clients_delete_tl_requires_contacts_permission` / `recruits_delete_tl_requires_contacts_permission`: same on `assigned_agent_id`, keys `contacts.clients.delete` / `contacts.recruits.delete`
   - `calls_delete_tl_own_rows_only`: `agent_id = auth.uid() OR coalesce(get_user_role(),'') NOT IN ('Team Leader','Team Lead') OR super_admin_own_org(organization_id)`
   Admin, Super Admin, Agent and owner-row behaviour is unchanged. `delete_contact`, conversion and import-undo run
   as definer and are unaffected.
4. Postconditions: 9 `pg_depend` policy dependencies on `is_ancestor_of` intact; ACLs; 4 restrictive policies;
   commission guard trigger order.

**Effect at apply time:** narrowing only. `f809493e` has 0 `is_ancestor_of` descendants today, so no visible row
changes for anyone (verified in the Gate 2a preflight).

### 6.2 M2 — `supabase/migrations/20261023210100_hierarchy_integrity.sql`

From the locally proven prototype (`prototype.sql`; 2,421-row scale test; repair 4 → 0 rows; 15/15 pairs):

1. `private.build_hierarchy_path(p_self, p_upline, p_org, p_lock boolean DEFAULT false) RETURNS ltree` — VOLATILE
   (needed for `FOR SHARE`), SECURITY DEFINER: walks from `p_upline`; rejects reaching `p_self` (cycle), a revisited
   node, > 100 levels, a missing upline (23503) and any ancestor whose org ≠ `p_org` (23514).
2. `public.compute_hierarchy_path(uuid)` — same signature and output; delegates to the builder without locks (the
   enforce trigger keeps comparing against it). REVOKE from PUBLIC, anon, authenticated (callers are definer-owned).
3. `public.update_hierarchy_path()` (BEFORE ROW): self-parent → error; **UPDATE with `upline_id`, `organization_id`
   and `hierarchy_path` all unchanged → `RETURN NEW` (no-op saves change nothing)**; org change while children remain
   in the old org → error; otherwise `NEW.hierarchy_path := build(NEW.id, NEW.upline_id, NEW.organization_id, true)`.
   Trigger `trg_update_hierarchy_path` recreated as `BEFORE INSERT OR UPDATE OF upline_id, organization_id,
   hierarchy_path FOR EACH ROW` (any direct path write, even by a system caller, is overwritten with the canonical
   value). Name still sorts after `trg_00_*` / `trg_01_*`.
4. `public.cascade_hierarchy_update()` (AFTER ROW): one `UPDATE … FROM` recursive CTE recomputing the changed row and
   its whole subtree at every depth, writing only differing rows; trigger recreated as `AFTER UPDATE OF upline_id …
   WHEN (OLD.upline_id IS DISTINCT FROM NEW.upline_id)`. Its `SET hierarchy_path` cannot re-fire it.
5. `private.lock_profile_hierarchy()` + `trg_update_hierarchy_path_lock` (BEFORE … FOR EACH STATEMENT):
   `pg_advisory_xact_lock(hashtextextended('agentflow.public.profiles.hierarchy', 0))` (D11).
6. `private.validate_invitation_upline()` + `trg_validate_invitation_upline` (BEFORE INSERT OR UPDATE OF
   `upline_id`, `organization_id` ON `public.invitations`): upline must exist in the invitation's org and not be
   `Deleted` (D8). 0 unexpired pending invitations today; none would be rejected.
7. `idx_profiles_upline_id` (D12).
8. `private.hierarchy_consistency()` (postgres-only): profiles, edges, expected pairs (upline walk), stored-path
   containment pairs, missing, extra, stale paths, NULL paths, self-parents, cross-org edges, unreachable rows.
   Measured on **paths**, not on `is_ancestor_of`, so the D2/D3 authorization filters do not distort it.
9. Hygiene (D10): REVOKE EXECUTE on `update_hierarchy_path()`, `cascade_hierarchy_update()`,
   `on_profile_update()` from PUBLIC/anon/authenticated; `ALTER FUNCTION public.on_profile_update() SET search_path
   = public, pg_temp` (body untouched).

**Effect at apply time:** no row is written; access unchanged. Afterwards every real upline change derives correct
paths for the moved row and its subtree, and an unchanged-upline save can no longer heal (activate) anything.

### 6.3 M3 — `supabase/migrations/20261023210200_hierarchy_path_repair.sql`

- Preconditions from `private.hierarchy_consistency()`: self-parents = 0, cross-org edges = 0, unreachable = 0; stale
  rows ≤ **4** (the reviewed set) — otherwise refuse and re-review. No hard-coded ids (CI replays are a no-op).
- `RAISE NOTICE` per row (id prefix, old/new depth), then
  `UPDATE public.profiles p SET hierarchy_path = canon.path FROM canon WHERE p.id = canon.id AND p.hierarchy_path
  IS DISTINCT FROM canon.path` (canonical paths from the roots).
- Postconditions: stale = 0, NULL = 0, missing = extra = 0; running it again updates 0 rows.
- Side effects (D9): the 4 rows' `updated_at` bump; `on_profile_update` → 8 `set_claim` writes to
  `auth.users.raw_app_meta_data` with unchanged `organization_id`/`role` (adds the absent keys to banned
  `5f952f0d`); no `auth.users.updated_at` bump, no session change, no realtime, UV or notification event; the cascade
  and path triggers do not fire (no `upline_id` in the SET list). Takes effect on the next query — no token refresh
  (the JWT carries no hierarchy).

### 6.4 Frontend (released only at Gate 3)

- **F1** `UserProfileModal` / `supabase-users.ts updateProfile`: send `upline_id` only when it changed.
- **F2** Upline picker (`UserProfileTab`): own org-scoped candidate query (Active Admin/TL in the viewer's org),
  independent of table filters; excludes self and descendants (`getAgentScopeIds`); shows the database guard message.
- **F3** `UserTeamTab`: explicit org filter, Deleted members excluded, error states instead of empty states; "Add
  Agent" excludes the TL's ancestors; guard message on failure.
- **F4** `HierarchyTree`: explicit `organization_id` filter, fail closed without an org, remove the cross-org
  admission in `profilesForOrgTree`; non-Admin viewers load only their resolved scope + upline chain (query-enforced);
  traverse **through** Deleted managers (load for traversal, render muted) so their Active reports stay attached;
  error state.
- **F5** `UserManagement`: Team Leader / Agent viewers query only resolved ids (`getAgentScopeIds` → `getByIds`; TL =
  full subtree, Agent = self) instead of fetching the whole org and filtering; fix the false "RLS enforces the deep
  ltree" comment.
- **F6** `UserProfileModal`: commission level read-only when a non-Admin edits someone else (mirrors D4).
- **F7** `CampaignDetail`: the dead TL team filter (`upline_id` never selected) uses the resolved scope ids.
- **F8** `getDownlineAgents`: explicit org filter (direct-report semantics unchanged, D13).
- **F9** `usersApi.getAll` schema-fallback keeps the Deleted/search/role filters.
- **F10** Correct stale comments/fixtures: `supabase-users.ts`, `useContactScope.ts` header,
  `agentScopeTraversal.test.ts` PRODUCTION_SHAPE (synthetic ids, TL with 2 Active + 1 Deleted child, Deleted TL with
  Deleted child), `profileContracts.test.ts` count.

Components over 200 lines (`HierarchyTree` 311, `UserProfileModal` 356) get logic extracted to `src/lib`, not grown.

## 7. Trigger and JWT side effects (checked)

- BEFORE order on profiles: `profiles_updated_at` → `trg_00_enforce_profile_field_authorization` →
  `trg_01_guard_profile_commission_level` (new) → `trg_update_hierarchy_path`; plus the new statement-level lock.
  AFTER: `on_profile_update_trigger` → `trg_cascade_hierarchy_update` → `trg_zz_*` → `uv_profile_saved/deleted`.
- `enforce_profile_field_authorization` stays byte-identical; the cascade's descendant writes still pass it
  because `compute_hierarchy_path` returns exactly what the cascade writes.
- A real reassignment of a subtree of N rows causes N `updated_at` bumps and 2N unchanged-value `set_claim` writes
  (each fires `sync_last_login_at`, a no-op unless `last_sign_in_at` changes). `uv_profile_saved` never fires for path
  or upline changes. `profiles` is in no publication; no cron job touches it.
- `custom_access_token_hook` (enabled; 2,154 calls) reads `role`/`organization_id`/`is_super_admin` from profiles;
  hierarchy is never in the JWT.

## 8. Tests and verification

**New harness** (modelled on `run_seal_list_unrestricted_users_tests.sh` guards + `run_lead_conversion_preservation_tests.sh`
inventory/rollback steps + `policy_sale_fixture.py` block extraction): `scripts/hierarchy_fixture.py` extracts the
**verbatim baseline** objects (profiles/invitations/leads/clients/recruits/calls/contact_emails/tasks columns used,
the 8 profiles triggers, enforce/can_update_profile/has_contacts_permission/get_org_id/get_user_role/
super_admin_own_org, `calls_guard_dialer_core`, the 27 policies, `resolve_downline_ids`, `get_contact_scope_agents`,
`performance_scope`, a counting `set_claim` stub); `scripts/run_hierarchy_stabilization_tests.sh` (disposable
loopback cluster only, refuses hosted roles); CI `.github/workflows/hierarchy-stabilization.yml` on `postgres:17.6`.

| Area | Cases |
|---|---|
| Reproduce | Production-shaped synthetic fixture on the **preimage** objects reproduces the 4 stale paths and 6 missing pairs |
| Derivation | INSERT with upline; move A→B; TL1→TL2 (old TL loses access); remove to NULL (revoked); move a TL with grandchildren; depth-5 chain; re-parent a middle node; depth 25 (old 20-cap fixed) |
| Integrity | self-parent, 2-cycle (two statements and one multi-row statement), move under own descendant, cross-org upline (INSERT/UPDATE), org change stranding downline, invitation with cross-org / Deleted upline, depth > 100 — all rejected; deleted intermediate keeps ancestry flowing |
| Consistency | after every step `hierarchy_consistency()` = 0 missing, 0 extra, 0 stale; full ordered-pair truth table vs upline walk |
| No-op | unchanged-upline PATCH by TL and by Admin changes no row, before and after M2 |
| TL permissions (as `authenticated` with `request.jwt.claims`) | per module (leads, clients, recruits, calls, contact_emails, tasks, contact history, profiles UPDATE incl. `commission_level`): Agent, TL, Admin, Super Admin, Deleted TL with live JWT, cross-org TL — before M1, after M1, after M3; contacts delete toggle on/off; commission "View Others" toggle on/off (`access()` read only, never write) |
| RPCs | `get_contact_scope_agents`, `_contacts_filtered_leads` team, `performance_scope`, `create_client_with_sale` / `record_client_policy` / `update_client_with_policy_sale` TL downline allowed / non-downline refused, `delete_contact` toggle, `get_report_scope_v2('team')` identical before/after; parity `is_ancestor_of` vs `resolve_downline_ids` (documented Deleted difference) |
| Forged requests (PostgREST stage when `POSTGREST_BIN` is set, as `run_policy_commission_tests.sh`) | anon / authenticated `/rpc/compute_hierarchy_path` denied; anon `/rpc/is_ancestor_of` denied; authenticated cross-org `is_ancestor_of` false; PATCH `hierarchy_path` denied; cross-org / cyclic upline PATCH by Admin rejected; TL PATCH of downline upline / `commission_level` rejected; TL DELETE of downline lead (toggle off) and call rejected |
| Side effects | repair touches exactly the stale rows; `updated_at` bumped only there; `set_claim` stub = 2 per row; no UV/notify |
| Migrations | preimage guard refuses on drift; replay refused; M3 second run = 0 rows; M3 refuses at 5 stale rows; rollbacks restore exact preimage md5s; re-apply after rollback; ACL and `pg_depend` assertions |
| Concurrency | two sessions: concurrent X→Y / Y→X, insert under a moving node, ancestor login-sync during a reassignment (READ COMMITTED and REPEATABLE READ) |
| Regression | dispatch the existing suites (policy-sale-recording, policy-commission-tracking, reports-backend, reporting-integrity, contact-history-backend, lead-conversion-preservation, commission-grids, group-leaderboard, rls-phase1) |

Frontend (Vitest): picker excludes self/descendants and ignores table filters; upline sent only when changed;
commission level read-only for TL; HierarchyTree org filter, fail-closed, Deleted-intermediate traversal, error
state; UserTeamTab Deleted/error states; UserManagement TL/Agent requests carry an id constraint; CampaignDetail TL
filter; refreshed shared fixtures (TS + SQL T8 shapes generated from one data file).

Commands: `npx tsc --noEmit`, `npx tsc -p tsconfig.app.json` (compare with main), focused + full `npx vitest run`
(compare with main), ESLint `--max-warnings 0` on touched files, `npm run build`, `git diff --check`, the new runner
on local PG16 and CI PG 17.6. After each approved database change: read-back + Supabase security/performance
advisors compared with today's list (hierarchy entries expected to disappear: anon-executable
`compute_hierarchy_path`, `is_ancestor_of`, trigger functions; `on_profile_update` mutable search_path).

## 9. Release procedure (each step separately approved)

1. **Gate 1** — implement, test, commit, push, one draft PR. Stop.
2. **Gate 2a/2b preflight (read-only):** `list_migrations` head; preimage md5s; baseline counts (§1); f809493e still
   0 descendants; no new hierarchy writes since the snapshot. Apply M1 then M2 with `apply_migration`; read back
   bodies, ACLs, triggers, `pg_depend`, consistency (still 4 stale), advisors. Reconcile filenames to the stamped
   versions (`git mv`, forward bytes unchanged). Never `supabase db push` (baseline row unreconciled).
3. **Gate 2c preflight:** snapshot `(id8, hierarchy_path, updated_at)` of the stale rows into `verification.md`;
   re-count §4 deltas; Chris approves that exact set. Apply M3; post-check 15/15 pairs, 0 stale; re-run is a no-op.
4. **Gate 3:** merge (squash, expected-head guard) and confirm the Vercel production deployment; non-destructive
   smoke checks only.

## 10. Rollback strategy

| Step | Rollback | Notes |
|---|---|---|
| M1 | `rollback/20261023210000_….rollback.sql`: guarded by post-image md5s; restores the verbatim `is_ancestor_of` body; drops the commission guard and the 4 restrictive policies; **does not re-grant anon/PUBLIC** (repo convention: security revokes are re-assert-only) | ⚠ If M3 is live, rolling back M1 re-widens TL powers (downline deletes without toggle, `commission_level`, Deleted-TL access) |
| M2 | `rollback/20261023210100_….rollback.sql`: restores verbatim `compute`/`update`/`cascade` bodies and trigger DDL; drops builder, lock trigger, invitation guard, consistency function, index; keeps revokes and the `on_profile_update` search_path hardening | Repaired paths stay correct; only future edits regress to the old defects |
| M3 | No automatic data inverse (rolling back functions never removes granted authority). **Operational revocation:** an Admin reassigns the affected agents' upline (the fixed triggers revoke immediately) or changes the TL's role. Exact pre-repair values are recorded at Gate 2c; restoring them requires M2 rolled back first and a separately approved system UPDATE | |
| Frontend | Revert the PR / promote the previous Vercel deployment | |

## 11. Files to touch (Gate 1)

**Database (new files only; no applied migration edited):**
- `supabase/migrations/20261023210000_hierarchy_authorization_boundaries.sql`
- `supabase/migrations/20261023210100_hierarchy_integrity.sql`
- `supabase/migrations/20261023210200_hierarchy_path_repair.sql`
- `supabase/migrations/rollback/20261023210000_hierarchy_authorization_boundaries.rollback.sql`
- `supabase/migrations/rollback/20261023210100_hierarchy_integrity.rollback.sql`
- `supabase/migrations/rollback/20261023210200_hierarchy_path_repair.rollback.sql` (refusal stub + documented procedure)

**Tests / CI:**
- `scripts/hierarchy_fixture.py`, `scripts/run_hierarchy_stabilization_tests.sh`
- `supabase/tests/hierarchy_stabilization.sql`, `supabase/tests/hierarchy_stabilization_rls.sql`
- `scripts/tests/hierarchy_stabilization/postgrest_forged.mjs`
- `.github/workflows/hierarchy-stabilization.yml`
- Expectation/comment updates only: `supabase/tests/import_campaign_attachment.sql` (T4 now takes the "TL downline
  allowed" branch), `supabase/tests/p0_profile_authorization.sql` (outdated INFO notes),
  `supabase/tests/profile_book_stats_rpc.sql` (T8 shapes from the shared data file)

**Frontend:**
- `src/lib/supabase-users.ts`, `src/lib/profile-org-tree.ts`, new `src/lib/hierarchy/uplineCandidates.ts`
- `src/components/settings/HierarchyTree.tsx`, `src/components/settings/UserManagement.tsx`
- `src/components/settings/user-management/UserProfileModal.tsx`, `UserProfileTab.tsx`, `UserTeamTab.tsx`
- `src/pages/CampaignDetail.tsx`, `src/hooks/useContactScope.ts` (comment only)
- Tests: `src/lib/__tests__/agentScopeTraversal.test.ts`, `src/lib/profile-org-tree.test.ts`,
  `src/components/agent-profile/__tests__/profileContracts.test.ts`, new
  `src/components/settings/__tests__/hierarchyTree.test.tsx`,
  `src/components/settings/user-management/__tests__/{uplineCandidates,userTeamTab,userManagementScope}.test.tsx`,
  `src/lib/__tests__/hierarchyFixture.ts` (shared TS/SQL shapes)

**Docs:** `AGENT_RULES.md` (§3 Team Leader line; #20 hierarchy bullets; #26 "Known fail-closed behaviour"; Known
Tech Debt entry → new "Hierarchy integrity invariant"), `WORK_LOG.md` (newest first), `implementation_plan.md`,
`docs/plans/2026-10-23-hierarchy-stabilization/{implementation_plan.md, verification.md}`.

**Not touched:** Edge Functions (no deploy; `create-user` must not be redeployed), sale writers, commission
functions, Reports RPCs, `enforce_profile_field_authorization`, `handle_new_user`, `tasks_select_team_leader`,
applied migrations, Twilio/telephony.

## 12. Out of scope — recorded follow-ups

Owner-row delete bypass of the Contacts toggles for every role; calls non-core column edits (timestamps, status,
outcome) by any UPDATE-capable role; soft delete does not ban/revoke sessions; `handle_new_user` trusts signup
metadata; `tasks_select_team_leader` lacks the D3 status check (0 rows today); appointments TL scope keyed on the
inert `team_id`; task/appointment/import pickers direct-report only; `fetchTeamRoster` unbatched; agency-group
self-match in `is_agency_group_peer_organization`; `dialer_lead_locks_delete` without org filter;
`super_admin_all_users` anon-executable; legacy `'Team Lead'` literals; the wider SECURITY DEFINER advisor backlog
(57 anon-executable); migration-history filename drift; legacy `accept-invite`.
