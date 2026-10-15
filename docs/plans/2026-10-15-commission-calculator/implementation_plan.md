# Commission Calculator + agency commission grids — implementation plan

**Status (2026-10-15):** LOCAL IMPLEMENTATION APPROVED by Chris with amendments (D1–D4, corrections 1–6)
and **implemented locally** on `feature/commission-calculator-agency-grids` (commits `9b615f5` plan,
`fea545d` database layer, `44d550a` frontend, `fb27512` closeout records, `14d9fa4` pre-publication
`service_role` correction, then its records). Evidence: `verification.md`.
Nothing is pushed, published, merged, deployed, imported or applied to any hosted database. Production
access stays read-only (advisor reads included). **Not release-ready:** the private FFL import,
reconciliation and source-backed acceptance are BLOCKED on the CSV (D4) and on a named durable private
location (D1), and the PostgreSQL 17.6 CI workflow has not run yet. Release needs a separate, exact approval
of the consolidated release proposal (§12).

**Base:** `origin/main` `dacd921903a867de99276f8709f829995602c3bd`. **Branch:** `feature/commission-calculator-agency-grids`
(one branch, intended for one PR).

This document is public. It contains no compensation data: no rates, no carrier/product names from the
private source, no source notes and no carrier-specific acceptance expectations (D1).

---

## 1. Scope

Agents estimate first-year commission from their agency's selected grid and their own existing contract
level. Agency Admins enable/disable AgentFlow shared grids for their own agency, choose the agency's
calculator grid, and create/edit private grids. Estimate tool only: not a ledger, payroll, underwriting or
reporting source.

Out of scope and untouched: policies, reporting, leaderboards, contract-level editing (see §11 follow-up),
telephony/TwilioContext, authentication architecture, existing RLS/helpers/roles, CRM-wide carriers,
platform/Control Center surfaces.

## 2. Decisions and amendments (2026-10-15)

| Item | Decision |
|---|---|
| **D1** | Real FFL source stays private. Never in Git, public CI logs/artifacts, PR text, screenshots or public docs — including the eight carrier-specific acceptance expectations. Commit schema/operation migrations, the reusable importer/validator, synthetic tests and a non-sensitive manifest. Reference DATA loads through a documented, transactional private-import workflow (§7); all DDL stays in ordinary committed migrations; no production-only migration, no public substitute for private SQL, no fabricated migration history. A durable private location for the original input and exact artifact must be named before release. Repository visibility unchanged. |
| **D2** | `#APPROVE_RLS_CHANGE` for authoring and LOCAL TESTING of the new compensation tables' functions/triggers/grants/policies only. No existing policy/helper/role change; no production application. Exception documented by name: **Shared compensation grid exception**. |
| **D3** | The calculator's navigation and route gate respect the existing "View Own Commission Percentage" permission (screen-level, like `CommissionGate`; not a database secrecy claim). The eligible-grid RLS model is unchanged. Grid management keeps its own Agency Admin gate. Neither surface joins View As. |
| **D4** | The actual CSV is still required. Until it arrives: private import/reconciliation and source-backed acceptance are **BLOCKED**; the 57/41/11 inventory is unverified; the feature is not release-ready. Everything else proceeds on synthetic data. |
| C1 | Authorization and locking proven in a disposable loopback database before building on them (§4.5). |
| C2 | Every write path covered, direct table operations included; deterministic concurrency tests (§9.2). |
| C3 | Unsaved-editor data loss closed for settings-section changes, sidebar navigation, browser back/forward and reload/close (§8.3). |
| C4 | Contract-level self-edit recorded as a separate follow-up only (§11). |
| C5 | Verification against a fresh base with diagnostic-level comparison (§9.4). PG16 local ≠ PG17.6 CI. |
| C6 | Initial activation for Family First Life - Chris Garness only, by exact unique name at execution; other Agency Admins may self-enable after release (agency self-service, not a pilot). |

## 3. Shared compensation grid exception (named)

