# G2 release route — protected GitHub Actions workflow (approved and executed; historical design below)

**Status (2026-10-29): G2 complete in production.** The protected release-only PR #501 merged at `78d532b`. GitHub runs #40925336827 (check), #40925926281 (apply-migration), and #40926621789 (record-history) completed successfully. Supabase independently confirms 351 history entries with `20261029120000_dashboard_milestone_reviews`, its 28-statement digest, the table, functions, trigger, RLS and grants. The migration's immutable 16,405 approved bytes are reconciled from `pending/` into the normal `supabase/migrations/` path on the G3 candidate branch, and the runner/test guard is re-pinned to that path. **The rest of this document is the historical reviewed pre-release design.** G3 frontend merge and Vercel activation remain unapproved and undeployed.

The migration it would apply is `supabase/migrations/pending/20261029120000_dashboard_milestone_reviews.sql`:
16,405 bytes, SHA-256 `e673749357f7612991cccf7405aa0f5f0a9ac49c798bfbd13b006d34f78d8806`. Its rollback is
`supabase/migrations/rollback/20261029120000_dashboard_milestone_reviews.rollback.sql`: 1,724 bytes, SHA-256
`08a2a897414b0e150ca5926f2ad40ae7c44ad796db4dadebd6d8a1253f4b98c6`. Neither file is changed by this design.

## 1. Why a protected workflow is required

| Route | Result on 2026-10-29 |
|---|---|
| Supabase MCP `apply_migration` | Called twice with the exact bytes. Both calls timed out after 60 s: Supabase's confirmation question never reached Chris. Nothing was applied either time. |
| Supabase CLI from this cloud session | **No production authentication.** There is no `SUPABASE_ACCESS_TOKEN`, no `SUPABASE_DB_PASSWORD` and no linked project. **The network policy also denies** `api.supabase.com` (the proxy answers 403 to CONNECT) and the database hosts (`db.jncvvsvckxhqgqvkppmj.supabase.co:5432` and the session pooler are unreachable). Stopped there, as instructed. |
| `supabase db push` (from anywhere) | **Unsafe; rejected.** See §2. |
| SQL Editor | Not used: it is an untracked workaround (instruction). |

The house precedent for a production database write without MCP is a dispatch-only, main-only workflow behind the
protected `google-sheets-production` environment. Chris is the required reviewer there and admin bypass is off. Two
workflows already use it:
- `.github/workflows/google-sheets-push-release.yml`: `apply-migration` uses psql with `--single-transaction`; then
  `record-history`.
- `.github/workflows/hierarchy-m3-history.yml` with `scripts/hierarchy_m3_history_record.py`: `migration repair`
  from a temporary workdir; run `40115718668`.

This design copies those two patterns. **It does not modify either workflow.**

## 2. Local migrations vs production history (read-only, 2026-10-29)

- Production history: **350 rows**, head `20261028040215 standard_lead_fields`.
- Local `supabase/migrations/*.sql`: **84 files**. 72 of them match a recorded version.
- **278 recorded versions have no local file.** This is pre-baseline history. `db push` refuses in this state unless
  you pass `--include-all` or run a history repair.
- **12 local files are not recorded under their own version.** `db push` would try to execute every one of them, and
  11 of them are already live under another version:

| Local file | Recorded in production as |
|---|---|
| `20260806000000_baseline_production_schema.sql` | not recorded (baseline; see the reconciliation runbook) |
| `20261005194649_sms_consent_dispatch.sql` | `20261008022319` |
| `20261008024220_cg_financial_number_event_reconcile.sql` | `20261008024411` |
| `20261008033044_cg_financial_sms_recovery.sql` | `20261008033218` |
| `20261008035004_cg_financial_sms_activate.sql` | `20261008035126` |
| `20261008144711_manual_sms_dispatch.sql` | `20261008151523` |
| `20261018002956_uv_profile_sync.sql` | `20261018064601` |
| `20261018170007_uv_profile_exclusions.sql` | `20261019001339` |
| `20261019013824_uv_agency_profile_activation.sql` | `20261019014028` |
| `20261019015242_uv_profile_save_driven.sql` | `20261019021934` |
| `20261019032157_uv_profile_verification_wizard.sql` | `20261019035819` |
| `20261020171244_uv_personal_brand.sql` | `20261020192723` |

