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

The runner executes the session, authoring, runtime, message and backlog SQL fixtures and runs `concurrency.py` with independent PostgreSQL connections. It also runs the native SMS consent, sticky eligibility and signed callback tests using `scripts/tests/automations/channel-native.ts` and `receipt-native.ts` on a separate synthetic agency. Provider calls are handled in process. PostgreSQL and PostgREST handle the actual intent, receipt, callback and history writes.

Before the blank-install test, `legacy-upgrade.sh` takes a local pre-feature custom-format dump and restores it to a fresh `automation_legacy_rehearsal_*` database owned by the managed `postgres` role. The restore excludes the cron catalog, which is pinned to the cluster's primary database, and the unrelated GraphQL shim function ACL. It runs `supabase/tests/automation_upgrade.sql`, which creates a legacy graph, captures all six workflow tables, applies the four complete candidate migrations and compares the preserved records. The ordinary authoring policy suite runs afterward. The rehearsal database is removed with its disposable container.

To avoid Docker VFS duplicating the large upstream image on small disks, `LOCAL_POSTGRES_IMAGE` may select a locally flattened copy of the **same** `supabase/postgres:17.6.1.085` image with its entrypoint, command and environment preserved. Ordinary overlay-backed Docker can use the default upstream tag directly.

## Release and cutover rehearsal

Use the same dependencies and loopback ports listed above. The cutover runner serves the pinned legacy release and the current candidate at one origin, signs in to the legacy app, switches the frontend, applies the four candidate migrations in order, and exercises the actual agency visibility script. All test organizations and receipts are disposable.

```bash
bash e2e/automations-local/run.sh release
```

The `release` mode uses the 33 historical prerequisites from `upgrade.sh`. It checks unchanged legacy graph and execution records, installation deltas, an open legacy View As session, refresh and demotion, normal CRM access, fresh author logins, all four enrollment/dispatch combinations and a switch change during publish review. The real CRM triggers and worker authorization predicates are exercised inside rollback-only transactions for the control matrix. A separate two-author browser exercise commits two synthetic runs and inspects their receipts before the operator hides the builder. The rollback compares the complete stored rows for workflows, runs, versions, intents, messages, graph edges, contacts and history. `legacy-upgrade.sh` also runs the 15 negative sending-eligibility assertions in its dedicated database. For an approved local advisor query, supply `AUTOMATIONS_LOCAL_ADVISOR_SQL` and an output-file prefix in `AUTOMATIONS_LOCAL_ADVISOR_OUTPUT` to retain its before/after results.

```bash
LOCAL_POSTGRES_IMAGE=supabase/postgres:17.6.1.063 \
  bash e2e/automations-local/run.sh release-full /absolute/path/to/verified-schema-bundle
```

The full mode requires the current, privately transferred PostgreSQL 17 schema-only archive, its reviewed role inventory, canonical policy and RPC comparisons, version-only Auth migration ledger, verified Auth image, and independent source receipts. Restoration and fingerprint verification precede all fixture writes. An unsuccessful restore or mismatch stops the run. Keep the scoped prerequisite result and complete-schema result identified separately in release evidence. [Full archive acquisition and verification](../../docs/plans/2026-11-21-automations/schema-only-rehearsal.md)
