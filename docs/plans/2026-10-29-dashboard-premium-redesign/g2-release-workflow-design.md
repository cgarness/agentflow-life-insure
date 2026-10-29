# G2 release route — protected GitHub Actions workflow (DESIGN ONLY, for separate review)

**Status (2026-10-29):** design only. Nothing in this document is implemented, merged, dispatched or applied. The
approved G2 migration is still NOT applied to `jncvvsvckxhqgqvkppmj` (read back after every attempt below).

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
- Filled in from the rehearsal (§6) before review:
  - `RECORDED_STATEMENTS` and `RECORDED_DIGEST`: the CLI splits the file client-side, as M3 showed.
  - Digests of the policy expressions, the function definitions and the ACLs.

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
| `apply-migration` | `before` | 1. Requires no idle-in-transaction or long client transaction.<br>2. Takes a snapshot: other history rows (full-row md5) and `public.clients` (count + md5 of `id`‖`updated_at`).<br>3. Runs `psql -X --set ON_ERROR_STOP=1 --single-transaction --file SOURCE` with a 120 s SIGINT watchdog; output is discarded, never logged.<br>4. Requires state `applied`, the read-backs, and both snapshots unchanged. |
| `record-history` | `applied` | 1. Re-runs the read-backs.<br>2. Runs `supabase migration repair 20261029120000 --status applied --db-url … --workdir <tmp>`. The temporary workdir holds only a byte copy at `20261029120000_dashboard_milestone_reviews.sql`, so the CLI reads its name and statements from that copy and executes none of it.<br>3. Requires state `recorded`; the row's name, statement count and digest match the pins; `created_by`, `idempotency_key` and `rollback` are null; every other history row is byte-identical. |
| `rollback-migration` | `applied`, `recorded` or `reverted-recorded` | Runs the `ROLLBACK` file in one transaction where the objects exist, then `migration repair … --status reverted` where a row exists. Requires state `before` and an unchanged clients snapshot. It drops any review rows; those are alert state only, and the rollback prints their count. Needs its own approval. |

The migration's own `SET lock_timeout = '2s'` means a busy `clients`, `organizations` or `auth.users` lock aborts the
whole transaction. The state stays `before`, the runner STOPs, and a new dispatch needs a new approval.

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
- `.github/workflows/dashboard-milestones-backend.yml`, so CI runs the 45-check SQL suite on PostgreSQL 17.6;
- the new release workflow, the runner and its test (§6).

**No `src/` file changes**, so the production build that a `main` commit triggers ships the same frontend. No Vercel
variable is set; `VITE_DASHBOARD_MILESTONE_REVIEWS` stays unset, so the review actions stay hidden. Merging that PR
is a `main` change and **needs Chris's explicit approval**, separate from G3. The identical files merge cleanly when
the feature branch lands later.

## 6. Proof before any dispatch

`scripts/tests/dashboard_milestones_release_test.py` has the shape of `scripts/tests/hierarchy_m3_history_record_test.py`.
It runs against a loopback PostgreSQL 17, the real pinned CLI 2.121.0, the existing harness, and a synthetic history
of 350 rows at the same head.

It proves:
- every stage and every state transition, including a rollback from each state;
- every refusal: wrong ref, wrong confirmation, wrong bytes, a top-level copy, partial objects, an unknown history
  state, a long transaction, and a lock timeout that leaves `before`;
- that no other file executes.

It also produces the `RECORDED_*` and read-back pins. CI runs it on the release-only PR.

## 7. Sequence (each step separately approved)

1. Chris approves this design.
2. Implement the runner, the test and the workflow on `claude/great-clarke-c1gpw6`, with rehearsal evidence and the
   pins filled in.
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