A `db push` dry-run therefore cannot show "only `dashboard_milestone_reviews`". **That is the STOP condition in the
instructions.** These files are unrelated to this work and are not touched here; reconciling their filenames is a
separate, approved task. The release below never runs `db push` or `migration up`: it executes exactly one file.

## 3. Proposed workflow — exact file (NEW: `.github/workflows/dashboard-milestones-release.yml`)

```yaml
name: Dashboard milestone reviews G2 release (approval required)
# Manual, main only. Applies ONLY the approved G2 migration
# supabase/migrations/pending/20261029120000_dashboard_milestone_reviews.sql (16,405 bytes, SHA-256 e6737493…8806)
# to jncvvsvckxhqgqvkppmj in one psql transaction, then records it as 20261029120000 with the pinned CLI's
# `migration repair --status applied`. Never db push / migration up; no other migration can run. No frontend flag,
# Vercel variable or deploy is touched. Each dispatch needs Chris's separate approval, then the protected
# environment's review. Runner: scripts/dashboard_milestones_release.py.
# Design: docs/plans/2026-10-29-dashboard-premium-redesign/g2-release-workflow-design.md.
on:
  workflow_dispatch:
    inputs:
      stage:
        description: Separately approved stage (check is read-only)
        required: true
        type: choice
        options: [check, apply-migration, record-history, rollback-migration]
      confirm:
        description: Repeat the stage name exactly
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: dashboard-milestones-release
  cancel-in-progress: false
jobs:
  environment-guard:
    if: github.ref == 'refs/heads/main'
    name: Protected environment verified (no secrets)
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      actions: read
      deployments: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - name: Required reviewer cgarness, main only, administrator bypass off
        env:
          GH_TOKEN: ${{ github.token }}
        run: python3 -I scripts/dashboard_milestones_release.py guard-environment
  release:
    needs: environment-guard
    if: github.ref == 'refs/heads/main'
    name: ${{ inputs.stage }} — G2 only, frontend flags untouched
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: google-sheets-production
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - name: Install psql (no credentials)
        run: sudo apt-get update -qq && sudo apt-get install -y postgresql-client-16
      - uses: supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf # v2.1.1
        with:
          version: 2.121.0
      - name: Execute only the approved stage
        env:
          STAGE: ${{ inputs.stage }}
          CONFIRM: ${{ inputs.confirm }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
          SUPABASE_POOLER_HOST: ${{ secrets.SUPABASE_POOLER_HOST }}
        run: python3 -I scripts/dashboard_milestones_release.py run
```

Only the two secrets the hierarchy runner already uses are exposed. The workflow needs no access token, because
nothing calls the Management API.

## 4. Runner contract (NEW: `scripts/dashboard_milestones_release.py`)

The runner has the structure of `scripts/hierarchy_m3_history_record.py`: the same `Stop`/`require` labels, the same
secret hygiene and the same `guard-environment` checks.

**Pinned constants:**
- Project and environment: `REF=jncvvsvckxhqgqvkppmj`, `ENVIRONMENT=google-sheets-production`, `REVIEWER=cgarness`.
- Migration identity: `VERSION=20261029120000`, `NAME=dashboard_milestone_reviews`.
- Files: `SOURCE` (pending path, 16,405 bytes, `e6737493…`) and `ROLLBACK` (1,724 bytes, `08a2a897…`).
- `CLI_VERSION=2.121.0`.
- Production before the release: `HISTORY_BEFORE=350`, `HEAD_BEFORE=20261028040215`.
- The recorded row: CLI 2.121.0 splits these bytes client-side into **28 statements**, and their concatenation hashes
  to `07cabc94f4a42c2c0d9a7c1265c9aa622eee65af14bb26dc9889b878d9765ec7`. The real CLI reproduced this in the rehearsal.
