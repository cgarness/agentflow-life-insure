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
