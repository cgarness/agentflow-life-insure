# Commission Calculator + agency commission grids — verification record (local)

**Scope of this record:** the local implementation on `feature/commission-calculator-agency-grids`
(base `origin/main` `dacd921903a867de99276f8709f829995602c3bd`). Every result below was re-run on code commit
`14d9fa4`: the database layer `fea545d`, the frontend `44d550a` (no `src/` change since), and the pre-publication
`service_role` correction `14d9fa4`. The two original code commits were rebuilt locally during closeout, before any
publication; see "Corrections made during closeout".

**Kept separate, per C5:**
- This record covers synthetic data only.
- The private FFL import, reconciliation and source-backed acceptance have **not run** (BLOCKED, D4). Nothing here verifies real rates, the 41/57/11 inventory or any carrier-specific example.
- No hosted database or deployment was touched.

## Environments
- **Database:** disposable PostgreSQL **16.15** cluster.
  - Listens on 127.0.0.1 only, no Unix socket.
  - Data directory under the container's postgres home, removed after verification.
  - The runner refuses non-loopback URLs and clusters with Supabase platform roles.
- **Tooling:** Node 22 and npm with the existing lockfile (`npm ci`); Python 3.13 standard library only; Chromium through Playwright 1.56.1 (preinstalled) for synthetic renders.
- **PostgreSQL 17.6 (CI):** `.github/workflows/commission-grids.yml` is written, **but it has not run**, because the branch is not published. Do not call it verified until it runs.

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

| File | Applied anywhere hosted? |
|---|---|
| `20261015120000_commission_grids_schema.sql` | **No.** Applied only to disposable local databases |
| `20261015120100_commission_grids_operations.sql` | **No** (as above) |
| `20261015120200_commission_grids_reference_import.sql` | **No** (as above) |

## Not verified
- PostgreSQL 17.6 CI.
- Any signed-in browser session against a real backend.
- Supabase advisors after applying: nothing was applied.
- Any production or preview behaviour.
- All real-data checks (BLOCKED).
