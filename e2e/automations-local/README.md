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

Automations V2 adds three browser scripts. `v2-workflows.mjs` drives the five workflows through the CRM's own entry points as signed-in users: a new lead, a saved disposition, a booked, rescheduled and cancelled appointment with a No-show outcome, a missed inbound call claimed through the callback functions, and a sale followed by a confirmed issuance, plus a text held for missing consent. `v2-editor.mjs` covers the add-step picker, the message editor, saved messages, Insert field, the three explicit saves, step names in history, concurrent edits, tenant isolation, and both layouts in both themes with screenshots. `v2-crm.mjs` then opens the screens V2 changed, at 1440 px and 375 px in both themes: a contact's timed automation task, the Confirm issuance dialog (cancelled, so nothing is confirmed), and the Inbounds callback list, where it claims and finishes a callback by hand. The Inbounds room is a build option, so `run.sh` serves the same checkout again with `VITE_INBOUNDS_ROOM=true` for that script. For an agency in the pilot the contact screen pans sideways on a phone: it opens on its right-hand view, with Call, Schedule and the Tasks tab, and the script drags it with a finger (dispatched touch events) to the policies, then taps the policy row and Confirm issuance without any further sideways pan, and saves one confirmation. An agency outside the pilot keeps the production phone layout, gets no issuance list or control, has its confirmation refused by the server and sees no callback list.

The runner executes the session, authoring, runtime, message and backlog SQL fixtures, the five `automation_v2_*.sql` suites, and runs `concurrency.py` and `concurrency_v2.py` with independent PostgreSQL connections. It also runs these native tests on a separate synthetic agency:
- the SMS consent, sticky eligibility and signed callback tests in `scripts/tests/automations/channel-native.ts` and `receipt-native.ts`;
- `appointment-handoff-native.ts`. The worker picks up five reminder texts. Two appointments are moved or cancelled before the worker starts on them, and two more just before the final authorization (an injected request on the synthetic transport). Only the unchanged reminder reaches the synthetic provider, and `appointment-handoff-check.sql` confirms what each run recorded and how the next lease settles it. Provider calls are handled in process. PostgreSQL and PostgREST handle the actual intent, receipt, callback and history writes.

Before the blank-install test, `legacy-upgrade.sh` takes a local pre-feature custom-format dump and restores it to a fresh `automation_legacy_rehearsal_*` database owned by the managed `postgres` role. The restore excludes the cron catalog, which is pinned to the cluster's primary database, and the unrelated GraphQL shim function ACL. It runs `supabase/tests/automation_upgrade.sql`, which creates a legacy graph, captures all six workflow tables, applies the twelve candidate migrations (the four of the first release, the first-text sender and the seven V2 files) and compares the preserved records. The first-release and V2 authoring suites run afterward. `rollback-rehearsal.sh` then copies that upgraded database and rehearses the guarded V2 rollback: `supabase/tests/automation_v2_rollback.sql` on real V2 work, a refusal while any agency control is on, one successful apply, a refusal of a second apply, and the six first-release SQL suites on the rolled-back functions. The rehearsal database is removed with its disposable container.

To avoid Docker VFS duplicating the large upstream image on small disks, `LOCAL_POSTGRES_IMAGE` may select a locally flattened copy of the **same** `supabase/postgres:17.6.1.085` image with its entrypoint, command and environment preserved. Ordinary overlay-backed Docker can use the default upstream tag directly.

## Release and cutover rehearsal

Use the same dependencies and loopback ports listed above. The cutover runner serves the pinned legacy release and the current candidate at one origin, signs in to the legacy app, switches the frontend, applies the twelve candidate migrations in order, and exercises the actual agency visibility script. All test organizations and receipts are disposable.

```bash
bash e2e/automations-local/run.sh release
```

The `release` mode uses the 105 historical prerequisites from `upgrade.sh`. It checks unchanged legacy graph and execution records, installation deltas, an open legacy View As session, refresh and demotion, normal CRM access, fresh author logins, all four enrollment/dispatch combinations and a switch change during publish review. The real CRM triggers and worker authorization predicates are exercised inside rollback-only transactions for the control matrix. A separate two-author browser exercise commits two synthetic runs and inspects their receipts before the operator hides the builder. The rollback compares the complete stored rows for workflows, runs, versions, intents, messages, graph edges, contacts and history. `legacy-upgrade.sh` also runs the 15 negative sending-eligibility assertions in its dedicated database. For an approved local advisor query, supply `AUTOMATIONS_LOCAL_ADVISOR_SQL` and an output-file prefix in `AUTOMATIONS_LOCAL_ADVISOR_OUTPUT` to retain its before/after results.

```bash
bash e2e/automations-local/run.sh release-full /path/to/bundle /path/to/receipts
```

