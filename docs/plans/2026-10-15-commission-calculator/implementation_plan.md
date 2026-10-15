# Commission Calculator + agency commission grids — implementation plan

**Status (2026-10-15):** LOCAL IMPLEMENTATION APPROVED by Chris with amendments (D1–D4, corrections 1–6)
and **implemented locally** on `feature/commission-calculator-agency-grids` (commits `9b615f5` plan,
`fea545d` database layer, `44d550a` frontend, `fb27512` closeout records, `14d9fa4` pre-publication
`service_role` correction, then its records). Evidence: `verification.md`.
**Published 2026-10-15 as draft PR #447** (Chris approved draft publication only). The first published head was
`3971fd0`, after merging `main` twice (#445, #446) to resolve `WORK_LOG.md` conflicts. Then came the approved CI
corrections in §10, `2db6de2` (collation and whitespace) and the runner's `NO_COLOR` setting, each with its status
records. After independent review came the approved two-finding correction in §10: unsaved drafts survive
failed background reads, and deletion requires a revision. It changed the operations migration's checksum (§12).
Nothing is merged, deployed, imported or applied to any hosted
database; Supabase Preview did not run (the project is at its concurrent preview-branch limit). Production
access stays read-only (advisor reads included). **Real-data validation passed locally (2026-10-15):** Chris
supplied the CSV (D4). Validation, the deterministic artifact, import into disposable loopback databases,
bidirectional reconciliation and source-backed acceptance all passed (§10; value-free results in
`verification.md` and the manifest). `main` (#448) was merged into the branch to clear a `WORK_LOG.md`
conflict. **Shared-grid availability (D5, 2026-10-15):** a shared grid now reaches only the agencies AgentFlow
makes it available to; at launch the FFL Compensation Grid is available to *Family First Life - Chris Garness*
only. The three unapplied migrations were corrected in place and re-verified, the real-data rehearsal was
re-run, and §12 gained the availability step and the new checksums (§10). **Not yet released:** a durable
private location (D1) must be named, and the release needs Chris's separate, exact approval of the release
package (§12).

**Base:** `origin/main` `dacd921903a867de99276f8709f829995602c3bd`. **Branch:** `feature/commission-calculator-agency-grids`
(one branch, intended for one PR).

This document is public. It contains no compensation data: no rates, no carrier/product names from the
private source, no source notes and no carrier-specific acceptance expectations (D1).

---

## 1. Scope

Agents estimate first-year commission from their agency's selected grid and their own existing contract
level. Agency Admins enable/disable, for their own agency, the AgentFlow shared grids AgentFlow has made
available to it (D5), choose the agency's calculator grid, and create/edit private grids. Estimate tool only: not a ledger, payroll, underwriting or
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
| **D4** | The actual CSV is still required. Until it arrives: private import/reconciliation and source-backed acceptance are **BLOCKED**; the 57/41/11 inventory is unverified; the feature is not release-ready. Everything else proceeds on synthetic data. **Update 2026-10-15:** the CSV was supplied; the private checks passed locally (§10). |
| C1 | Authorization and locking proven in a disposable loopback database before building on them (§4.5). |
| C2 | Every write path covered, direct table operations included; deterministic concurrency tests (§9.2). |
| C3 | Unsaved-editor data loss closed for settings-section changes, sidebar navigation, browser back/forward and reload/close (§8.3). |
| C4 | Contract-level self-edit recorded as a separate follow-up only (§11). |
| C5 | Verification against a fresh base with diagnostic-level comparison (§9.4). PG16 local ≠ PG17.6 CI. |
| C6 | Initial activation for Family First Life - Chris Garness only, by exact unique name at execution; other Agency Admins may self-enable after release (agency self-service, not a pilot). **Amended by D5 (2026-10-15):** the self-service clause is superseded; another agency can enable a shared grid only after AgentFlow makes it available to that agency. |
| **D6** | **Production operation authority (2026-10-15).** Managed production rejected the original function-level custom-GUC SET with 42501 even for non-superuser postgres. Migration 1 is production history as 20261015211858 and stays byte-identical. The still-unapplied operations migration forward-corrects the schema to a NOLOGIN/NOBYPASSRLS `agentflow_comp_operator` role. Only postgres is a member; anon/authenticated/service_role are not. Authenticated has no comp-table writes; six SECURITY DEFINER write RPCs owned by the role remain RLS/actor scoped. No call-stack/query-text/GUC authorization. |
| **D5** | **Shared-grid availability (Chris, 2026-10-15).** Being an Agency Admin does not make an AgentFlow shared grid available to an agency. The concepts are separate: (1) the grid exists in AgentFlow; (2) it is AVAILABLE to a specific organization, a database-authoritative row written only by reviewed postgres-only operations; (3) that organization's Admin chooses to ENABLE and select it. Other agencies cannot see an unavailable grid in the catalog, enable it, read its products, variants, rates or references, or copy it, even by id. At launch, the FFL Compensation Grid is available only to *Family First Life - Chris Garness*. No platform-role, Control Center or Super Admin path. Disabling keeps availability; removing availability clears enabled access and the calculator selection without touching private copies. |

## 3. Shared compensation grid exception (named)

AGENT_RULES §3: every tenant row carries `organization_id`. This feature adds one narrowly scoped
exception: AgentFlow-maintained **shared** grids store `organization_id = NULL` on the grid and on all of its
products, variants, rates and references. They are readable only by organizations holding an
`organization_comp_grids` row, which in turn requires an `organization_comp_grid_availability` row that only
reviewed postgres-only operations write (D5). They are never writable by any client role (`service_role` holds
SELECT only), and are changed only by the reviewed reference-import operation or a reviewed migration. Private
grids, availability rows, access rows and settings are ordinary tenant rows. No platform-role requirement, Control Center surface, cross-agency Super Admin bypass or
Agency Group peer access.

## 4. Database design (as proven locally)

### 4.1 Tables (all RLS-enabled)
`comp_grids`, `comp_products`, `comp_product_variants`, `comp_rates`, `comp_variant_references`
(protected source/notes), `organization_comp_grid_availability` (server-only: which agencies AgentFlow has
made a shared grid available to, D5), `organization_comp_grids` (agency access to an available shared grid),
`organization_comp_settings` (one row per agency; `calculator_grid_id` NULL = not configured) and
`comp_reference_imports` (server-only import ledger: checksums, importer version, target grid, counts,
verification — never values).

- **Scope key.** Every table carries `scope_key`, a STORED generated column
  `COALESCE(organization_id, nil-UUID)` (not client-writable). The nil UUID is reserved (CHECK on every
  table; the migration refuses an existing nil organization), so `scope_key = nil ⇔ organization_id IS NULL`.
  Composite FKs on `(parent_id, grid_id, scope_key)` force every child to match its parent's grid and
  scope, NULL case included; availability and access rows FK to `(grid_id, nil)` so they can only reference
  shared grids, and an access row also FKs to its availability row (`ON DELETE CASCADE`).
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
  agency admins only. Access/settings rows: own organization. Availability rows: no client read at all; an
  agency admin sees what is available to the agency only through the catalog (D5).
- **Writes.** Clients never write the tables directly: RLS write policies and an operation-context trigger
  (fires first, before any lock) require `agentflow.comp_operation = 'on'`, which only the comp operations
  set through a function-level `SET` clause (restored on return; PostgREST/clients cannot set custom
  settings). Inside an operation the same RLS still applies: agency admin, own organization, private rows
  only (`organization_id = actor org` can never match a shared NULL row). The operation-context trigger
  checks that same predicate itself (an INSERT's RLS check runs only after BEFORE ROW triggers), so no
  SECURITY DEFINER trigger ever runs or locks for a client row outside its agency or by a non-admin; and
  every DEFINER lock lookup is filtered to shared grids or the row's own scope. `service_role` (server key,
  BYPASSRLS) holds SELECT only on every comp table, so server code cannot write commission data directly
  either. Availability rows have no client privilege at all and are written only by the postgres-only
  availability functions (§4.3); the access trigger refuses an enable without availability (PT404), for every
  writer.
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
only; only the active shared grids available to the caller's agency), `comp_get_admin_overview`,
`comp_get_grid_snapshot`, `comp_enable_shared_grid` (retry-safe; an available grid only, else PT404 even by
id; selects only when nothing is selected), `comp_disable_shared_grid` (clears only its own selection),
`comp_select_calculator_grid` (compare-and-set), `comp_create_private_grid` (blank / structure: zero rate
rows / full: levels, structure, every rate, references; enabled source only; destination = caller's org),
`comp_save_grid_changes` (atomic changeset at an expected revision; stale ⇒ PT409),
`comp_delete_private_grid`. Errors: 42501 not permitted · PT404 not available · PT409 stale/conflict ·
22023 invalid request · 23xxx validation.

Privileged, postgres-only (never client-callable): `private.comp_import_reference_grid`,
`private.comp_grid_content_sha256`, `private.comp_set_reference_grid_active`,
`private.comp_agency_by_exact_name`, `private.comp_make_reference_grid_available` (one agency by exact unique
name; a verified import required; retry-safe), `private.comp_remove_reference_grid_availability` (removes the
agency's access and clears its selection of the grid; private copies untouched; a no-op writes nothing) and
`private.comp_enable_reference_grid_for_agency` (the grid must already be available).

### 4.4 Lock order and snapshots
Every agency write operation first creates (if needed) and locks its `organization_comp_settings` row (the
agency's comp-write mutex), then: grid row(s) → availability row → access row → product row → child rows. Every child write
locks its grid row first (trigger), and the grid level/revision rules run against the locked row. Shared
grid rows are locked only by privileged triggers on behalf of an authorized operation (copy source, calculator
selection, enable). Locking reads re-fetch the newest committed row after a wait; every check that follows
a lock runs as a later statement, so it reads after the lock. Privileged multi-agency deactivation
(`comp_set_reference_grid_active`) locks the referencing settings rows (ordered by organization) before the
grid. Withdrawing availability locks that agency's settings row before deleting the availability row, so it
serializes with the agency's enable, select and copy (concurrency scenario 9). Production isolation is READ
COMMITTED (read-only check 2026-10-15).

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
6. **Make available, then activate (release steps 7a and 7b, D5):** the availability script names the one
   agency by exact unique name; the activation script then enables the grid for it and selects it only if
   nothing is selected. Activation is refused while the grid is not available.
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
`.gitattributes` (CI correction): one path-scoped rule keeps the synthetic CSV fixture's intentional CRLF bytes
and stops `git diff --check` flagging its CRs. Independent-review correction (§10): the new
`src/components/settings/commission-grids/LoadErrorNotice.tsx` (23 lines) and
`src/components/settings/commission-grids/__tests__/draftPreservation.test.tsx`; the existing settings test's
hook mock gained the access hook that the section now keys on. Availability correction (D5, §10): the new
`supabase/ops/commission_grids_make_available_home_agency.sql`; no other new file and no frontend change.

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
- **Private FFL validation: PASSED locally (2026-10-15; was BLOCKED on D4).** Chris supplied the CSV; its
  SHA-256 equals the expected `998307b4…`. Everything ran outside Git, against disposable loopback databases
  only. Public records carry hashes, counts and PASS/FAIL only (D1).
  - *Validation.* Importer 1.0.0: 0 anomalies; 41 products, 57 variants, 11 carriers, 963 rate cells, 57
    references. An independent check that does not use the importer: 49 PASS, 0 FAIL. It covers encoding,
    the header and levels, categories, ages, terms, identities, blank versus zero (6 blank cells, 0 explicit
    zeros), decimal places, range, duplicates, overlaps, mixed term definitions, notes against values, and the
    product intentionally listed under two categories. No rate rises as the contract level falls.
  - *Owner decision.* Chris confirmed one source cell, which a source note questions, as authoritative. It is
    kept byte-for-byte; the decision and its evidence are recorded privately, never here.
  - *Informational.* Some products pay above the contract level at some levels, some step unevenly between
    levels, and a few rows cite a secondary guide. They are listed for Chris in the release closeout;
    nothing was changed.
  - *Artifact.* `cf83d992…` (content fingerprint `273d0eb0…`). Three builds are byte-identical, `verify`
    passes, and an independent comparison finds the artifact equal to the CSV in both directions.
  - *Disposable databases* (PostgreSQL 16.15, C and `en_US.UTF-8`). Import `imported`; re-import
    `already_imported`; a missing approval or a wrong checksum is refused. The stored-row fingerprint equals
    the manifest. Reconciliation PASS with 0 differences in both directions, and 7 mutated-CSV negative
    controls fail as required. An activation rehearsal with synthetic people passed 21 checks: agent read,
    management denial, another agency isolated, and direct writes changing nothing.
  - *Source-backed acceptance.* 49 of 49 pass: Chris's 8 required cases plus age, term, level and blank-cell
    boundaries. A negative control with 4 wrong expectations fails exactly those 4.
- **Open before release:** the durable private location for the source and the artifact (D1, P1), and Chris's
  confirmation that the Supabase GitHub integration's "Deploy to production" is off (P4).
- **Release-package Vercel correction (Chris, 2026-10-15; records only, no feature change).** Chris accepted the
  availability implementation and CI on head `885004e` for the final release preflight. §12 now names `agentflow`
  (`www.fflagent.com`, `fflagent.com`) as the canonical production project and `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B`
  as its production rollback candidate (Vercel reports `isRollbackCandidate: true`, re-checked read-only).
  `agentflow-life-insure` is a secondary linked project with Vercel-hosted domains only; its deployment is
  recorded for completeness and never gates release success. Neither project's Vercel settings change. The
  private psql/operator import stays the preferred step 5 route. The final read-only production preflight runs
  immediately before release, once P1 and P4 hold.
- **Shared-grid availability correction (D5; requested by Chris 2026-10-15; planned here before any edit).**
  - *Finding.* Until now any agency admin saw every active shared grid in the catalog and could enable it,
    then read and copy it (C6 self-service). For the FFL Compensation Grid that would expose its rates to every agency.
  - *Design.* One server-only table, `public.organization_comp_grid_availability`
    (`organization_id`, shared `grid_id`, `created_at`, `created_by`; primary key `(organization_id, grid_id)`;
    nil-scope foreign key so it can only name a shared grid).
    - RLS is on, with no client policy and no anon or authenticated privilege. `service_role` has SELECT
      only. Only postgres-only functions write it.
    - The access rows (`organization_comp_grids`) get a foreign key to it, `ON DELETE CASCADE`.
    - The access trigger `private.comp_access_rules` also requires an availability row, locked `FOR SHARE`.
    - The catalog filters on availability.
    - Snapshot, RLS content reads, calculator selection and copy already require an access row, so they
      inherit the rule.
    - Removing availability cascades to the access row, and the existing `comp_access_revoked` trigger
      clears that agency's selection if it pointed at the grid. Private copies are separate grids.
  - *Private operations* (postgres-only, SECURITY INVOKER):
    - `private.comp_make_reference_grid_available(text, uuid)`: exact unique agency name, verified import,
      retry-safe.
    - `private.comp_remove_reference_grid_availability(text, uuid)`: locks the agency settings row first
      (lock order settings → grid → availability → access → product → children), then deletes availability
      and reports whether access and the selection were cleared.
  - *Release.* A new ops script, `supabase/ops/commission_grids_make_available_home_agency.sql` (approval
    setting `agentflow.approve_comp_home_availability=yes`), makes the grid available to the exact unique
    name only. The existing activation script then needs availability first.
  - *Migration handling.* Production's migration history and catalog were re-checked read-only: newest
    `20261010172702`, no commission rows or objects. The only Supabase branches are the PR #294 and #378
    previews, which predate this feature. The three pending migrations are therefore corrected in place
    (AGENT_RULES #25), and §12 gets their new checksums. No new migration, no history change.
  - *Files:*
    - the three migrations;
    - the schema and reference-import rollback files;
    - the new make-available ops script and the activation script's header;
    - `supabase/tests/commission_grids_harness.sql`, `…_schema.sql`, `…_access.sql` and `…_import.sql`;
    - `scripts/commission_grids_concurrency.mjs` and `scripts/run_commission_grids_tests.sh`;
    - records: this plan, the root plan, `AGENT_RULES.md`, `verification.md`, the runbook and
      `WORK_LOG.md`.
    - No frontend change is expected: the settings card already describes the catalog as grids
      "available to this agency".
  - *Negative tests:*
    - the home agency's Admin sees and enables the grid once it is available;
    - another agency's Admin cannot see it, enable it by id, snapshot, read or copy it;
    - removing availability leaves no unauthorized selection, and private copies stay independent;
    - Agents and Team Leaders cannot manage availability or enable shared grids;
    - a peer agency and `service_role` get nothing;
    - a concurrency scenario proves that removal and an admin's enable or select serialize safely.
  - **As built and verified locally** (PostgreSQL 16.15 under C and `en_US.UTF-8`; details in `verification.md`):
    - *Finding, before.* On the published migrations the admins of agency B and of A's peer agency C listed
      every active shared grid, enabled one by id, read its rates through the snapshot and copied it.
    - *After.* Their catalog is empty; enabling by id, the snapshot, copying and selecting are refused (PT404).
    - *As designed, plus one refinement found while writing the tests:* withdrawing availability that does
      not exist returns `removed: false` and writes nothing (it no longer creates a settings row for that
      agency).
    - *Tests.* Access A4 changed and A11 added; import I1 and I6 changed and I8 added; schema S1o–S1s and
      S6k–S6n; concurrency scenario 9 (18 assertions, both orders of withdrawal against enable, select and
      copy); ops-script checks; two negative controls (no availability gate → A4m; an unfiltered catalog → A4l).
      The cases cover another agency's admin, its Super Admin holding `platform_role = 'platform_admin'`, an
      agency-less platform admin, A's peer agency, agents, team leaders, agency admins and `service_role`.
    - *Checks.* The full runner passes on both clusters (66 checks each); the CI frontend command, both
      type-checks (the same 84 app diagnostics), ESLint on the 64 branch code files and the build pass.
    - *Private re-run with the real artifact* (disposable loopback databases only): same fingerprint,
      reconciliation PASS, activation refused before availability, then the availability and activation
      scripts; 4 + 28 + 7 rehearsal checks PASS, and the MCP route passes too; acceptance 49 of 49. No rate
      changed.
    - *Checksums* (§12): schema `1f8e14fb…`, operations `dc0c524b…`, reference import `3cbe4d69…`, availability
      ops `c484c040…` (new), activation ops `46c41c89…`.
- **PostgreSQL 17.6 CI correction (approved by Chris, 2026-10-15).** The first run on draft PR #447 (head `3971fd0`)
  stopped at access test A10f. It compared the actual grant list, built from catalog `name` columns (C collation),
  with the expected literals (database default collation). The CI image defaults to `en_US.utf8`, so the order
  differed although the grant sets were identical. The same run's `Onboarding emails / verify` job failed
  `git diff --check` on one trailing space in §11 and on the intentional CRLF endings of the synthetic CSV fixture.
  Fixed by `COLLATE "C"` on both A10f orderings (still an exact-set comparison), removing the space, and one
  path-scoped `.gitattributes` rule for that fixture (`-text whitespace=cr-at-eol`; its bytes are unchanged). No
  grant, RLS, migration, locale or application change. Local proofs: PostgreSQL 16.15 under C and `en_US.UTF-8`;
  the 17.6 re-run is recorded in the PR.
- **Contract-step output correction (approved by Chris, 2026-10-15).** The 17.6 re-run on head `10e1a73` passed
  A10 and the editor save-contract test (2 of 2), then the runner exited at its plain-text `Tests  2 passed` check:
  GitHub Actions sets `CI`, so Vitest colored its summary and the text no longer matched. The runner now sets
  `NO_COLOR=1` on that one Vitest call. Its exit-code check and the two-passing-tests requirement are unchanged.
  No test, assertion, migration, grant or application change.
- **Independent-review correction (approved by Chris, 2026-10-15; planned before editing).** Two findings on head
  `c354895`. It is not a redesign: no change to grants, RLS, shared-grid access, agency authorization, the
  importer or any other operation.
  - **Finding 1: a background read error could destroy an unsaved draft.**
    - *Cause.* `CommissionGridsSettings` returned an error paragraph whenever `overview.isError` or
      `catalog.isError` was set. React Query sets these on a failed *background* refetch while keeping the last
      good data, so an open `GridEditor` unmounted with its local draft. `GridEditor`'s own `snapshot.isError`
      branch replaced its controls, its confirmation dialog and its Stay/Leave dialog, while
      `useUnsavedNavigationGuard` stayed active, so a blocked navigation had nothing to answer it. After a
      successful save, a failed refresh also left the editor disabled and still reporting unsaved changes.
    - *Fix.* Only a failed initial load (no data) replaces a view, now with Retry. A failed background refresh
      keeps the last good data and the mounted editor (same element position, so React keeps its state), its
      draft, its dirty registration and both dialogs. It adds a compact alert with Retry (new
      `LoadErrorNotice`).
    - *Truthful saves.* `useGridEditorDraft` reports `dirty` as false while it waits for the saved snapshot,
      because those changes are saved. A save followed by a failed refresh therefore reads "saved, the latest
      version couldn't be loaded", with Retry. The editor is never stuck disabled.
    - *Failed Reload.* Reload after a conflict no longer resets the draft to stale data when its refetch fails.
    - *Scope.* The section's local state (the open editor or viewer and its draft) is keyed by user, agency and
      access. Logout, permission loss and a user or agency change still deny access and reset it, so no
      cached draft carries across. Drafts stay in memory only, never in browser storage.
    - *Tests.* A new QueryClient-backed `draftPreservation.test.tsx` uses real React Query, the real hooks,
      editor, guard and dialogs; only `adminApi`, auth and permissions are mocked. It covers:
      - an overview refresh failure while dirty;
      - a catalog refresh failure while dirty;
      - a snapshot refresh failure while dirty, with the Stay/Leave dialog still answering;
      - Retry keeping the draft;
      - a save followed by a failed refresh, then a recovering Retry;
      - logout, permission loss and identity change.

      The tests run before the fix (expected to fail) and after it.
  - **Finding 2: a NULL revision bypassed delete conflict protection.**
    - *Cause.* `comp_delete_private_grid` compared `v_revision <> p_expected_revision`, which is NULL for a NULL
      revision, so the stale check never raised.
    - *Fix.* Refuse `p_grid_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1` with 22023
      before `comp_authz.begin_admin_operation()`, which writes and locks the agency settings row. This mirrors
      `comp_save_grid_changes`. The locked comparison is unchanged.
    - *Tests.* O7 gains tests as the real authenticated agency Admin. A null, zero or negative revision and a
      null grid are refused; a stale revision is still PT409. Each refusal leaves the grid row and revision,
      its content and references, the agency settings and the calculator selection unchanged. A shared grid
      and agency B's private grid are refused at their current revision (PT404) and with a null revision
      (22023). The correct revision still deletes. They run against the current migration first (expected to
      fail) and after the fix.
    - *Migration handling.* Production's migration history and catalog were checked read-only: no
      `20261015…` row, no comp objects. The only Supabase preview branches (PRs #294 and #378) predate this
      feature, and #447 has none. The pending migration is therefore corrected in place (AGENT_RULES #25), and
      its new checksum replaces the old one in §12.
  - **As built and verified locally** (disposable PostgreSQL 16.15 under C and `en_US.UTF-8`; synthetic data):
    - *Finding 2, before.* With the published migration, a NULL revision deleted the agency's own grid
      (`00000`), and a zero or negative revision fell through to a misleading PT409. The extended operations
      suite stopped at O7f (`expected 22023 … got 00000 "ok"`).
    - *Finding 2, after.* The new O7 tests pass: NULL, zero and negative revisions and a NULL grid return
      22023 and change nothing, stale stays PT409, shared and foreign grids stay PT404, and the current
      revision deletes.
    - *Finding 1, before.* With the published frontend, 9 of the 10 new tests failed: the editor's controls
      vanished on each refresh failure, there was no Retry and no truthful saved state, and after an identity
      change the old editor re-opened. Permission loss already passed.
    - *Finding 1, after.* All 10 pass.
    - *Full checks.* The full runner passes (57 checks, CI settings). The CI frontend command: 12 files passed,
      2 skipped by design; 168 tests passed, 2 skipped. Scoped ESLint is clean on all 62 branch source files.
      `npx tsc --noEmit` exits 0; the app type-check has the same 84 diagnostics as at `c354895`, positions
      included. The build, the secret-marker check and the bundle scan are clean.
    - *Unchanged.* The access suite (`COLLATE "C"`), the runner (`NO_COLOR`, exit-code and two-tests checks),
      `.gitattributes` and the workflows are untouched.
- Not release-ready until those are resolved and §12 is approved.

## 11. Separate follow-up (not in this build)
`profiles.commission_level` is self-editable through the API: `authenticated` holds column UPDATE,
`profile_authz.can_update_profile` returns true for the actor's own row, and
`enforce_profile_field_authorization` does not cover the column (read-only production checks, 2026-10-15).
The onboarding wizard writes it intentionally (`useOnboardingPageFlow.ts`). An agent can therefore change the
level their own estimate uses. Needs its own approved change; nothing here alters profiles, onboarding or
stored levels.

## 11A. Production release interruption — operation authority correction

On 2026-10-15 the approved release stopped after production migration `20261015211858 commission_grids_schema`.
The next migration failed atomically with `42501 permission denied to set parameter "agentflow.comp_operation"`.
No later step ran. Production migration 1 remains the exact reviewed bytes. D6 replaces the unpublished GUC design
inside the still-unapplied operations migration; the reference-import migration is unchanged. A fresh exact approval
is required before resuming production.

## 12. Consolidated release continuation package (refreshed 2026-10-15 after production migration-2 failure and D6 correction; SCHEMA ONLY APPLIED)
Each numbered action needs Chris's explicit approval of that exact action, target and checksum. They may be
approved together as one release package. Local implementation approval is not release approval.
Targets: production Supabase `jncvvsvckxhqgqvkppmj` (AGENTFLOW CRM) and the **canonical** Vercel production project
`agentflow` (production domains `www.fflagent.com` and `fflagent.com`). Production verification and release
success are judged against `agentflow` / `www.fflagent.com` only. The secondary project `agentflow-life-insure` is
linked to the same repository and may deploy from `main` automatically; it has only Vercel-hosted domains, is not
the AgentFlow production surface, and is recorded for completeness only. Neither project's Vercel settings change
as part of this release.

**State when this package was prepared (read-only, 2026-10-15).**
- Production database:
  - newest migration is `20261015211858 commission_grids_schema`; its stored SHA-256 is the reviewed `1f8e14fb2119eec01da44d3aff6ba34417c300451495f2028de501e7eb66da70`;
  - migration 2 failed atomically and is absent from history; migration 3 was never attempted;
  - schema tables/authz helpers from migration 1 exist, but there are zero grid/import/availability/access/settings rows, no `agentflow_comp_operator` role and zero commission write RPCs;
  - exactly one organization named *Family First Life - Chris Garness*, and none using the nil UUID;
  - 4 organizations in total; 3 other organizations have an active Admin (see P6);
  - `private.campaign_actor()` and `public.get_org_id()` match the bodies used in testing;
  - PostgreSQL 17.6, `en_US.UTF-8`.
- Vercel (read-only, re-checked 2026-10-15 for the Vercel correction):
  - **Canonical `agentflow`** (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`). Production deployment
    `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B`, READY at `main` `b5976e0`, holds `www.fflagent.com`, `fflagent.com`
    (redirects to www) and `agentflow-eta.vercel.app`. Vercel reports it as an instant-rollback candidate
    (`isRollbackCandidate: true`). It is the **production rollback candidate** for this release.
  - **Secondary `agentflow-life-insure`** (`prj_PctERc2MEVcpKkYtBtQYc1ruunKb`). Its only production domain is
    `agentflow-life-insure.vercel.app`. Production deployment `dpl_8papEb7YgEx215BhyZtm2E9DMPdJ`, READY at
    `b5976e0`. Not the AgentFlow production surface; recorded for completeness.
- Merge candidate: the PR #447 head recorded in the PR description. Recording it there does not move the head.

**0. Publication:** done (draft PR #447).

**Prerequisites. Every one must hold before step 1:**
- P1. Private data:
  - *Done locally on 2026-10-15 (§10):*
    - source `998307b4ebab7f3ed0e6dfdf30457d4bd2b5f967c80f0068e04aa4f5ed631d08`;
    - artifact `cf83d9923a261c531c709acaa24656cddca9d77ca850d332417262c953b78157`;
    - importer 1.0.0;
    - content fingerprint `273d0eb0fc144b21b812a5c6fa74daf44d18579fb3e0aa4a315439cc7ba3ffed`;
    - counts 41/57/11, 963 rate cells, 57 references;
    - reconciliation PASS; acceptance 49 of 49.
  - *Satisfied:* Chris confirmed the durable private copies exist and both SHA-256 values match:
    `ffl_comp_rates.csv` `998307b4…5ed631d08` and `ffl.comp_reference_grid.json` `cf83d992…53b78157`.
    The importer remains unchanged and rebuilds the artifact byte-identically.
- P2. Corrected code head `215ab05c673b171b36b107d68c5f3fb7f9cedc35` is green on all workflows, including PostgreSQL 17.6, and clean against `main` `b5976e0`. This records-only reconciliation commit must also be green before production continuation.
- P3. Read-only production prechecks, immediately before continuation:
  - migration history ends at the expected applied schema version `20261015211858`;
  - migration-1 schema/authz objects exist; no operation role/write RPCs/data exist;
  - no organization uses the nil UUID;
  - the two resolver bodies match the tested copies;
  - exactly one organization has the home agency's exact name;
  - which roles hold "View Own Commission Percentage" (it gates the calculator, D3).
- P4. **Satisfied:** Chris confirmed the Supabase GitHub integration's "Deploy to production" is OFF (AGENT_RULES #30).
- P5. Baseline of the Supabase security and performance advisors (read-only).
- P6. **Superseded by D5 (2026-10-15).** The grid becomes available only to the home agency (step 7a). The
  Admins of the 3 other organizations do not see it in their catalog and cannot enable, read or copy it, even
  by id. Making it available to any other agency is a separate, separately approved operation.

**1–3. Migrations / current continuation.** Do not rewrite migration history.

| # | Status | `name` | File | SHA-256 |
|---|---|---|---|---|
| 1 | **DONE** as production version `20261015211858` | `commission_grids_schema` | `supabase/migrations/20261015120000_commission_grids_schema.sql` | `1f8e14fb2119eec01da44d3aff6ba34417c300451495f2028de501e7eb66da70` |
| 2 | **NEXT — fresh approval required** | `commission_grids_operations` | `supabase/migrations/20261015120100_commission_grids_operations.sql` | `dc0c524b36abc4b97db83dfdd10ed9f62ab14fc4c9f8957ed0a56273a60c1c25` |
| 3 | pending after step 2 verification | `commission_grids_reference_import` | `supabase/migrations/20261015120200_commission_grids_reference_import.sql` | `3cbe4d6947f725d5e4d9e52087ace0fba33a55827d92b7cec9d01d900e55bff0` |

Operations rollback SHA-256 is `593abb853cbe30fe423924b9d0e2dcbf874c92dc66ffb3860f6b86a1f299cc01`.
For steps 2 and 3, use Supabase MCP `apply_migration` with the exact reviewed bytes, one at a time; record the
assigned version and verify the stored statement's SHA-256 matches before continuing. The corrected step 2
removes browser table writes and replaces the production-incompatible custom-GUC authority with D6's
`agentflow_comp_operator` role.

**4. Read-only verification.**
- Objects, RLS, policies, grants and the SECURITY DEFINER inventory match the access suite (A10):
  - `service_role` holds SELECT only on the comp tables;
  - `anon` holds nothing;
  - `organization_comp_grid_availability` has RLS on, no policy, no `anon` or `authenticated` privilege, and no
    row;
  - the private import and availability functions are postgres-only.
- Advisors compared with P5. New findings are triaged and reported separately.

**5. Private import.** Use the exact artifact `cf83d992…` from the durable location, re-checking its SHA-256
first. The route is Chris's choice (recommendation first). Never use `apply_migration` for data: it would store
the rates in the migration history.
- (a) **Recommended.** Chris, or an operator he names, runs the reviewed ops script
  (`d2825d4112b9da15f0556ac6c2e84b3158c1984d28d9cde33e3783e98812e1aa`) with psql, from the machine holding the
  private files, as `postgres` through the session pooler or a direct connection:

  ```bash
  psql "$PRODUCTION_SESSION_URL" -X -v ON_ERROR_STOP=1 \
    -v artifact_path="$PRIVATE_DIR/ffl.comp_reference_grid.json" \
    -v artifact_sha256=cf83d9923a261c531c709acaa24656cddca9d77ca850d332417262c953b78157 \
    -c "SET agentflow.approve_comp_reference_import = 'yes'" \
    -f supabase/ops/commission_grids_import_reference_grid.sql
  ```

  The `-c SET` form was tested locally; it works where `PGOPTIONS` startup options are not passed through.
  The output is status, ids, counts and the fingerprint only. The artifact never passes through the agent
  session, an MCP request, Git or CI.
- (b) **Not preferred; only if Chris explicitly chooses it when approving step 5.** The agent sends the same
  transaction through Supabase MCP `execute_sql`. It contains
  `SET LOCAL agentflow.approve_comp_reference_import = 'yes'` and the artifact as one dollar-quoted literal (the
  artifact contains no `$`). The full artifact then passes through the agent session and the MCP request,
  though never Git, PR text or CI. The function's checksum refuses any altered text, and nothing is imported.

Expected: `status = imported`, grid `6ad6d4e4-4024-5dae-bef5-de0202ab1b6e`, counts 41/57/11/963/57,
`content_sha256 = 273d0eb0…`. A re-run returns `already_imported`. On either route the real artifact never goes
into migration history (`apply_migration`), Git, PR text, CI or any public log.

**6. Read-only verification.**
- Exactly one ledger row (`public.comp_reference_imports`): importer 1.0.0, source `998307b4…`, artifact
  `cf83d992…`, content `273d0eb0…`.
- `private.comp_grid_content_sha256('6ad6d4e4-4024-5dae-bef5-de0202ab1b6e')` equals `273d0eb0…`.
- Counts equal the manifest, and the grid is active.

**7a. Availability (D5).** Run `supabase/ops/commission_grids_make_available_home_agency.sql`
(`c484c040de8609c50938e2f0c5650c305b746ad9111764b55e0f1d57592051f6`) with
`agentflow.approve_comp_home_availability = 'yes'`. Either route works: the agent through MCP `execute_sql`
(the script carries no private data), or the operator with psql in the same `-c SET` form.
- The agency is resolved by exact unique name at execution, never by a hardcoded id. Zero or several matches
  are refused (PT409). A grid without a verified import ledger row is refused (PT404).
- Expected on first run: `available: true`, `newly_available: true`. A re-run reports `newly_available: false`.
- Availability only: nothing is enabled or selected. Then read-only: exactly one availability row, for the home
  agency.

**7b. Activation.** Run `supabase/ops/commission_grids_activate_home_agency.sql`
(`46c41c897f3dee875f3bc45d52269b9d08f41e66ce84aad65a50230f4455a08c`) with
`agentflow.approve_comp_home_activation = 'yes'`, by either route, after 7a.
- The agency is resolved by exact unique name at execution, never by a hardcoded id. Zero or several matches
  are refused (PT409). Without 7a the enable is refused (PT404) and nothing changes.
- Expected on first run: `selected: true`, `existing_selection: null`.
- A different existing selection is kept and reported, never overwritten. Stop and ask Chris.
- No other agency has availability, an access row or a selection.

**8. Filename reconciliation, before the merge (practice since 2026-10-10).** On the PR branch:
- `git mv` the three migrations and their three rollback files to the recorded versions. SQL bytes are
  unchanged, and byte-identity is re-verified.
- The forward files keep their authored names in comments and messages, because their bytes may not change.
- Update:
  - `MIGRATIONS` in `scripts/run_commission_grids_tests.sh`;
  - the path filters in `.github/workflows/commission-grids.yml`;
  - the rollback header lines;
  - the records.
- One normal push. Exact-head CI, including 17.6, must be green before the merge.

**9. Merge; canonical production deployment.**
- Chris marks PR #447 ready and merges the reviewed head with a merge commit.
- The canonical project `agentflow` builds production from the merge commit automatically (no manual deploy, no
  promotion, no settings change). Record its deployment id, READY at the merge commit, `aliasError = null`, and
  `www.fflagent.com` / `fflagent.com` assigned to it.
- The secondary project `agentflow-life-insure` may also build production from `main`. Record its deployment id
  and state for completeness; it does not gate release success.
- Confirm the migration list is unchanged after the merge: nothing replayed.

**10. Post-release verification.**
- *Vercel (canonical).* `agentflow`'s production deployment is READY at the merge commit and holds
  `www.fflagent.com` (and the `fflagent.com` redirect). `https://www.fflagent.com/` serves the new build, and
  there are no new runtime errors. Release success is judged here only.
- *Vercel (secondary, recorded only).* The `agentflow-life-insure` deployment id and state, if it built.
- *Database, read-only.* Run role simulations inside `begin read only … rollback` with production JWT claims:
  - **Agency Admin management access.** Chris's Admin profile sees the FFL Compensation Grid enabled and selected
    (`comp_get_admin_overview`), and as enabled in the catalog.
  - **Regular Agent denial.** A home-agency Agent is refused the overview, the catalog and grid snapshots
    (42501).
  - **Calculator data.** A home-agency Agent gets `ready` on grid `6ad6d4e4-…` with 41/57/963, no
    source/notes text, and their own level as stored.
  - **Contract levels.** Count the home-agency profiles whose level is on the grid, off the grid, missing or
    malformed (counts only).
  - **Real product/rate lookup.** A private spot check of the eight acceptance cases against the stored rows.
    The values stay in the private session.
  - **Other-agency isolation (D5).** An Admin of another agency, where one exists, sees an EMPTY catalog and is
    refused enabling, copying and selecting the grid by id (PT404) inside the rolled-back simulation; its
    profiles get `not_configured` and see 0 comp rows.
  - **Availability.** Exactly one `organization_comp_grid_availability` row: the home agency and grid
    `6ad6d4e4-…`.
  - **RLS negatives.** `anon` has no EXECUTE on any comp operation and reads 0 comp rows. Direct client writes
    to shared rows change nothing; this is proven by the suites and the local real-data rehearsal, not by
    production writes.
  - Advisors compared with P5.
- *Signed in (Chris).*
  - A home-agency agent sees "Commission Calculator" below Resources and gets the first required estimate.
  - An Admin sees Settings › Commission Grids.
  - A role without "View Own Commission Percentage" sees neither.

**Non-destructive rollback (each step separately approved).**
- (a) Frontend, canonical `agentflow`: Vercel rollback to `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B`, the pre-release
  production deployment at `b5976e0` (Vercel reports `isRollbackCandidate: true`). It points `www.fflagent.com`
  back without a Git change. If the Vercel account is on the Hobby plan (not visible to the agent), a rollback is
  allowed only to the immediately previous production deployment, so `dpl_6LM8…` stays the candidate only while
  no other production deployment lands after the merge. After a rollback, confirm in the Vercel dashboard which
  deployment holds `www.fflagent.com` before the next merge to `main`. The durable alternative is a reviewed revert of the merge commit on `main`, which builds a
  new production deployment. The secondary project needs no rollback for release purposes; its pre-release
  production deployment is `dpl_8papEb7YgEx215BhyZtm2E9DMPdJ`. A frontend rollback does not touch the database
  (use (b), (b2) or (c)).
- (b) Calculator off without code changes: an agency admin chooses "None — calculator off". For every agency,
  call `private.comp_set_reference_grid_active('6ad6d4e4-…', false)`. It clears every selection of that grid
  and keeps all data and access rows. Reverse it with `true`; selections are then not restored automatically.
- (b2) Withdraw the grid from the home agency (D5):
  `private.comp_remove_reference_grid_availability('Family First Life - Chris Garness', '6ad6d4e4-…')`. It removes
  that agency's availability and access and clears its selection of the grid. The grid, its ledger row and any
  private copies stay. Reverse it with 7a and 7b; rehearsed locally with the real artifact.
- (c) Database: leave the tables dormant. The rollback files run only in reverse order. The two function
  rollbacks (import, then operations) drop functions only and delete no row. The schema rollback refuses
  while any row exists. Never delete data to make a rollback pass, and never repair migration history.

**Not part of this release:**
- profile, onboarding or contract-level changes (§11 follow-up);
- any other agency's availability or activation;
- CI changes, or any change to either Vercel project's settings (domains, Git integration, production branch,
  environment variables);
- migration-history repair;
- the CSV or any generated data in Git.