- The RLS dependency: `md5(pg_get_functiondef(public.get_org_id()))` = `fb1d12f537aac3b3ed18c9e0628f2251`. This is
  production's value, read on 2026-10-29, and it matches the harness copy.
- Read-back pins, deparsed under `search_path = pg_catalog`, from the rehearsal:
  - the exact column list and the trigger definition;
  - SHA-256 digests of the constraint, index and policy-expression texts;
  - grants expanded with `aclexplode`, so the owner's version-specific privilege letters don't matter;
  - for each function: `md5(prosrc)` (the body bytes from the file), `prosecdef`, `provolatile`, `proconfig`, the
    return type, and whether it has a comment.

**Gates on every stage, in order (any failure is a STOP, with no retry and no next stage):**
1. `GITHUB_REF == refs/heads/main`, and `CONFIRM == STAGE`, which must be one of the four stages.
2. The bytes and SHA-256 of `SOURCE` and `ROLLBACK` match the pins.
3. Exactly one `*_dashboard_milestone_reviews.sql` exists, in `pending/`. None exists at top level, so the Supabase
   integration can't pick it up.
4. The CLI is `2.121.0`, and `migration repair --help` lists `--db-url`, `--status` and `--workdir`.
5. The host matches the approved session-pooler regex. The password is present and masked, and the only process that
   receives it is psql, through its environment.
6. The connection identity is `postgres.jncvvsvckxhqgqvkppmj@…:5432/postgres`, TLS is on, and the session is
   `postgres|postgres`.
7. Every check runs in its own read-only session, with `default_transaction_read_only = on` and a 30 s timeout.

**State classifier.** One read-only query returns: history count | max(version) | rows at `VERSION` | rows named
`NAME` | presence of {table, set RPC, clear RPC, guard function}. Exactly these states are recognized:

| State | Value |
|---|---|
| `before` | `350\|20261028040215\|0\|0\|0000` |
| `applied` | `350\|20261028040215\|0\|0\|1111` |
| `recorded` | `351\|20261029120000\|1\|1\|1111` |
| `reverted-recorded` | `351\|20261029120000\|1\|1\|0000` (an interrupted rollback) |

Anything else STOPs. That includes partial objects and any other migration landing first: the pins then need
re-review, and a re-version if a newer version exceeds `20261029120000`.

**Stages:**

| Stage | Needs | Does |
|---|---|---|
| `check` | any recognized state | read-only; runs the read-backs when the objects exist |
| `apply-migration` | `before` | 1. Runs the `get_org_id` dependency gate.<br>2. Takes a snapshot: the schema fingerprint (R-2: catalog only, no CRM rows) and the other history rows (full-row md5).<br>3. Runs `psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate --single-transaction --file -`, fed the checksummed bytes on stdin, with a 120 s SIGINT watchdog and a SIGTERM/SIGINT cancel handler. Output is discarded; only the SQLSTATE codes are matched, never logged.<br>4. Requires state `applied`, every read-back, 0 rows in the new table, and both snapshots unchanged. |
| `record-history` | `applied` | 1. Re-runs the read-backs.<br>2. Runs `supabase migration repair 20261029120000 --status applied --db-url … --workdir <tmp>`. The temporary workdir holds only a byte copy at `20261029120000_dashboard_milestone_reviews.sql`, so the CLI reads its name and statements from that copy and executes none of it.<br>3. Requires state `recorded`; the row's name, statement count and digest match the pins; `created_by`, `idempotency_key` and `rollback` are null; every other history row is byte-identical. |
| `rollback-migration` | `applied`, `recorded` or `reverted-recorded` | **R-1: refuses while any milestone review row exists.** There is a read-only pre-check, and the same check runs again inside the rollback transaction after `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` (custom SQLSTATE `DMR01`), so no row can appear between the check and the drop. Destroying review records needs a separately approved, verified recovery procedure, which this workflow does not provide.<br>With no rows: the `ROLLBACK` file runs in one transaction where the objects exist, then `migration repair … --status reverted` runs where a history row exists. Requires state `before`, an unchanged schema fingerprint, and the other history rows byte-identical. Needs its own approval. |

