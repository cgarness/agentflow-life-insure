# Local Automations acceptance

Run from the repository root on a disposable Linux machine with Docker, Node 22+, Deno 2.5.6, Chromium and Playwright 1.56.1. The harness binds ports 54333, 54334, 54340 and 8089 on loopback. Each run creates its own internal Docker network, native Supabase PostgreSQL 17.6 database, GoTrue and PostgREST. It generates temporary local credentials, disables cron execution, and runs the real signed-in app against this stack. The worker process uses an in-memory provider and permits native network access only to the local API. The production Vite configuration does not import this directory.

```bash
npm ci --no-audit --no-fund
tools_dir=$(mktemp -d)
npm install --prefix "$tools_dir" --no-package-lock --no-audit --no-fund playwright@1.56.1 deno@2.5.6
export PLAYWRIGHT_MODULE="$tools_dir/node_modules/playwright"
export DENO_BIN="$tools_dir/node_modules/.bin/deno"
export CHROMIUM_PATH="$(command -v chromium)"
bash e2e/automations-local/run.sh
```

The prerequisite manifest in `upgrade.sh` restores the repository's August schema baseline, SQL storage table fixtures, and the historical migrations exercised by the Automations integration. This verifies an upgrade on the specified fixture. Some historical production migrations have independent preimage, organization or activation requirements. The harness covers the relevant migrations without applying those activation scripts.

The browser test signs in three local users. Two admins author distinct graphs in the same agency, preview, publish and inspect their runs. A separate agency checks isolation. The test advances the saved due time directly in its disposable database to exercise a restart and an edit to the waiting workflow. Email and SMS payload assertions inspect synthetic transport receipts. The mobile/keyboard check visits Settings and Automations, tests 375 and 1440 pixel viewports in both themes, and reorders blocks by keyboard. The shared-session browser check exercises View As in two tabs and a separate login.

Automations V2 adds three browser scripts. `v2-workflows.mjs` drives the five workflows through the CRM's own entry points as signed-in users: a new lead, a saved disposition, a booked, rescheduled and cancelled appointment with a No-show outcome, a missed inbound call claimed through the callback functions, and a sale followed by a confirmed issuance, plus a text held for missing consent. `v2-editor.mjs` covers the add-step picker, the message editor, saved messages, Insert field, the three explicit saves, step names in history, concurrent edits, tenant isolation, and both layouts in both themes with screenshots. `v2-crm.mjs` then opens the screens V2 changed, at 1440 px and 375 px in both themes: a contact's timed automation task, the Confirm issuance dialog (cancelled, so nothing is confirmed), and the Inbounds callback list, where it claims and finishes a callback by hand. The Inbounds room is a build option, so `run.sh` serves the same checkout again with `VITE_INBOUNDS_ROOM=true` for that script. The contact screen is a fixed desktop layout anchored to the right edge. On a phone its right column, with the Tasks tab, stays on screen and the policies column is pushed off the left edge, so the issuance dialog is opened at desktop width and then checked at phone width.

The runner executes the session, authoring, runtime, message and backlog SQL fixtures, the five `automation_v2_*.sql` suites, and runs `concurrency.py` and `concurrency_v2.py` with independent PostgreSQL connections. It also runs the native SMS consent, sticky eligibility and signed callback tests using `scripts/tests/automations/channel-native.ts` and `receipt-native.ts` on a separate synthetic agency. Provider calls are handled in process. PostgreSQL and PostgREST handle the actual intent, receipt, callback and history writes.

Before the blank-install test, `legacy-upgrade.sh` takes a local pre-feature custom-format dump and restores it to a fresh `automation_legacy_rehearsal_*` database owned by the managed `postgres` role. The restore excludes the cron catalog, which is pinned to the cluster's primary database, and the unrelated GraphQL shim function ACL. It runs `supabase/tests/automation_upgrade.sql`, which creates a legacy graph, captures all six workflow tables, applies the eleven complete candidate migrations and compares the preserved records. The first-release and V2 authoring suites run afterward. `rollback-rehearsal.sh` then copies that upgraded database and rehearses the guarded V2 rollback: `supabase/tests/automation_v2_rollback.sql` on real V2 work, a refusal while any agency control is on, one successful apply, a refusal of a second apply, and the six first-release SQL suites on the rolled-back functions. The rehearsal database is removed with its disposable container.

To avoid Docker VFS duplicating the large upstream image on small disks, `LOCAL_POSTGRES_IMAGE` may select a locally flattened copy of the **same** `supabase/postgres:17.6.1.085` image with its entrypoint, command and environment preserved. Ordinary overlay-backed Docker can use the default upstream tag directly.

## Release and cutover rehearsal

Use the same dependencies and loopback ports listed above. The cutover runner serves the pinned legacy release and the current candidate at one origin, signs in to the legacy app, switches the frontend, applies the eleven candidate migrations in order, and exercises the actual agency visibility script. All test organizations and receipts are disposable.

```bash
bash e2e/automations-local/run.sh release
```

The `release` mode uses the 105 historical prerequisites from `upgrade.sh`. It checks unchanged legacy graph and execution records, installation deltas, an open legacy View As session, refresh and demotion, normal CRM access, fresh author logins, all four enrollment/dispatch combinations and a switch change during publish review. The real CRM triggers and worker authorization predicates are exercised inside rollback-only transactions for the control matrix. A separate two-author browser exercise commits two synthetic runs and inspects their receipts before the operator hides the builder. The rollback compares the complete stored rows for workflows, runs, versions, intents, messages, graph edges, contacts and history. `legacy-upgrade.sh` also runs the 15 negative sending-eligibility assertions in its dedicated database. For an approved local advisor query, supply `AUTOMATIONS_LOCAL_ADVISOR_SQL` and an output-file prefix in `AUTOMATIONS_LOCAL_ADVISOR_OUTPUT` to retain its before/after results.

```bash
LOCAL_POSTGRES_IMAGE=supabase/postgres:17.6.1.063 \
  bash e2e/automations-local/run.sh release-full /absolute/path/to/verified-schema-bundle
```

The full mode requires the current, privately transferred PostgreSQL 17 schema-only archive, its reviewed role inventory, canonical policy and RPC comparisons, version-only Auth migration ledger, verified Auth image, and independent source receipts. Restoration and fingerprint verification precede all fixture writes. An unsuccessful restore or mismatch stops the run. Keep the scoped prerequisite result and complete-schema result identified separately in release evidence. [Full archive acquisition and verification](../../docs/plans/2026-11-21-automations/schema-only-rehearsal.md)

## Backend-first rehearsal

Production already has the first release, so V2 reaches it database first. This mode rehearses that order and the rollback on one disposable stack. It needs the first-release commit `d85434f635bbf2d4118781e6d254798eef699363` in the checkout (`git fetch origin feat/self-service-automations`). That commit differs from the deployed frontend in three documentation files only.

```bash
bash e2e/automations-local/run.sh backend-first
```

1. `upgrade.sh pilot` installs the first release. `inflight-before.sql` commits one waiting and one queued run. `upgrade.sh v2` applies the seven V2 migrations, and `inflight-after.sql` shows both runs keep their state and complete.
2. The first release's own `builder.mjs`, frontend and worker run unchanged from a `git archive` of that commit against the V2 database.
3. The candidate frontend replaces it and `backend-first.mjs candidate` opens, saves and republishes those automations in the V2 editor.
4. Every agency is fenced, the first-release frontend is restored, the guarded rollback file is applied, and `backend-first.mjs rolled-back` checks what still runs, what is paused and that nothing was removed.