The full mode takes two directories, which must not contain each other.

- **ARCHIVE** is the bundle `make-schema-bundle.sh` writes on the operator's computer:
  - the PostgreSQL 17 schema-only archive;
  - the password-free role inventory;
  - a fingerprint reading before and after the dump;
  - the canonical reading;
  - the Auth version list;
  - the extension ownership reading (`extension-ownership.json`, written by `extension-ownership.sql`, format 2): who owns each extension and each of its members, the initial privileges extension scripts recorded, and the shared dependencies PostgreSQL 17 keeps for them (each extension's owner, and each role an initial privilege names), which a schema-only dump cannot carry;
  - `SHA256SUMS` over all seven.
- **RECEIPTS** holds the three readings `capture-receipts.sh` takes from the source through the Supabase Management API, another channel than the bundle's database connection: `schema-fingerprint.json`, `canonical.json` and `auth.json`. Every reading names the connection that took it (`mgmt-api` for the Management API, `agentflow-schema-bundle` for the bundle).

`receipts.py` refuses the run before anything is restored when:

- a receipt sits inside the bundle, or is one of its files, byte for byte or reformatted;
- the schema receipt was read through the bundle's own connection, or at the same moment as one of its readings;
- any receipt names another connection than the Management API's own (`mgmt-api`), such as the bundle's or a default `psql` login (the synthetic rehearsal's channel is `agentflow-receipt-channel`); the name is what the reading reports, so a reading deliberately labelled `mgmt-api` is not caught;
- a fingerprint is not format 3;
- a canonical reading has no capture time;
- a reading is more than two hours from the dump, or the receipts are more than 72 hours old;
- the bundle's readings differ from each other or from the receipt;
- the extension ownership reading is missing, not format 2, malformed, read through another connection than the bundle's, or not taken between its two schema readings.

`make-schema-bundle.sh` stops before the dump, printing a count only, when the source has an invalid index (pg_dump leaves it out) or a table whose TOAST table keeps storage settings (`toast.*`) although no remaining column needs a TOAST table, so a restore would not create it. That check is cautious: a remaining bounded column wide enough to need a TOAST table, such as `varchar(3000)`, also stops it. Production had neither when read on November 25.

The restore runs in two passes around one step:

1. Every archive entry except the privileges (the ACL and DEFAULT ACL entries; the database's own ACL stays here, the only pass pg_restore runs with `--create`). Every extension and member is then the restoring superuser's, with a fresh install's initial privileges.
2. `extension-ownership-restore.sql`, in one transaction, from the bundle's reading:
   - each extension and member gets its source owner (production's pgcrypto, uuid-ossp and pg_stat_statements belong to postgres). Row and array types, multirange types and serial or identity sequences follow the object they belong to. Members are matched by the address the reading records, so prefix operators are found too;
   - the initial privileges extension scripts recorded become exactly the source's;
   - each object outside any extension that has such initial privileges gets them as its privileges, each granted by its own grantor. On production these are the schemas graphql and graphql_public, which pg_graphql's removal left behind; pg_dump writes an object's privileges as a change from its initial privileges, so the archive holds no grant for them;
   - the shared dependencies PostgreSQL keeps for all of these (pg_shdepend) are rewritten and checked against the reading. Production's equal what the step rebuilds (read on November 26);
   - nothing changes where no fingerprint family reads: a reading whose initial privileges or member owners differ from the restore's in `pg_catalog`, `information_schema`, `pg_toast` or another `pg_` schema is refused, naming the object;
   - it prints one line of counts.
3. The archive's privileges, in archive order, on the owners and initial privileges pg_dump wrote them against. Supabase's DDL event triggers exist by then; the one these commands fire only sends PostgREST a reload notice, and no service is running yet.

Only an archive that still holds pg_graphql restores its GraphQL bootstrap entries before the extension. One with only the placeholder `graphql_public.graphql()` that Supabase leaves when pg_graphql is dropped (production's case) does not need them. The comparison with the receipt still decides: a reading that does not describe the source leaves the copy unlike it.

The step is meant to run once, between the passes: run again on a finished copy, it would set the privileges of an object outside any extension back to its initial privileges. It cannot reproduce three histories, and each stops the run (production has none): a statistics object an extension script created on one of its tables keeps the restoring superuser as owner; a privilege outside any extension that a role other than the owner granted and later revoked comes back, because pg_dump writes that REVOKE without its grantor; and a member foreign-data wrapper cannot be given an owner that is not a superuser.

When the step stops, its line (`Reproducing the source's extension ownership failed: ERROR: ...`) names what it could not do: the restore lacks something the reading names (`... is not an extension member in the restore`, `... which the restore cannot hold`, `The restored extensions are not the ones the source reading lists.`); an owner cannot be set (`... is not a restored role`, `... cannot be given its source owner`, `... did not take its source owner`, or `permission denied to change owner of foreign-data wrapper`, whose owner must be a superuser); privileges outside any extension cannot be given (`... which is in no extension ...`); the reading would change what no family reads (`... no fingerprint family reads ...`); the shared dependencies differ from the reading (`The restore's shared dependencies on roles differ from the source reading: ...`; production's matched what the step rebuilds when read on November 26 at 04:41 UTC); or another PostgreSQL error. A restore pass that fails prints PostgreSQL's error, and the privileges pass the GRANT or REVOKE that failed.

After that, every database the migrations and rollbacks touch is a faithful copy checked against the receipt or against the database it was copied from:

- The restored primary database is checked before and after Auth starts.
- The installation base is a faithful template copy (`faithful-copy.sh`: owner, privileges and settings included), checked against the restored database and the receipt.
- Each of the 35 interrupted-install copies is checked against the database it was copied from before anything is applied.
- The full rollback on real V2 work runs on another verified copy.
- The base is checked once more at the end.

`schema-fingerprint.sql` (format 3) defines 50 families. A reading lists those that hold objects: 36 on production when read on November 26 at 03:04 UTC, 35 on the synthetic stand-in, which has no Realtime partitions. Any family present in only one of two readings is a difference. It covers:

- every non-system schema, including the managed ones;
- roles, memberships, and database and role settings;
- default, initial and catalog-object privileges, and parameter grants;
- security labels, sequence ownership, partition keys and replica identity;
- casts created after initdb (between built-in types included) and disabled internal foreign-key triggers;
- in the system schemas (`pg_catalog`, `information_schema`), every object created after initdb outside any extension, every object in `pg_toast` other than TOAST tables and the indexes on them (PostgreSQL makes those, an interrupted `REINDEX CONCURRENTLY` included, and pg_dump writes no CREATE for them; a TOAST table's storage settings, which pg_dump writes on the table that owns it, are read with that table in `relations`), and any other schema named `pg_…` (`catalog_objects`: functions, relations and indexes, types, operators, collations, operator families and classes and their members, conversions, text-search objects, statistics, constraints, triggers, policies, rules and schemas; empty on production, so absent from its receipt), and what initdb created there (`builtins`, by name: the full definition of each function, procedure and aggregate with its parallel marking (for an aggregate, its arguments, result, volatility, strictness, security, leakproofness, cost, rows, support function, settings, language and source as well as its aggregate definition), view and index, the columns, access method, tablespace, replica identity and row-security settings of each relation, the clustering, replica identity and validity of each index, the rules on system views other than a view's own, the collations built into PostgreSQL, the settings of each range type, and each type, operator, cast, constraint, operator family and class with its members, conversion and text-search object). A replaced or dropped built-in, aggregates included, or a changed attribute (volatility, strictness, parallel safety, security, settings, cost), differs. Not read there: the collations initdb imports from ICU and the operating system's locales and the version of the built-in ICU collation (both differ between the two images), comments, initial privileges, the statistics settings of system columns, and server settings. Grants on system objects and on `pg_toast` are in `catalog_permissions`. Production's `builtins` equals a fresh cluster of either image (`17.6.1.063` and `.085`).

Each definition is recorded field by field, as a JSON array, so a missing field never lets the next one take its place: a policy with only USING and the same condition as only WITH CHECK read differently. Format 2 joined the fields with separators that skipped empty ones.

Its "session" family records the settings the reading ran under. A dump and restore parses stored expressions again, and PostgreSQL flattens nested AND and OR chains when it does. So `receipts.py restored` compares a restored copy exactly in every other family (29 on production's reading). In the seven that hold parsed expressions (columns, constraints, indexes, views, triggers, policies, rules), it accepts a match on PostgreSQL's precedence-aware printing (`pg_get_constraintdef(oid, true)` and the like). That printing reads the same for a flattened chain and its nested original, but differs for any regrouping. The output and the evidence file name the families that matched this way. Readings of the source itself, and template copies, are compared exactly in every family.

The default image is `supabase/postgres:17.6.1.063`; the session family fails the run if production's server version differs. The [operator handoff](../../docs/plans/automations-v2/complete-schema-handoff.md) has the steps.

Besides Linux, `release-full` and the two operator scripts before it (`capture-receipts.sh`, `make-schema-bundle.sh`) are written for macOS 13 or newer with Docker Desktop. They need bash 4.4 or newer (Homebrew's `bash`; each script refuses an older one), Python 3.11 or newer (macOS supplies 3.9), Node, openssl, curl, Docker with buildx and, for `make-schema-bundle.sh`, PostgreSQL 17 client tools. While the source holds the first release, as production does, they need no GNU coreutils, Deno, Chromium or Playwright: checksums and paths are computed in Python, and the containers are reached only through `docker exec` and `docker cp`. They have not been run end to end on a Mac.

```bash
bash e2e/automations-local/release-full-synthetic.sh
```

`release-full-synthetic.sh` tests the full mode end to end without production:

1. `run.sh synthetic-source` builds a stand-in from 105 of production's 122 earlier migrations, the first release and the first-text sender, along production's extension history: pg_graphql is dropped, so the image's event trigger leaves the placeholder and the two GraphQL schemas' initial privileges, and postgres creates pgcrypto, uuid-ossp and pg_stat_statements while it is a superuser. It makes the bundle with `make-schema-bundle.sh` through the cluster's own PostgreSQL 17 tools, checks that the reading has no pg_graphql and holds those two initial privileges outside any extension, and reads the receipts afterwards in a separate session. Run through `release-full-synthetic.sh`, it uses production's image, `supabase/postgres:17.6.1.063` (`LOCAL_POSTGRES_IMAGE` selects another, such as a mirror of the same image); run alone, `run.sh` defaults to `17.6.1.085`. `AUTOMATIONS_SYNTHETIC_PG_GRAPHQL=keep` keeps pg_graphql, to rehearse an archive that still holds it.
2. It shows that a plain template copy fails the target check.
3. Eighteen runs then must be refused: receipts inside the bundle, the bundle's own reading as the receipt (as is and reformatted), a receipt read through the bundle's connection, one read through the operator's own login, the old format, a reading three hours from the dump, a reading under another `search_path`, a changed source, a canonical reading without its time, a missing Auth receipt, a changed bundle file, and four archives edited after their readings were taken (`edit-archive.py`), which only the restored database shows: one policy regrouped, one policy's condition moved from USING to WITH CHECK, a built-in cast, a `pg_catalog` function and a disabled foreign key added, and built-ins changed (`now()` marked immutable, `lpad` replaced, English text search without plain words) with a collation added to `pg_catalog`, an extension ownership reading changed after it was taken (pgcrypto said to belong to `supabase_admin`, as a restore leaves it), which only the receipt shows, and one whose shared dependencies were changed after it was taken (pgcrypto's owner row left out), which the step's own check refuses. The stand-in has production's extension ownership and production's GraphQL leftovers, so the full run exercises both reproductions.
4. The full run must pass.

## Installation that stops part way

Each of the seven V2 files commits on its own, so a production installation can stop between two of them.

```bash
bash e2e/automations-local/run.sh install-stops
```

`install-stops.sh` copies a database holding the first release and, for every stopping point after 0 to 6 files, checks that the CRM's own saves (`supabase/tests/automation_install_stop.sql`) work with automations on and off; that the next file failing at its end leaves nothing; that applying the last file twice changes nothing; that resuming reaches exactly the catalog of a clean installation and that the guarded full rollback then reaches exactly the catalog of a clean rollback; and that `rollback/20261124100600_automation_v2_stopped_install.rollback.sql` restores the seventeen first-release functions byte for byte with every added observer inert, while the full rollback refuses the partial state. After a back-out or the full rollback, `supabase/ops/automation_v2_install_state.sql` reports `backed_out` or `rolled_back` with no next file, and every V2 file refuses to install. Every copy is a faithful one and matches the database it was copied from in all schema fingerprint families before anything is applied to it. The base is a faithful copy of the primary database: the cluster restarts without the pg_cron and pg_net workers for that one copy, and with them again afterwards. `release-full` runs the same checks on the restored complete schema, with the base also matched against the receipt.

## Backend-first rehearsal

Production already has the first release, so V2 reaches it database first. This mode rehearses that order and the rollback on one disposable stack. It needs the first-release commit `d85434f635bbf2d4118781e6d254798eef699363` in the checkout (`git fetch origin feat/self-service-automations`). That commit differs from the deployed frontend in three documentation files only.

```bash
bash e2e/automations-local/run.sh backend-first
```

1. `upgrade.sh pilot` installs the first release. `inflight-before.sql` commits one waiting and one queued run. `upgrade.sh v2` applies the seven V2 migrations, and `inflight-after.sql` shows both runs keep their state and complete.
2. The first release's own `builder.mjs`, frontend and worker run unchanged from a `git archive` of that commit against the V2 database.
3. The candidate frontend replaces it and `backend-first.mjs candidate` opens, saves and republishes those automations in the V2 editor.
4. Every agency is fenced, the first-release frontend is restored, the guarded rollback file is applied, and `backend-first.mjs rolled-back` checks what still runs, what is paused and that nothing was removed.