The migration's own `SET lock_timeout = '2s'` means a busy `clients`, `organizations` or `auth.users` lock aborts the
whole transaction (SQLSTATE 55P03). The state stays `before`, and the runner reports `STATE AFTER FAILURE: before`
and STOPs. A new dispatch needs a new approval.

After any failed write, the runner prints the state it left (`STATE AFTER FAILURE: …`, a read-only read-back). An
interrupted stage therefore always resolves to a recognized state that the next approved stage can continue from.

**Production CRM activity (R-2).** No check reads or fingerprints CRM rows. The invariants are:
- the schema outside the new objects: relations with their ACLs and options, columns, constraints, user triggers,
  policies, views, routines, types, schema ACLs and default privileges in `public` and `private`;
- the migration history.

Client inserts, updates and deletes change neither. Neither do `ANALYZE` or `VACUUM` (the rehearsal proves this).
Production read-only checks on 2026-10-29:
- the fingerprint query runs on production's catalog (5,892 entries);
- the state classifier returns `350|20261028040215|0|0|0000`;
- there are no partitioned tables.

A CRM write that is waiting for its lock can be delayed by at most the 2 s lock window. After that, either the
migration's short transaction has committed or it has rolled back.

**Read-backs** run read-only after `apply-migration` and `record-history`, and in `check`:
- **Table:**
  - the 12 columns with their types, nullability and defaults;
  - the PK; 3 FKs, each `ON DELETE CASCADE` (organizations, auth.users, clients);
  - the 5 named CHECK constraints.
- **Indexes and trigger:**
  - the 4 named indexes plus the pkey, with the partial predicates of the two unique indexes;
  - the trigger `dashboard_milestone_reviews_guard`: BEFORE INSERT OR UPDATE, FOR EACH ROW, running
    `private.dashboard_milestone_reviews_guard()`.
- **RLS:** enabled and not forced. Exactly 4 policies (select, insert, update, delete), all `TO authenticated`, with
  expression digests that match the pins.
- **Table ACL:** exactly owner `postgres`, `authenticated=arwd` and `service_role=r`. Nothing for `anon` or `PUBLIC`.
- **Functions:**
  - The `set_` and `clear_` RPCs: `prosecdef = false`, volatile, `proconfig = {search_path=pg_catalog, pg_temp}`.
  - Their EXECUTE grant goes to `authenticated` only (plus the owner): none for `PUBLIC`, `anon` or `service_role`.
  - The guard function: no EXECUTE for any client role.
  - The definition digests of all three match the pins.
- **Data:** the table holds 0 rows. The clients snapshot and the other history rows are unchanged.

**Output hygiene** is the same as the existing runners:
- Only fixed PASS/STOP labels are printed: no SQL, error bodies, hostnames or URLs.
- `::add-mask::` covers the password, the encoded password and the URL.
- Any unexpected exception prints a generic STOP.

## 5. How it reaches `main` without releasing the frontend (G3 stays gated)

A `workflow_dispatch` workflow can only be dispatched once it is on `main`. Merging this feature branch would also
ship the G1 frontend, which is G3. So the proposal is a **separate release-only PR** from a fresh branch off `main`,
carrying only:
- the migration (still in `pending/`, byte-identical) and its rollback;
- `supabase/tests/dashboard_milestone_reviews{,_harness}.sql` and `scripts/run_dashboard_milestone_tests.sh`;
- `.github/workflows/dashboard-milestones-backend.yml`: the 45-check SQL suite, the runner rehearsal and the live
  environment guard, all on PostgreSQL 17.6;
- the new release workflow, the runner and its test (§6);
- this design document and a `WORK_LOG.md` entry.

**No `src/` file changes**, so the production build that a `main` commit triggers ships the same frontend. No Vercel
variable is set; `VITE_DASHBOARD_MILESTONE_REVIEWS` stays unset, so the review actions stay hidden. Merging that PR
is a `main` change and **needs Chris's explicit approval**, separate from G3. The identical files merge cleanly when
the feature branch lands later.

