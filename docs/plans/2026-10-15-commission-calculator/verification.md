## 2026-10-15 — Commission backend release complete; frontend PR #447 pending merge

**Production:** Three byte-verified migrations are installed in AGENTFLOW CRM (`20261015211858` schema,
`20261016035150` operations and `20261016035626` reference-import infrastructure). The exact approved
private FFL artifact was imported through Supabase MCP outside migration history. Ledger, source/artifact hashes,
stored-row fingerprint and counts (41 products, 57 variants, 11 carriers, 963 rate cells, 57 references) match
the source-backed verification, and the original CSV was not modified. Availability, enablement and calculator
selection each have **one** row, all for **Family First Life - Chris Garness**; all other agencies have zero
availability/access and no selection. No frontend merge or production deployment has occurred yet.

**Security:** The six agency-write RPCs are SECURITY DEFINER owned by NOLOGIN/NOBYPASSRLS
`agentflow_comp_operator`. Direct authenticated and service-role writes to commission tables are denied;
all nine commission tables have RLS. Supabase's managed CREATEROLE flow produced two
`pg_auth_members` grants to the **same sole member** `postgres` (one grantor `supabase_admin`, one
`postgres`), not two distinct member roles. The A10f test now verifies distinct grantees and rejects any
non-`postgres` membership. The database role/grant state is otherwise as reviewed.

**Remaining:** The six migration/rollback filenames have been reconciled to actual production versions without
altering SQL bytes. Final exact-head CI, PR #447 merge and canonical Vercel `agentflow` / `www.fflagent.com`
deployment verification remain. No further migration or import is authorized by this record.

## 2026-10-15 — Commission release compatibility closeout (PR #447, pending production authorization)

**Status:** Draft PR #447 head `bf6d76384184c310aada39227a19b49919f66ac7` passed all seven GitHub workflows, including the complete PostgreSQL 17.6 commission runner (restricted-SET and non-super-role probes, permission/availability negative controls, 59 concurrency assertions, rollback/reapply). No frontend changes in this closeout. Production has only schema migration `20261015211858`; migration 2 failed on the original custom-GUC approach and remains unapplied. No rates, availability, activation, merge or deployment has occurred.

**Changes:** The still-unapplied operations migration now uses a NOLOGIN/NOBYPASSRLS `agentflow_comp_operator` role and an audit-only actor-UID helper rather than a custom GUC. All three private postgres-only ops scripts use psql client approval variables rather than unsupported managed-Postgres SET parameters, with refusal checked by CI. Public synthetic tests and branch docs were updated; private source and import artifact remain byte-identical to their reviewed SHA-256 values and have not entered Git.

**Exact current hashes:** operations migration `0883a44277edb21d294f30a4f51a164ca12a1f445c331cb16b805965e06f3dd9`; operations rollback `4498a5dd41d0284e99905754c30393977c5829d65fd977704fc64203879b469a`; import ops `5015c3077abd5957a12a5950294f830d8fcf3a98f74aec5e88bbc363991f7e1f`; availability ops `a6cf926fdcf9dc58d740d19fa9178071b4fca6dcd14f395f3e4ba9fbe4d5baa3`; activation ops `bec9167c7d0247af1c0d9e0c8df50f89bdec2d47f5beb6485dd83abc44512d7d`. Schema migration `1f8e14fb2119eec01da44d3aff6ba34417c300451495f2028de501e7eb66da70` is already applied; reference infrastructure migration `3cbe4d6947f725d5e4d9e52087ace0fba33a55827d92b7cec9d01d900e55bff0` is pending. Source/artifact SHA-256 and content fingerprint match the private verified manifest.

**Release boundary:** No additional production mutation is authorized by this documentation update. Recheck the exact branch head and production migration state, obtain Chris's explicit approval of the revised production operation and import/availability/activation route, apply each step with read-back verification, then reconcile migration filenames, rerun CI, merge and verify canonical `agentflow` production. Separate follow-up: the existing `profiles.commission_level` self-edit permission issue.

## 2026-10-15 — Commission production authority correction after migration-2 SET failure