AGENT_RULES §3: every tenant row carries `organization_id`. This feature adds one narrowly scoped
exception: AgentFlow-maintained **shared** grids store `organization_id = NULL` on the grid and on all of its
products, variants, rates and references. They are readable only by organizations holding an
`organization_comp_grids` row, never writable by any client role (`service_role` holds SELECT only), and
changed only by the reviewed reference-import operation or a reviewed migration. Private grids, access rows and settings are ordinary
tenant rows. No platform-role requirement, Control Center surface, cross-agency Super Admin bypass or
Agency Group peer access.

## 4. Database design (as proven locally)

### 4.1 Tables (all RLS-enabled)
`comp_grids`, `comp_products`, `comp_product_variants`, `comp_rates`, `comp_variant_references`
(protected source/notes), `organization_comp_grids` (agency access to a shared grid),
`organization_comp_settings` (one row per agency; `calculator_grid_id` NULL = not configured) and
`comp_reference_imports` (server-only import ledger: checksums, importer version, target grid, counts,
verification — never values).

- **Scope key.** Every table carries `scope_key`, a STORED generated column
  `COALESCE(organization_id, nil-UUID)` (not client-writable). The nil UUID is reserved (CHECK on every
  table; the migration refuses an existing nil organization), so `scope_key = nil ⇔ organization_id IS NULL`.
  Composite FKs on `(parent_id, grid_id, scope_key)` force every child to match its parent's grid and
  scope, NULL case included; access rows FK to `(grid_id, nil)` so they can only reference shared grids.
- **Rates.** `rate_percent numeric` (unconstrained) with `CHECK (0 ≤ x ≤ 300 AND x = round(x, 2))`:
  excess precision is rejected, never rounded (`numeric(6,2)` would round before any check). Absent row =
  unavailable; stored 0 = valid zero.
- **Levels.** Non-empty, 1–999, no NULLs (CHECK); strictly descending (trigger). Rate level must be on its
  grid; a level cannot be removed while rates remain at it.
- **Variants.** Ages 0–100, min ≤ max, `term_years` NULL = not applicable (never empty). Deferred,
  product-locked rule: no two variants of a product match the same (age, term); no mixed term/non-term
  variants; blank label only on a single-variant product; distinct term lengths.
- **Provenance.** `origin` (`agentflow_reference` only when shared; `blank`/`structure_copy`/`full_copy`
  otherwise), `copied_from_grid_id`, server stamps (`created_at`, `updated_at`, `updated_by = auth.uid()`;
  NULL for import/ops — no invented user), `revision` bumped by every grid or content change.

### 4.2 Access
- **Reads (RLS).** Grids: caller's private grids + shared grids the agency enabled; agents active only,
  admins also inactive. Products: active only for agents. Variants/rates: of readable products. References:
  agency admins only. Access/settings rows: own organization.
- **Writes.** Clients never write the tables directly: RLS write policies and an operation-context trigger
  (fires first, before any lock) require `agentflow.comp_operation = 'on'`, which only the comp operations
  set through a function-level `SET` clause (restored on return; PostgREST/clients cannot set custom
  settings). Inside an operation the same RLS still applies: agency admin, own organization, private rows
  only (`organization_id = actor org` can never match a shared NULL row). The operation-context trigger
  checks that same predicate itself (an INSERT's RLS check runs only after BEFORE ROW triggers), so no
  SECURITY DEFINER trigger ever runs or locks for a client row outside its agency or by a non-admin; and
  every DEFINER lock lookup is filtered to shared grids or the row's own scope. `service_role` (server key,
  BYPASSRLS) holds SELECT only on every comp table, so server code cannot write commission data directly
  either.
- **Actor.** `comp_authz.actor_org_id()` / `actor_is_admin()` / `readable_grid_ids()` wrap the canonical
  `private.campaign_actor()` (Active profile, profile org = `get_org_id()`); agency admin = Admin / Super
  Admin role or `is_super_admin`, home organization only. Team Leaders and agents are read-only.