## 6. Proof before any dispatch

`scripts/tests/dashboard_milestones_release_test.py` has the shape of `scripts/tests/hierarchy_m3_history_record_test.py`.
It runs against:
- a loopback PostgreSQL with TLS on port 5432 (the identity gate pins that port);
- the real pinned CLI 2.121.0, connected as a role that can only touch the history table;
- the G2 harness, a synthetic history of 350 rows at production's head, and 200 synthetic clients;
- a checkout copy carrying four decoy migrations.

The CI job `release-runner` in `dashboard-milestones-backend.yml` runs it on the official `postgres:17.6` image,
pinned by digest. The job `environment-guard` runs the live, secret-free check of the protected environment.

**Rehearsal on 2026-10-29 (local PostgreSQL 16.15 with TLS): `ALL PASSED: 38 checks`.**
- **Workflow and runner text:**
  - dispatch only, main only, four typed stages;
  - only the two database secrets, a pinned checkout and the pinned CLI;
  - no `db push`, `migration up`, reset, `--linked` or `--include-all`, and no reference to Vercel or the flags.
- **Environment guard:** 11 weakened configurations fail closed.
- **Gates (R-3, R-4):** each of these is refused:
  - a non-main ref, an unconfirmed stage or an unknown stage;
  - a one-bit or one-byte change to the migration or the rollback;
  - a top-level copy, a second pending copy or a second rollback;
  - a wrong CLI version or a CLI without the reviewed flags;
  - a direct, look-alike or loopback host;
  - another user, no TLS, or a session that isn't `postgres/postgres`.
- **Drifted states:** refused by all four stages, with nothing written:
  - a later head;
  - G2 recorded under another version;
  - a missing history row;
  - a partial object;
  - a changed `get_org_id()`;
  - out-of-order stages.
- **Full release under live CRM traffic (R-2):**
  - The background traffic committed about 1,400 insert/update/delete cycles on clients, and never failed.
  - `apply-migration` → applied, `record-history` → recorded: 28 statements, digest `07cabc94…`.
  - The only SQL executed was the approved migration, once, identified by SHA-256.
  - The only CLI call was a single `migration repair`, and none of the decoys ran (R-5).
- **Interrupted stages:** each one ends in a recognized state, and the next approved stage recovers from it:
  - a lock timeout, the watchdog, or a SIGTERM cancel → `before`;
  - a runner lost after the commit → `applied`;
  - a CLI that reports success but writes nothing → caught;
  - a record-history lost after its write → `recorded`;
  - a rollback lost between its SQL and the history revert → `reverted-recorded`, which then completes.
- **Rollback (R-1):**
  - A review row stored through the real RPC makes `rollback-migration` refuse before any write.
  - A row that slips past the pre-check is caught inside the locked transaction, and the row stays intact.
  - With no rows, rollback returns the exact pre-release fingerprint, from `recorded` and from `applied`.
- **Read-back:** each of 13 weakened or altered objects fails with its label: grants, RLS, policies,
  SECURITY DEFINER, EXECUTE, a check, a partial index, a disabled trigger, a column. An unrelated schema change
  during apply is caught by the fingerprint.
- **Secrets:** none of 136 captured runner outputs contains a password or a connection URL.

The same database also passed the existing SQL suite (`scripts/run_dashboard_milestone_tests.sh`): 45 checks, both
negative controls and the rollback proof.

## 7. Sequence (each step separately approved)

1. ✅ Chris approved this design with safeguards (2026-10-29).
2. ✅ The runner, the test and the workflow are implemented, with the rehearsal evidence (§6) and the pins filled in.
3. Open the release-only PR to `main` and get CI green. **Chris approves the merge** (no frontend change).
4. Dispatch `check`: read-only; it must report `before`.
5. Dispatch `apply-migration`, then the environment review. Then an independent MCP read-only read-back plus the
   security and performance advisors, compared with the baselines (security 256, performance 464).