**Status:** Production release paused safely after schema migration **20261015211858** applied byte-identically. The
next operations migration failed atomically with `42501 permission denied to set parameter "agentflow.comp_operation"`.
No operations functions, reference import, FFL data, availability, activation, merge or deploy followed the failure.

**Correction on draft PR #447:** the still-unapplied operations migration now forward-corrects the applied schema to
a dedicated `agentflow_comp_operator` role: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, no client/server-key membership.
Only trusted `postgres` is a member so migration/rollback can administer the six owned write RPCs. Authenticated
loses all commission base-table write grants. Those six public write RPCs are SECURITY DEFINER owned by the narrow
role; the role remains subject to RLS, and both policies and the first trigger re-resolve the real JWT/profile actor
through the canonical helpers. The legacy custom-GUC authority is not used by migration 2.

**Verified correction:** code head `215ab05c673b171b36b107d68c5f3fb7f9cedc35` passed every GitHub workflow. PostgreSQL 17.6 passed the full database runner, including production-style restricted-SET reproduction, non-super CREATEROLE ownership transfer, role/grant negative controls, 59 concurrency assertions, rollback and reapply. Corrected operations SHA-256: `dc0c524b36abc4b97db83dfdd10ed9f62ab14fc4c9f8957ed0a56273a60c1c25`; operations rollback SHA-256: `593abb853cbe30fe423924b9d0e2dcbf874c92dc66ffb3860f6b86a1f299cc01`.

**Production boundary:** migration 1 remains production history exactly as version `20261015211858`; all comp data/access/settings tables are empty and no operation role/write RPCs exist. Fresh exact approval is required before migration 2.

# Commission Calculator + agency commission grids — verification record (local)

**Scope of this record:** the local implementation on `feature/commission-calculator-agency-grids`
(base `origin/main` `dacd921903a867de99276f8709f829995602c3bd`). Every result below was re-run on code commit
`14d9fa4`: the database layer `fea545d`, the frontend `44d550a` (no `src/` change since), and the pre-publication
`service_role` correction `14d9fa4`. The two original code commits were rebuilt locally during closeout, before any
publication; see "Corrections made during closeout".

**Kept separate, per C5:**
- Every section except "Private FFL validation" covers synthetic data only.
- "Private FFL validation" records the real-data run of 2026-10-15 as SHA-256 values, aggregate counts and PASS/FAIL only. It contains no rate, carrier or product name, source note or acceptance expectation (D1).
- No hosted database or deployment was touched.

## Environments
- **Database:** disposable PostgreSQL **16.15** cluster.
  - Listens on 127.0.0.1 only, no Unix socket.
  - Data directory under the container's postgres home, removed after verification.
  - The runner refuses non-loopback URLs and clusters with Supabase platform roles.
- **Tooling:** Node 22 and npm with the existing lockfile (`npm ci`); Python 3.13 standard library only; Chromium through Playwright 1.56.1 (preinstalled) for synthetic renders.
- **PostgreSQL 17.6 (CI):** `.github/workflows/commission-grids.yml` runs on draft PR #447.
  - On head `c354895` (test-merge `bcd72e6`) it ran the complete runner and passed.
  - That result is **historical**. It does not verify the independent-review correction or the shared-grid availability correction below, which changed the migrations, tests and (for the review correction) the editor; CI for each revision is recorded in the PR description.
  - (This bullet previously said the workflow had not run; that was true only before publication.)

## Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (base: 0) |
| `npx tsc -p tsconfig.app.json --noEmit` | 85 diagnostics, set identical to base by file, code and message; no new diagnostics (after the correction below) |
| ESLint (`--max-warnings=0`) on all 61 new or changed `src` files, generated Supabase types included | 0 problems |
| Vitest, full suite, base vs branch | identical failure sets: the same 10 pre-existing, environment-dependent files fail on both (see below). Base: files 10 failed / 322 passed; tests 1 failed / 5183 passed / 34 skipped. Branch: files 10 failed / 331 passed / 2 skipped; tests 1 failed / 5311 passed / 36 skipped |
| Feature frontend tests (the CI job's exact command) | 158 passed, 2 skipped. Two files skip by design: the private acceptance file registers no tests without `COMMISSION_PRIVATE_DIR`, and the change-set contract test (2 tests) needs `COMP_DB_URL`; the database runner executes it |
| `scripts/run_commission_grids_tests.sh` (PostgreSQL 16.15) | PASS (details below) |
| `vite build` | OK. The chunk-size warning is pre-existing (also on base). JS +70 KiB minified. The output at `44d550a` is byte-identical to the build made before the closeout corrections (they changed tests, fixtures and comments only); rebuilt at `14d9fa4` (no source change) |
| Bundle scan | no synthetic fixture text, private file names, artifact or acceptance paths, `COMMISSION_PRIVATE_DIR`, service-role strings, database URLs or test credentials; no private carrier or product names and no private example amounts |
| Synthetic renders, 1440 px and 390 px | calculator (estimate, off-grid level, not configured), settings overview, grid editor with an invalid cell. No horizontal overflow, no console errors. Regenerated at `44d550a`. Screenshots kept locally (synthetic only, not committed) |

**The 10 pre-existing vitest failures** (identical on base `dacd921` and the branch):
- Nine fail at import with `supabaseUrl is required`. This container has no `VITE_SUPABASE_URL`, and those tests import the real client.
- One compares a source file byte-for-byte with a deployed artifact (`recordingRetentionVoicemail.test.ts`, "deployed v29").
- None of them touches this feature.

## Independent-review correction (2026-10-15, after publication)

Two findings on head `c354895` were fixed as an approved, scoped correction (plan §10). Each new regression test ran **before** the fix (it must fail) and **after** it. Synthetic data, disposable loopback databases only.

| Check | Before the fix | After the fix |
|---|---|---|
| Finding 2: `comp_delete_private_grid` as the authenticated agency Admin (per-case probe, each case rolled back) | A NULL revision **deleted** the agency's own grid. Zero or negative fell through to PT409. A NULL grid gave PT404. | NULL, zero and negative revisions and a NULL grid: 22023, nothing changed. Stale: PT409. Shared or other-agency grid: PT404 at its revision, 22023 with NULL. Current revision deletes. |
| Operations suite with the new O7 tests (O7f–O7o) | Stops at O7f: `expected 22023 "A grid and its current revision are required", got 00000 "ok"` | ALL PASSED. Every refusal leaves the grid row and revision, content, references, settings and calculator selection unchanged. |
| Finding 1: new QueryClient-backed `draftPreservation.test.tsx` (real React Query, hooks, editor, guard and dialogs) | 9 of 10 fail. Overview, catalog and snapshot refresh failures remove the editor's controls and draft. No Retry. A save followed by a failed refresh has no truthful state. The old editor re-opens after an identity change. (Permission loss already passed.) | 10 of 10 pass |
| `scripts/run_commission_grids_tests.sh`, CI settings (`CI=true`, `GITHUB_ACTIONS=true`), PostgreSQL 16.15, C and `en_US.UTF-8` | — | PASS, 57 checks on each, identical output, no color codes, no leftover databases |
| CI frontend job's exact command | (at `c354895`: 11 files passed / 2 skipped; 158 tests passed / 2 skipped) | 12 files passed / 2 skipped; 168 tests passed / 2 skipped (the new file adds 10) |
| Vitest, full suite | (at merged head `b44c824`: files 10 failed / 338 passed / 2 skipped; tests 1 failed / 5500 passed / 36 skipped) | files 10 failed / 339 passed / 2 skipped; tests 1 failed / 5510 passed / 36 skipped. The failing files are exactly the 10 pre-existing, environment-dependent ones listed below |
| `npx tsc --noEmit` / `npx tsc -p tsconfig.app.json --noEmit` | exit 0 / exit 2, 84 diagnostics | exit 0 / exit 2, the same 84 diagnostics, line and column included |
| ESLint `--max-warnings=0`, all 62 new or changed `src` files on the branch | — | 0 problems |
| `vite build`, CI secret-marker check, bundle scan | — | OK, clean, clean |
| Checksums | operations migration `d7c20e17…` | operations migration `7e3caad6aea556106aba764b3f3b5ddcd93830f4f795bc59acda7fbcb01b6998`. Unchanged: schema, import migration, rollbacks, both ops scripts, the synthetic fixture. |

The protections from the CI corrections are untouched: A10f `COLLATE "C"`, the CRLF fixture rule, and the runner's `NO_COLOR`, exit-code and two-tests checks.

## Shared-grid availability correction (D5; 2026-10-15, after the release preparation)

Chris required that a shared grid reach only the agencies AgentFlow makes it available to (plan §2 D5 and §10).
The three unapplied migrations were corrected in place. Synthetic data, disposable loopback databases only,
except the private re-run recorded under "Private FFL validation".

| Check | Result |
|---|---|
| Finding, on the published migrations (`84637cf3…`, `7e3caad6…`, `b8b2836b…`), as real `authenticated` roles | The admins of agency B and of A's Agency Group peer C listed every active shared grid in their catalog, enabled one by id, read its rates through the snapshot and made a full copy |
| The same probe after the correction | Catalog empty for B and C. Enabling by id: PT404 "That AgentFlow grid is not available". Snapshot: PT404. Copy: PT404 "Enable that AgentFlow grid for your agency before copying it" |
| Access suite: A4 changed, A11 new, A1/A9/A10 extended | Another agency's admin, a Super Admin of that agency who also holds `platform_role = 'platform_admin'`, A's peer agency and an agency-less platform admin cannot list the grid, enable it by id, snapshot, copy (full or structure), select or read any of its rows; a forged organization claim is refused. Agents, team leaders, agency admins and Super Admins cannot read, grant or withdraw availability or run the availability functions (`permission denied`). Availability alone opens no content. The home agency's admin enables, selects and copies it; disabling keeps availability; withdrawal clears access and the selection; the private copy stays exact, selectable and editable; the other agency is unaffected; a repeat withdrawal is a no-op. On the availability table `anon` and `authenticated` hold nothing and `service_role` holds SELECT only |
| Import suite: I1, I6 changed, I8 new | Availability and withdrawal by exact unique name (zero, two, case or space mismatch refused; a verified import required to make a grid available). Activation is refused until the grid is available. Withdrawal from agency B removes its access and selection, keeps its full private copy and leaves agency A, the grid fingerprint and the ledger unchanged; withdrawing what was never available writes nothing; re-granting restores the choice, not the old state |
| Schema suite: S1o–S1s, S6k–S6n | Availability can name only an existing shared grid (23503); its scope column is not writable; enabling needs availability (PT404), and with the access trigger removed in a rolled-back probe the foreign key alone still refuses (23503). Withdrawing availability removes the access row and clears the selection; disabling keeps availability; deleting a shared grid removes its availability, access and selection |
| Concurrency scenario 9 (new; waits proven via `pg_stat_activity`) | 18 assertions. Withdrawal racing a first-ever enable, a selection and a copy, in both orders: the later operation waits on the agency's settings row; enable, select and copy after a withdrawal are refused (PT404); a withdrawal after them reports and clears what they did; a copy made while available keeps every rate |
| Negative controls | Removing the availability gate (trigger check and foreign key) makes the access suite fail at A4m; a catalog that ignores availability fails at A4l. By hand: removing only the trigger check still fails A4m, now on the foreign key's 23503 |
| Ops scripts | The new availability script is refused without its approval setting, and fails closed where the agency does not exist (`found 0`) and while the grid has no verified import here; so does the activation script |
| `scripts/run_commission_grids_tests.sh`, CI settings, PostgreSQL 16.15, C and `en_US.UTF-8` | PASS, 66 checks on each (59 concurrency assertions in 9 scenarios), no leftover databases |
| CI frontend job's exact command | 12 files passed / 2 skipped; 168 tests passed / 2 skipped (no frontend file changed) |
| `npx tsc --noEmit` / `npx tsc -p tsconfig.app.json --noEmit` | exit 0 / exit 2 with the same 84 diagnostics as before. Against `main`, the only textual difference is the pre-existing `Sidebar.tsx` diagnostic, moved from line 131 to 135 by the branch's nav item |
| ESLint, all 64 code files the branch changes (the concurrency script included) | 0 problems |
| `vite build` | OK |
| Checksums | schema `1f8e14fb2119eec01da44d3aff6ba34417c300451495f2028de501e7eb66da70` (was `84637cf3…`); operations `dc0c524b36abc4b97db83dfdd10ed9f62ab14fc4c9f8957ed0a56273a60c1c25` (was `7e3caad6…`); reference import `3cbe4d6947f725d5e4d9e52087ace0fba33a55827d92b7cec9d01d900e55bff0` (was `b8b2836b…`); schema rollback `4429ee9b…` (was `2adcf1cc…`); import rollback `aa943700…` (was `99cc1f24…`); new availability ops script `c484c040de8609c50938e2f0c5650c305b746ad9111764b55e0f1d57592051f6`; activation ops script `46c41c897f3dee875f3bc45d52269b9d08f41e66ce84aad65a50230f4455a08c` (was `47f91f70…`, header only). Unchanged: the operations rollback `593abb85…`, the import ops script `d2825d41…`, the synthetic fixture `9bad2737…` |

The full Vitest suite was not re-run: no `src/` file changed in this correction.

## Corrections made during closeout
1. **Synthetic data reproduced private examples.**
   - The closeout scan compared every added line with the private acceptance examples from the original request (D1).
   - Some synthetic fixture and test values reproduced those examples under synthetic names: two level-and-rate pairs (in four places), three scenario inputs, the off-grid example level, a product-name suffix, and an example amount in a code comment.
   - Those values, inputs and names were changed. The tests still prove the same behavior.
   - Nothing had been published, so the two code commits were rebuilt locally (`e9becf2` → `fea545d`, `c19117b` → `44d550a`). No commit on the branch contains the mirrored content.
   - A final scan of every added line and of the build output finds no private carrier or product name, example amount or example scenario.
   - Migrations and ops scripts are unchanged, and so are their checksums.
2. **Stale type-check comparison.**
   - The first app type-check comparison predated the last test edits.
   - Re-running it found one new diagnostic: a literal type inferred in a sidebar test's mock state. It is fixed in `44d550a`.
   - Every check in this record was then re-run on the final commit.
3. **`service_role` could write shared grids (pre-publication review, fixed in `14d9fa4` with Chris's approval).**
   - The schema migration granted `service_role` plain INSERT/UPDATE/DELETE on the seven data tables. A probe in a
     rolled-back transaction confirmed it could update a shared grid's rates, add products, delete references and
     deactivate it. That contradicted §3 of the plan: shared grids change only through the postgres-only import
     functions or a reviewed migration. It was never reachable from a browser role.
   - `service_role` now holds SELECT only on all eight comp tables. A9 asserts every direct write is refused
     (42501), and A10g pins the inventory at table and column level.
   - I1 now covers anon (with and without forged Agency Admin claims), an agent, an Agency Admin and `service_role`,
     each with no settings, with both operator approval settings, and with those plus a forged operation flag: the
     four privileged operations are refused (42501); editor-save and direct-write attempts on a shared grid are
     refused or change no row; the shared fingerprints, import ledger and revision are unchanged.
   - Two throwaway negative checks (not committed) show the new assertions bite: re-granting `service_role` DML
     fails A9c, and granting `authenticated` EXECUTE on the importer fails I1 at the agent identity.
   - Only the schema migration's checksum changed (§12). The operations and import migrations and both ops scripts
     are unchanged.

## Database proofs (runner steps, all PASS)
1. **Migration order and replays.** Operations before schema are refused, and so is import before operations. Replay of each migration is refused.
2. **Schema suite (S1–S6), run as the table owner.** Constraints and triggers alone refuse:
   - forged scope (nil, NULL, cross-agency, cross-grid);
   - bad levels; excess precision (87.555 and the 0.1+0.2 artefact); NaN/Infinity/negative/>300;
   - overlapping or mixed variants;
   - identity changes; stamp spoofing;
   - ineligible selections.
3. **Access suite (A1–A10)** as real `anon`/`authenticated`/`service_role` with JWT claims:
   - The roles covered: anon; agent; team leader; agency admin; inactive admin; home-org super admin; forged organization/role claims; an unknown subject; another agency; an ACTIVE Agency Group peer.
   - Catalog-only before enablement.
   - Direct table writes refused on every table.
   - With the operation flag forged, every cross-tenant, shared, ownership and audit write is still refused **before** any SECURITY DEFINER trigger runs.
   - With the trigger layer removed in a rolled-back probe, RLS alone refuses the same writes.
   - Exact inventories: function EXECUTE, column write grants, the SECURITY DEFINER set and pinned `search_path`.
   - `service_role` is read-only: no operations, no import, every direct write refused (A9, A10g).
4. **Operations suite (O1–O7):**
   - enable keeps an existing selection; retry-safe enable/disable; disable clears only its own selection; compare-and-set select;
   - blank, structure copy (0 rate rows, new ids) and full copy (every value and reference, new ids);
   - injected copy failure and silent row loss leave nothing;
   - changeset validation, stale revision (PT409), exact values, blanks and zeros, levels, variant rules, references, deletions;
   - context with active products only; deactivation clears the selection; overview, snapshot and deletion.
5. **Editor change sets against the real operation.** The real `comp_save_grid_changes` runs as an agency admin under RLS. The read-back equals the draft, and a stale change set is refused with nothing changed.
6. **Importer:**
   - 22 unit tests;
   - a deterministic synthetic artifact (byte-identical rebuild);
   - SQL/Python fingerprint parity;
   - import suite I1–I7: postgres-only privileges (anon, agent, Agency Admin and `service_role`, also with the operator approval settings and a forged operation flag), checksum and format checks, all-or-nothing failures, idempotent re-run, drift refusal (including drift in stored content), activation by exact unique name with an existing selection kept, multi-agency deactivation;
   - `\copy` reconciliation PASS in both directions;
   - both ops scripts refuse without their approval setting; the activation script fails closed where the agency does not exist.
7. **Negative controls.** Each weakening makes a named assertion fail:
   - a changed CSV value;
   - a no-op operation-context trigger;
   - a widened column grant;
   - dropped variant rules;
   - a dropped rate CHECK.
8. **Concurrency:** 41 assertions in 8 scenarios, with independent sessions. Waits are proven through `pg_stat_activity` (no sleeps):
   - first-use enable/select;
   - overlapping variants;
   - rate vs level removal;
   - selection or copy vs disable, deactivate and delete;
   - source edit vs copy;
   - deactivation across four agencies.
9. **Rollback.** Reverse order only. The schema rollback refuses while any row exists. An empty-database rollback leaves no object, and the migrations re-apply cleanly.

## Migration files vs applied versions

This older table records the **pre-release** state only. The newest section above verifies the actual production application and filenames.

| File | Applied anywhere hosted? |
|---|---|
| `20261015211858_commission_grids_schema.sql` | **No.** Applied only to disposable local databases |
| `20261016035150_commission_grids_operations.sql` | **No** (as above) |
| `20261016035626_commission_grids_reference_import.sql` | **No** (as above) |

Re-checked read-only on 2026-10-15, before the review correction edited the operations migration in place:
- production's migration history has no `20261015…` row and its catalog has no comp objects;
- the only Supabase preview branches (PRs #294 and #378) predate this feature;
- PR #447 has none.

Re-checked read-only again during release preparation (2026-10-15). The newest production migration is
`20261010172702`, there is no `20261015…` row, and there are no comp tables, functions or schema.

Re-checked read-only once more before the availability correction edited all three migrations in place
(2026-10-15): the same newest migration, no `20261015…` row, no comp objects, and the only Supabase branches
are the PR #294 and #378 previews.

## Private FFL validation (real data; value-free; 2026-10-15)

Kept apart from the synthetic results above (C5). It ran outside Git, against disposable loopback databases
only, following runbook §1–3. The private files sat in an ephemeral session directory outside the repository,
which is not durable storage (D1).

| Check | Result |
|---|---|
| Source | SHA-256 `998307b4ebab7f3ed0e6dfdf30457d4bd2b5f967c80f0068e04aa4f5ed631d08`, equal to the value Chris expected. 8,402 bytes, 57 data rows, ASCII, LF line endings |
| Importer 1.0.0 `validate --expect-products 41 --expect-variants 57 --expect-carriers 11` | PASS: 0 anomalies. 41 products, 57 variants, 11 carriers, 963 rate cells, 57 references |
| Independent source check (does not use the importer) | 49 PASS, 0 FAIL, 9 informational. 6 blank cells and 0 explicit zeros; no duplicate or overlapping variants; no mixed term definitions; notes agree with values; no rate rises as the level falls |
| Owner decision | Chris confirmed one source cell as authoritative. Recorded privately with its evidence |
| Artifact | SHA-256 `cf83d9923a261c531c709acaa24656cddca9d77ca850d332417262c953b78157`. Content fingerprint `273d0eb0fc144b21b812a5c6fa74daf44d18579fb3e0aa4a315439cc7ba3ffed`. Grid `6ad6d4e4-4024-5dae-bef5-de0202ab1b6e`. Three byte-identical builds; `verify` ok |
| Artifact against the CSV (independent comparison) | 16 PASS, 0 FAIL: products, variants, rate cells (exact text) and references equal in both directions; blank cells have no rate row |
| Disposable import (PostgreSQL 16.15; C and `en_US.UTF-8`) | `imported`. The ledger row and the stored-row fingerprint equal the manifest. Re-import `already_imported`. A missing approval and a wrong checksum are refused |
| Reconciliation | PASS on both clusters: 0 differences in products, variants, rate cells and references; levels equal; 0 inactive products |
| Reconciliation negative controls | 7 of 7 mutated CSV streams fail (exit 3): changed value, same number written differently, blank to zero, extra cell, dropped row, changed note, changed age |
| Activation rehearsal (synthetic people; agency resolved by name with a random id) | 21 PASS, 0 FAIL. Agent read, management denial and another agency's isolation all hold, and direct client writes to shared rows change nothing |
| Source-backed acceptance (`privateAcceptance.test.ts`) | 49 of 49 PASS: Chris's 8 required cases, 39 age, term, level and blank-cell boundaries, and 2 more. A negative control with 4 wrong expectations fails exactly those 4 |
| Re-run with the availability correction (D5): same CSV and artifact, corrected migrations, fresh disposable databases (C and `en_US.UTF-8`) | Import `imported` with the same fingerprint `273d0eb0…`; reconciliation PASS. Before availability, 4 PASS: no catalog entry for either agency, and the home agency's own admin is refused. The activation script, approved, is refused ("That AgentFlow grid is not available"). The availability script: `newly_available: true`, then `false` on a retry. Activation: `selected: true`. With synthetic people, 28 PASS: the home agent reads 41/57/963; the other agency's admin sees an empty catalog, is refused enabling, full and structure copies and selection by id (PT404), and with its agent reads 0 rows of every comp table; agents and team leaders cannot enable or read availability. Direct client writes change nothing. Withdrawal, 7 PASS: access and the selection go, the fingerprint and ledger stay, re-enabling is refused, and a repeat is a no-op. Re-granting and activating again restore the calculator. The exact MCP `execute_sql` batches pass in the same order |
| Re-checks with the same files | Acceptance 49 of 49; the acceptance cases regenerate byte-identically from the CSV; artifact against the CSV 16 PASS, 0 FAIL. No rate, source or artifact byte changed |

## Not verified
- CI on the head that carries this record (the availability correction). It is recorded in the PR description. On the release-preparation head `ae888d3`, all ten jobs passed, including PostgreSQL 17.6; on the review-correction head `2447c1b` as well.
- Any signed-in browser session against a real backend.
- Supabase advisors after applying: nothing was applied.
- Any production or preview behaviour.
- The real grid on any hosted database: nothing was imported, activated or applied anywhere hosted (release package, plan §12).