- **SECURITY DEFINER (minimal, each negative-tested):** the three `comp_authz` caller predicates (they must
  call `campaign_actor`, which clients cannot execute — AGENT_RULES #34 forbids a second resolver); the
  metadata-only shared-grid catalog (RLS cannot show four columns of a row and hide the rest); and trigger
  functions in `private` (never client-callable) that lock or clean rows a caller cannot lock itself. Pinned
  `search_path`, PUBLIC/anon revoked. Every client operation is SECURITY INVOKER.

### 4.3 Operations (`EXECUTE` to `authenticated` only)
`get_commission_calculator_status`, `get_commission_calculator_context` (one snapshot; rates as exact
text; caller's own raw level; never notes), `comp_list_shared_grid_catalog` (DEFINER, admin, metadata
only), `comp_get_admin_overview`, `comp_get_grid_snapshot`, `comp_enable_shared_grid` (retry-safe;
selects only when nothing is selected), `comp_disable_shared_grid` (clears only its own selection),
`comp_select_calculator_grid` (compare-and-set), `comp_create_private_grid` (blank / structure: zero rate
rows / full: levels, structure, every rate, references; enabled source only; destination = caller's org),
`comp_save_grid_changes` (atomic changeset at an expected revision; stale ⇒ PT409),
`comp_delete_private_grid`. Errors: 42501 not permitted · PT404 not available · PT409 stale/conflict ·
22023 invalid request · 23xxx validation.

Privileged, postgres-only (never client-callable): `private.comp_import_reference_grid`,
`private.comp_grid_content_sha256`, `private.comp_set_reference_grid_active`,
`private.comp_enable_reference_grid_for_agency`.

### 4.4 Lock order and snapshots
Every agency write operation first creates (if needed) and locks its `organization_comp_settings` row (the
agency's comp-write mutex), then: grid row(s) → access row → product row → child rows. Every child write
locks its grid row first (trigger), and the grid level/revision rules run against the locked row. Shared
grid rows are locked only by privileged triggers on behalf of an authorized operation (copy source, calculator
selection, enable). Locking reads re-fetch the newest committed row after a wait; every check that follows
a lock runs as a later statement, so it reads after the lock. Privileged multi-agency deactivation
(`comp_set_reference_grid_active`) locks the referencing settings rows (ordered by organization) before the
grid. Production isolation is READ COMMITTED (read-only check 2026-10-15).

### 4.5 Local design proof (C1) — PostgreSQL 16, loopback only, synthetic data, real non-bypass roles
Proven before building on it: an agency admin cannot lock a shared grid row even with the operation flag
forged in a test session (0 rows); copy/enable/select coordinate through privileged triggers; an agency
that has not enabled a grid can neither copy nor select it; constraints alone (as table owner, RLS bypassed)
refuse a private row under a shared grid, the nil sentinel as an organization, 87.555, an off-grid level,
level removal with rates, and overlapping variants. Found and fixed during the proof: `INSERT … RETURNING`
of a new grid fails the grid SELECT policy (its readable list is computed before the insert), so operations
generate the id themselves; copies run as separate statements after the source lock instead of one
`RETURNING` chain.

Found and fixed while implementing (each now covered by a test or a negative control):
- With the operation flag forged in a test session (a stand-in for a buggy operation), a DEFINER trigger
  could briefly lock a row the client may not write (an INSERT's RLS check runs after BEFORE triggers).
  Fixed by the operation-context trigger's own agency/admin check and scope-filtered DEFINER lookups.
- `comp_save_grid_changes`: a rate cell naming another grid's variant reached `ON CONFLICT DO UPDATE`,
  which locks the conflicting (shared) row before RLS refuses it. Every cell must now belong to the grid
  first (else PT409); keys must name new items of the same change set (else 22023).
- The import's no-op path accepted a modified artifact whose embedded checksums still matched. A no-op now
  requires the byte-identical artifact (ledger `artifact_sha256`) and unchanged stored content.
- (Pre-publication review.) `service_role` held plain INSERT/UPDATE/DELETE on the seven data tables, so a
  server key could change a shared grid outside the import, contrary to §3. It now holds SELECT only (A9,
  A10g). I1 now covers anon, an agent, an Agency Admin and `service_role`, each also with both operator
  approval settings and a forged operation flag.

## 5. Calculator logic (`src/lib/commission/`, pure)
Strict level parse (`^\s*\d+%?\s*$`; missing/fractional/partial ⇒ setup error; never defaulted, nearest-
matched, raised or written back; valid but off-grid ⇒ "Your contract level isn't on your agency's comp
grid. Ask your admin."). Matching: inclusive ages (NULL = unbounded side); explicit term membership; states
no-age / unsupported term / unsupported age-term combination / no rate at level / ambiguous (configuration
error, no estimate) / present zero = $0 estimate. Exact BigInt rational arithmetic; cents rounding (half-up)
for display only; the 75 % advance and Months 10–12 are illustrative assumptions.

## 6. Frontend
- **Calculator** `/commission-calculator`; nav item "Commission Calculator" directly below Resources, shown
  only when status is `ready`, the role may "View Own Commission Percentage" (D3) and not under View As (no
  query issued under View As). The page re-checks the same conditions itself. States: loading, no
  permission, not configured, level missing/malformed, level not on grid, unavailable rate, load error.
  Inputs, resets, Zod validation and the exact disclaimer as specified; results derived on every render.
- **Settings › Agency & Team › Commission Grids** (agency admins only; registered in an admin-only list so
  it never inherits the Agent/Team Leader defaults). Calculator grid select, AgentFlow grid catalog
  (enable/disable, read-only view, duplicate), private grids (create blank/structure/full, edit, delete),
  editor (details, levels, carriers/products, variants with protected notes, rate matrix, one atomic Save,
  conflict banner, last edited by/at).
- Data via TanStack Query keyed by the real user and organization; no polling; no fallback data.

## 7. Private reference-import workflow (D1)
1. **Validate** (`scripts/comp_grids/reference_grid_importer.py validate`): Python `csv` + `Decimal` (no
   line-oriented parsing, #29). Exact header set; category mapping; identity = category + carrier + product;
   duplicates/conflicts; ages; terms; rate syntax and range; blank vs explicit 0; overlaps and mixed terms;
   whitespace/encoding anomalies flagged, never repaired; counts; SHA-256. Any anomaly stops the import.
   Output only to an ignored/private location.
2. **Build** a deterministic artifact (JSON) with deterministic ids, expected counts and an independently
   computed content hash. Same CSV + same importer version ⇒ byte-identical artifact.
3. **Load** with `private.comp_import_reference_grid(artifact_text, artifact_sha256)`: verifies the artifact
   hash, validates, inserts in one transaction, re-verifies counts and the canonical content hash, runs the
   variant rules, and records the ledger row. Re-running the same artifact is a no-op; different content for
   an existing grid is refused (drift), never overwritten.
4. **Reconcile** locally: PostgreSQL `\copy` loads the CSV into a staging table and every field and rate is
   compared with the stored rows in both directions; only counts and PASS/FAIL are printed.
5. **Verify in production (release step, read-only):** ledger row + recomputed content hash equal the
   private manifest.
The original CSV and the exact artifact must live in a durable private location Chris names before release.
The committed manifest holds only non-sensitive values (checksums, importer version, target grid id,
counts, verification status).

## 8. Integration details

### 8.1 Final intended files (listed before editing)
**New (database and tooling):**
`supabase/migrations/20261015120000_commission_grids_schema.sql`,
`supabase/migrations/20261015120100_commission_grids_operations.sql`,
`supabase/migrations/20261015120200_commission_grids_reference_import.sql`, their three
`supabase/migrations/rollback/*.rollback.sql`, `supabase/ops/commission_grids_activate_home_agency.sql`,
`supabase/tests/commission_grids_{harness,schema,access,operations,import}.sql`,
`supabase/tests/fixtures/commission_grids/*` (synthetic only), `scripts/run_commission_grids_tests.sh`,
`scripts/commission_grids_concurrency.mjs`, `scripts/comp_grids/reference_grid_importer.py`,
`scripts/tests/comp_grids/test_reference_grid_importer.py`, `.github/workflows/commission-grids.yml`,
`docs/plans/2026-10-15-commission-calculator/{implementation_plan.md,reference-import-runbook.md,reference-import-manifest.json,verification.md}`.

**New (frontend):** `src/lib/commission/*` (+ tests), `src/hooks/useCommissionCalculator.ts`,
`src/hooks/useCommissionGridsAdmin.ts`, `src/hooks/useGridEditorDraft.ts`,
`src/hooks/useUnsavedNavigationGuard.ts`, `src/pages/CommissionCalculatorPage.tsx`,
`src/components/commission/calculator/*`, `src/components/layout/CommissionCalculatorNavItem.tsx`,
`src/components/settings/commission-grids/*` (+ tests).

**Modified (surgical):** `src/App.tsx` (+1 route), `src/components/layout/Sidebar.tsx` (nav item + admin-only
settings entry), `src/config/settingsConfig.ts` (admin-only section list), `src/pages/SettingsPage.tsx`
(title lookup), `src/components/settings/SettingsRenderer.tsx` (+1 case),
`src/integrations/supabase/types.ts` (new function signatures), `src/components/layout/__tests__/viewAsSidebarNav.test.tsx`,
`src/pages/__tests__/settingsPageHeading.test.tsx`, `.gitignore` (private input/output only),
`implementation_plan.md`, `WORK_LOG.md`, `AGENT_RULES.md`.

**Not touched:** `permissionDefaults.ts` and `usePermissions.ts` (hash-pinned), `viewAsSurfaces.ts`,
`UnsavedChangesContext.tsx`, telephony, auth, reporting, profile authorization, existing migrations.

**As built (differences from the list above):** added `supabase/ops/commission_grids_import_reference_grid.sql`
(the reviewed operator script for step 7.3, approval-setting guarded) and `scripts/comp_grids/reconcile_reference_grid.sql`
(step 7.4), plus test files under the listed test paths (`src/hooks/__tests__/useUnsavedNavigationGuard.test.tsx`,
`src/pages/__tests__/commissionCalculatorPage.test.tsx`, and the change-set contract test
`src/lib/commission/__tests__/changeSetServer.integration.test.ts`, which runs only against the runner's disposable
database). `AGENT_RULES.md` §3: the Control Center sentence "the one approved exception" now reads "an approved,
named exception" so that adding the named Shared compensation grid exception keeps it accurate.

### 8.2 Concurrent work
Open PRs overlapping textually only: #442 (Google Sheets: settings config/renderer/heading test/docs), #445
(SMS: `src/App.tsx` +2 lines, docs), #398 (standalone underwriting app; not reused).

### 8.3 Unsaved-changes integration (C3)
The editor registers with the existing `useUnsavedChanges().registerDirty` and adds one local hook,
`useUnsavedNavigationGuard`, active only while the draft is dirty: it intercepts every in-app navigation
through React Router's navigator (`UNSAFE_NavigationContext`, the standard BrowserRouter blocker
technique — covers sidebar links, settings-section changes via `setSearchParams`, Back to App and any
`navigate()`), blocks browser back/forward with a capture-phase `popstate` guard that restores the entry,
and sets a `beforeunload` prompt for reload/close (browser-controlled wording). Leave/Stay confirmation
reuses the existing dialog wording. No router replacement, no global framework, no draft persistence.
No additional integration file is needed beyond the new hook.

## 9. Verification plan

### 9.1 Environments
Disposable PostgreSQL 16 cluster on 127.0.0.1 (container's postgres user home, removed afterwards), synthetic
data only; the runner proves locality and refuses Supabase-role clusters. CI workflow on PostgreSQL 17.6
(production major) — not claimed until it actually runs. No hosted database is touched.

### 9.2 Database suites (as `authenticated`/`anon`/`service_role`, never only as owner)
Permission matrix (agent, Team Leader, agency admin, home-org super admin, inactive, stale/forged claims,
other agency, anon); catalog-only before enablement; enable/disable own agency only; private edits vs
shared/foreign grids; forged organization/parent/ownership; spoofed audit columns; direct table writes on
every table; references hidden from agents. Behavior: enable keeps a selection, disable clears only its own,
structure copy = 0 rate rows, full copy = all values with new ids, injected copy failure leaves nothing,
precision/overlap/level/stale-revision rejections, import idempotency/drift/transactionality, activation
script. **Deterministic concurrency** (independent sessions, waits proven via `pg_stat_activity`, no sleeps):
first-time enable/select with no settings row; two overlapping variants; rate writes vs level removal;
selection/copy vs disable/deactivate/delete; source edits vs copying; shared deactivation across several
agencies. Negative controls prove the assertions bite.

### 9.3 Frontend
Pure-module units; component tests (nav order and visibility, D3, View As, route gate, input resets,
identity/organization switch, settings gating, editor conflict and unsaved-changes guard); build-output scan
(no private input or values ship); synthetic renders at 390/1440 px.

### 9.4 Baseline (fresh, 2026-10-15)
`npx tsc --noEmit` exit 0 (solution tsconfig, vacuous); `npx tsc -p tsconfig.app.json --noEmit` 85
diagnostics, exit 2 — full diagnostic text saved for set comparison. Final comparison by file/code/message,
plus vitest failures base vs branch, reported separately.

## 10. Status / blockers
- **BLOCKED:** private FFL import/reconciliation and source-backed acceptance (CSV not supplied; D4); durable
  private location for input/artifact (D1, before release).
- **Not yet run:** the PostgreSQL 17.6 CI workflow (`.github/workflows/commission-grids.yml`) — it runs only once
  the branch is published. Local proofs ran on PostgreSQL 16.15.
- Not release-ready until those are resolved and §12 is approved.

## 11. Separate follow-up (not in this build)
`profiles.commission_level` is self-editable through the API: `authenticated` holds column UPDATE, 
`profile_authz.can_update_profile` returns true for the actor's own row, and
`enforce_profile_field_authorization` does not cover the column (read-only production checks, 2026-10-15).
The onboarding wizard writes it intentionally (`useOnboardingPageFlow.ts`). An agent can therefore change the
level their own estimate uses. Needs its own approved change; nothing here alters profiles, onboarding or
stored levels.

## 12. Consolidated release proposal (prepared 2026-10-15; NOTHING EXECUTED)
Each numbered action needs Chris's explicit approval of that exact action, target and checksum. They may be
approved together as one release package. Local implementation approval is not release approval.
Target: production Supabase `jncvvsvckxhqgqvkppmj` (AGENTFLOW CRM) and the production Vercel project.

**0. Publication (separate approval, before anything below).** Push `feature/commission-calculator-agency-grids`
and open ONE pull request. This triggers automated previews and CI, including the PostgreSQL 17.6 workflow.
No production effect.

**Prerequisites. Every one must hold before step 1:**
- P1. The CSV has been supplied and preserved byte-for-byte in the durable private location Chris names.
  Locally on a disposable database: validated with zero anomalies; the inventory confirmed (41/57/11, or any
  difference explicitly accepted by Chris, never edited away); the artifact built and verified; imported;
  reconciliation PASS; private acceptance PASS. The manifest is updated with the non-sensitive values.
- P2. PR reviewed and approved; CI green on the exact head, including PostgreSQL 17.6.
- P3. Read-only production prechecks, immediately before step 1:
  - migration history (none newer than the comp files);
  - no `comp_*` / `comp_authz` objects exist;
  - no organization uses the nil UUID;
  - `private.campaign_actor()` and `public.get_org_id()` match the bodies used in testing;
  - exactly one organization is named *Family First Life - Chris Garness*.

**1–3. Migrations.** Apply these exact files, in this order, through the repository's migration workflow.
Record the version each one is assigned next to its file name; never fabricate or repair history.

| # | File | SHA-256 |
|---|---|---|
| 1 | `supabase/migrations/20261015120000_commission_grids_schema.sql` | `84637cf30480ed41d529ab9f0902f4fb44a3fa0141c5c5792594898ce1f64b16` |
| 2 | `supabase/migrations/20261015120100_commission_grids_operations.sql` | `d7c20e1712c958d8af516884edd730004af72adc2f50f0e323adefd5b96e7bc3` |
| 3 | `supabase/migrations/20261015120200_commission_grids_reference_import.sql` | `b8b2836be6c6dc37d0ccdf82f541e62b93bb507577d3d2394078cf7aa4c55ae9` |

(Checksums are for the files at local commit `14d9fa4`. Re-verify them on the approved PR head.)

**4. Read-only verification.**
- Objects, grants, policies and the SECURITY DEFINER inventory match the access-suite inventories (A10).
- Run the Supabase security and performance advisors. New findings are triaged and reported separately.

**5. Private import.** Run `supabase/ops/commission_grids_import_reference_grid.sql`
(SHA-256 `d2825d4112b9da15f0556ac6c2e84b3158c1984d28d9cde33e3783e98812e1aa`):
- who runs it, and from where, is decided in the release plan; the artifact's values are never printed into
  logs, PR text or shared transcripts;
- use the exact artifact from the private location, with `artifact_sha256` set to the manifest value;
- set `agentflow.approve_comp_reference_import=yes`.

Expected: `status = imported` for grid `6ad6d4e4-4024-5dae-bef5-de0202ab1b6e`. A re-run returns `already_imported`.

**6. Read-only verification.**
- One ledger row.
- `private.comp_grid_content_sha256('6ad6d4e4-4024-5dae-bef5-de0202ab1b6e')` equals the manifest `content_sha256`.
- Counts equal the manifest.

**7. Activation.** Run `supabase/ops/commission_grids_activate_home_agency.sql`
(SHA-256 `47f91f707e12e14c480a6f0e05d881139de92c5bb518973a9c258039150aa069`) with
`agentflow.approve_comp_home_activation=yes`.
- The agency is resolved by exact unique name at execution.
- It selects the grid only if the agency has no selection. An existing selection is reported, never overwritten.
- No other agency is activated. Other Agency Admins may later opt in themselves (C6).

**8. Frontend.** Merge the approved PR, then deploy that exact merge commit to production. Record the commit
and the deployment id.

**9. Post-release verification.**
- The served entry asset.
- Signed-in checks:
  - a home-agency agent sees "Commission Calculator" directly below Resources and gets an estimate;
  - an agency admin sees Settings › Commission Grids;
  - an agent whose role lacks "View Own Commission Percentage" sees neither;
  - another agency sees nothing until its own admin enables a grid.
- Advisors again.

**Non-destructive rollback (each step separately approved).**
- (a) Frontend: redeploy or promote the previous production deployment, or revert the merge commit. The
  calculator and settings UI disappear and data stays.
- (b) Calculator off without code changes: an agency admin chooses "None — calculator off". For every agency:
  `private.comp_set_reference_grid_active('6ad6d4e4-…', false)`. This clears every selection of that grid and
  keeps all data and access rows. Reverse it with `true`; selections are then not restored automatically.
- (c) Database: leave the tables dormant. The rollback files in `supabase/migrations/rollback/` run only in
  reverse order. The two function rollbacks (120200, then 120100) drop functions only and delete no row. The
  schema rollback refuses while any row exists. Never delete data to make it pass.

**Not part of this release:**
- profile, onboarding or contract-level changes (§11 follow-up);
- any other agency's activation;
- CI or Vercel configuration changes;
- the CSV or any generated data in Git.