6. Dispatch `record-history`. History then shows `20261029120000 dashboard_milestone_reviews`.
7. On the feature branch:
   - Move the file from `pending/` to `supabase/migrations/20261029120000_dashboard_milestone_reviews.sql`, bytes
     unchanged. The version already matches, because the CLI records the filename version, unlike `apply_migration`.
   - Regenerate the types and drop the `(supabase as any)` casts.
   - Run focused verification and update `WORK_LOG.md`.
8. G3 (merge, Vercel variables) remains a separate gate.

## 8. Alternative considered: a credentialed cloud session (not recommended)

The CLI route asked for in the instructions would need two environment changes:
- `SUPABASE_DB_PASSWORD` and `SUPABASE_POOLER_HOST` (or an access token) stored as environment secrets;
- the pooler host (and `api.supabase.com` for an access token) allowed under Network access.

A new session would then run the same runner locally. It is not recommended:
- a production write credential would sit in an agent container for the whole session;
- no per-run protected review would apply;
- the repository already has a reviewed, audited route (§1).

`db push` stays rejected on either route (§2).

## 9. Safeguards in Chris's approval and where each is enforced

| # | Requirement | Enforced by |
|---|---|---|
| R-1 | The rollback never destroys review records without separate approval and a verified recovery procedure | A read-only pre-check, then the same check inside the locked rollback transaction (`DMR01`). This workflow has no path that deletes review rows. |
| R-2 | Normal CRM activity can't cause a false failure | The schema-only fingerprint plus the history snapshot; no CRM data is checked. Rehearsed under live client traffic, mass updates, `ANALYZE` and `VACUUM`. |
| R-3 | The migration stays byte-identical (`e6737493…`) | The files gate checks byte length and SHA-256. The SQL is fed to psql from those same bytes on stdin, and the repair workdir copy is re-hashed. |
| R-4 | Protected environment, identity, checksums and separate stages are preserved | The `environment-guard` job; the pooler, TLS and identity gates; four typed, confirmed stages, each needing its own dispatch. |
| R-5 | No unrelated migration ever executes | Only `SOURCE` and `ROLLBACK` bytes are executed. The repair workdir holds only this migration. There is no `db push` or `migration up`. Decoys are proven never to run. |
| R-6 | The Google Sheets and hierarchy workflows are untouched | This is a new file. The release-only PR's file list contains neither of them. |
| R-7 | The full isolated rehearsal is run | §6: 38 checks pass, including the security failures and interrupted-stage recovery. CI repeats them on 17.6. |
| R-8 | A release-only PR with its link, file list, CI and risks | The PR description, and the report to Chris. |

## 10. Remaining risks (for the merge decision)

- **Exact production pins.**
  - The runner expects exactly 350 history rows at head `20261028040215`, and `get_org_id()` at `fb1d12f5…`.
  - If any other migration lands first, every stage STOPs. Re-pinning is a reviewed change; if the new head is later
    than `20261029120000`, this migration also needs a new version.
- **The read-back pins were derived on PostgreSQL 16.15 locally.** Production runs 17.6.
  - The CI job re-derives nothing: it asserts the same pins on `postgres:17.6`. A deparse difference would show up
    there as a red check before the merge, not in production.
- **A 2-second lock window.** While the migration waits for its locks on `clients`, `organizations` and `auth.users`,
  writes to those tables queue behind it for at most 2 s. After that it either commits (milliseconds) or rolls back.
- **The rollback order is still manual.** The rollback should follow a frontend rollback, or
  `VITE_DASHBOARD_MILESTONE_REVIEWS` being unset. The runner can't see Vercel. With the flags never set, review rows
  should not exist, and R-1 refuses if any do.
- **After the release, the runner is pinned to `pending/`.** The follow-up that moves the file to
  `supabase/migrations/20261029120000_dashboard_milestone_reviews.sql` must also update `SOURCE` and the files gate,
  as the hierarchy runner was updated. Until then, `check` still verifies production read-only.
- **The live environment guard needs the GitHub token's `actions`/`deployments` read permissions**, as in
  `hierarchy-stabilization.yml`. CI shows whether the settings still match.
