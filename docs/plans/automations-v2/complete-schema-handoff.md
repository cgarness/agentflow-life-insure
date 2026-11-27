# Complete-schema rehearsal: operator handoff

The seven Automations V2 files and both rollbacks are rehearsed on an isolated copy of the complete current production schema by `bash e2e/automations-local/run.sh release-full ARCHIVE RECEIPTS`. This page is for the person who runs it. It needs no repository, GitHub, Vercel or Supabase change, and nothing on it is a credential or customer data.

## Who can produce the bundle

**Chris (GitHub `cgarness`), on his own computer.** Only he holds the production database password. He entered it, with the session pooler host, into the protected GitHub environment `google-sheets-production` (secrets `SUPABASE_DB_PASSWORD` and `SUPABASE_POOLER_HOST`; he is its required reviewer).

Nothing else can produce the bundle today:

- **Claude** has read-only SQL through the Supabase connector and no database credentials. `pg_dump` is a client program that needs a database login, so the archive cannot come from Claude.
- **The protected release workflows** (`reports-release`, `hierarchy-m3-history`, `dashboard-*-release`, `google-sheets-*-release` and `google-sheets-phase-b`) each run fixed stages from `main` with PostgreSQL 16 tools. None can make a PostgreSQL 17 archive without a code change.
  - A new workflow would be dispatchable only after a merge to `main`, which also rebuilds both production Vercel projects.
  - The repository is public, so an uploaded archive could be downloaded by any signed-in GitHub user.
  - That route needs its own approval and is not proposed here.
- **`supabase db dump`** is not a substitute: it is not a native custom-format archive of every schema, and it drops ACL revocations (AGENT_RULES).

## What you need

- A trusted computer, Linux or macOS 13 or newer (Apple silicon or Intel), with:
  - Docker with `buildx` (Docker Desktop on a Mac includes it; on Linux, Docker's `docker-buildx-plugin`), running for step 4, with at least 6 GB free (the PostgreSQL image alone is about 4.5 GB);
  - bash 4.4 or newer, Node 20 or newer, Python 3.11 or newer, `openssl` and curl 7.76 or newer;
  - PostgreSQL 17 client tools (`psql`, `pg_dump`, `pg_dumpall`, `pg_restore`).
- On a Mac, the missing pieces come from Homebrew (the `python3` macOS supplies is 3.9). Add `node` if `node --version` fails or shows less than 20. Open a new terminal afterwards, so `bash --version` shows 5 and `python3 --version` shows 3.11 or newer:

  ```bash
  brew install bash postgresql@17 python
  ```

  ```bash
  export PG_BIN="$(brew --prefix postgresql@17)/bin"
  ```

  On Linux, install the PGDG package `postgresql-client-17`. If `psql --version` then shows another major version, `export PG_BIN=/usr/lib/postgresql/17/bin`.
- This repository checked out at the commit named in the approval request (`git fetch origin && git checkout <commit>`). Run every command below from its top folder, all in one terminal: the exports last only for that terminal.
- Three values that stay on your computer:
  - the database password, in `~/.pgpass`;
  - a Supabase personal access token, in `SUPABASE_ACCESS_TOKEN`, used only for the read-only receipt queries;
  - the project's public client key (publishable key), in `SUPABASE_PUBLISHABLE_KEY`, used only for the Auth health version.
- About 45 minutes. The receipts and the dump must be taken within two hours of each other, and the run within 72 hours of both.

## Steps

1. **Connection settings.** With a text editor (not `echo`, which keeps the password in your shell history), put the session pooler connection in `~/.pgpass` and make it private:

   ```bash
   chmod 600 ~/.pgpass
   ```

   The line has the form `HOST:5432:postgres:postgres.jncvvsvckxhqgqvkppmj:PASSWORD`, with the session pooler host from the database settings (port 5432, not the transaction pooler). Download the project's CA certificate (Database settings, SSL configuration) and point libpq at it:

   ```bash
   export PGHOST=<session pooler host> PGPORT=5432 PGUSER=postgres.jncvvsvckxhqgqvkppmj
   export PGSSLROOTCERT=<path to the downloaded certificate>
   ```

2. **The receipts**, read through the Supabase Management API: a separate channel from the database connection the dump uses. Read-only, digests only. Create a personal access token (Supabase Account, Access Tokens) and paste it at the first line's silent prompt, which keeps it out of your shell history. The publishable key is under Project Settings, API Keys:

   ```bash
   read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
   ```

   ```bash
   export SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```

   ```bash
   bash e2e/automations-local/capture-receipts.sh ~/agentflow-receipts
   ```

   It ends with `Receipts written: 36 schema families read at ..., canonical digests, and the Auth ledger. Run make-schema-bundle.sh within two hours.`

3. **The bundle**, straight after. It prints checksums and counts only, and the files stay on your computer:

   ```bash
   bash e2e/automations-local/make-schema-bundle.sh ~/agentflow-bundle
   ```

   Among its lines: `Read 36 fingerprint families before and after the dump; they match.` and `Read the owners of 10 extensions and 307 of their members, 18 initial privileges extension scripts recorded, and 14 shared dependencies on roles PostgreSQL keeps for them.` It ends with `Bundle ready: ... archive entries, 84 Auth versions.` Those are production's counts when read on November 25 and 26.

4. **The rehearsal** (about 20 minutes; it builds and removes its own isolated containers):

   ```bash
   bash e2e/automations-local/run.sh release-full ~/agentflow-bundle ~/agentflow-receipts 2>&1 | tee ~/agentflow-release-full.log
   ```

   Among the first lines after `Receipts accepted:`, with production's counts when read on November 26:
   - `Reproduced the source's extension ownership: 3 extensions and 51 members given their source owner, 18 initial privileges recorded as the source holds them (2 objects in no extension given them as their privileges), and 14 shared dependencies on roles matching the source's.`
   - `The restored primary database matches the expected schema in all 36 fingerprint families.`, which may go on to name the families that matched on PostgreSQL's precedence-aware printing, then the same line for `The restored primary database (against the archive)`.
   - `Restored the full supplied archive.`

5. **Send back** what these two commands print: about 30 summary and pass lines of the roughly 1,850 from `Receipts accepted:` to `PASS release-full` (the rest are the rehearsal suites' notices on synthetic rows), and the two evidence files. They hold counts, digests, the receipt's capture time, file and family names and pass results only. If the run stopped, send its last 20 lines instead (`tail -20 ~/agentflow-release-full.log`).

   ```bash
   grep -E '^(Receipts accepted|Reproduced|The |Restored|Repository|Verified|Matched|Reference|Each of|PASS)' ~/agentflow-release-full.log
   ```

   ```bash
   cat /tmp/automation-ui-evidence/automations-v2-release-full.json /tmp/automation-ui-evidence/automations-v2-install-stops.json
   ```

   Keep the bundle until the review is done. Then delete it, the receipts and the log, delete the access token (Supabase Account, Access Tokens) and remove the password line from `~/.pgpass`:

   ```bash
   rm -rf ~/agentflow-bundle ~/agentflow-receipts ~/agentflow-release-full.log
   ```

## What the rehearsal proves

- **The receipts are independent of the bundle.** They are read through the Management API, whose connection names itself `mgmt-api`. The bundle's readings come through your own connection, named `agentflow-schema-bundle`. All three receipts must name `mgmt-api`: one read through the bundle's connection, or through your own login with `psql`, is refused. So is one taken at the same moment as one of the bundle's readings, or one that is a copy of a bundle file, byte for byte or reformatted. The check relies on the Management API naming its own connection, as it did when read on November 25. The receipts are format 3, with the expected session settings, and within two hours of the dump.
- **Nothing changed while the dump ran.** The bundle's two readings, taken before and after the dump, are identical, and they match the receipt exactly. The archive was made between them.
- **The restored database matches the receipt in all its fingerprint families (36 on production when read on November 26 at 03:04 UTC), before and after Auth starts.** Each definition is compared field by field, so a policy whose condition moved between USING and WITH CHECK differs.
  - 29 families must match exactly. They cover every schema (Auth, Storage, Realtime, Vault, cron and net included), function bodies, roles and memberships, database and role settings, and default, initial and catalog-object privileges (grants on `pg_toast` included). They also cover extensions and their members (with their owners), publications, event triggers, partition keys, replica identity, the storage settings of TOAST tables (read with the table that owns each) and Realtime's partitions, and what initdb created in the system schemas (`builtins`: every built-in function and aggregate with its parallel marking and, for an aggregate, its arguments, result and function attributes, view, column, type, operator, cast, constraint, operator family and text-search object, each system relation's access method, tablespace and replica identity and each system index's clustering, replica identity and validity, the settings of each range type, the rules on system views and the collations built into PostgreSQL, by name).
  - Every family production does not have must stay absent (14 of the 50 when read on November 26 at 03:04 UTC), among them parameter grants, security labels, casts created after initdb, and objects created in the system schemas after initdb or in `pg_toast` apart from its TOAST tables and the indexes on them, or any other schema named `pg_…` (`catalog_objects`).
  - Disabled foreign-key triggers are compared in the triggers family.
  - The seven families that hold expressions PostgreSQL parses again on restore are columns, constraints, indexes, views, triggers, policies and rules. They must match exactly or on PostgreSQL's precedence-aware printing.
- **What a restore cannot carry is put back, and the receipt still decides.** A restore makes every extension and its members the restoring superuser's, with a fresh install's initial privileges. On production, pgcrypto, uuid-ossp and pg_stat_statements and all their members belong to postgres. The schemas graphql and graphql_public keep initial privileges from pg_graphql, which production no longer has, so the archive holds no grant for them (the owners read on November 26 at 01:09 UTC, the two schemas' initial privileges on November 25 at 23:49 UTC). Without this step a faithful copy would differ in acls, extensions, functions, relations and types, and would lose those two schemas' privileges.
  - The bundle reads each extension's and member's owner, the initial privileges extension scripts recorded and the shared dependencies PostgreSQL keeps for them (`extension-ownership.json`, format 2, through your connection, between the two schema readings).
  - The restore runs in two passes. First everything but the privileges. Then the step: it gives the owners and initial privileges back, gives the two schemas their privileges, rebuilds the shared dependencies and checks them against the reading (production's equal what it rebuilds, read on November 26), and prints one line of counts. Last, the archive's privileges, as pg_dump wrote them.
  - A reading changed after it was taken fails that check or leaves the copy unlike the receipt, and the run stops.
- **Every target is a faithful copy.** That means the installation base, the 35 interrupted-install copies and the two copies the guarded full rollback is rehearsed on. Each is checked against the database it was copied from before anything is applied, and the base and the first rollback copy are also checked against the receipt.
- **The seven files stop, resume, back out and roll back** after each of 0 to 6 files, as in the local rehearsal. The guarded full rollback also runs on real V2 work on another verified copy.

One difference is expected and named in the output. A restore parses stored expressions again, and PostgreSQL then flattens nested AND and OR chains: a `BETWEEN` followed by `AND` becomes one flat `AND` chain. Printed the way PostgreSQL prints for people, the flattened chain and the nested original read the same. Any regrouping still differs, such as `a AND (b OR c)` against `(a AND b) OR c`. The synthetic rehearsal proves this: an archive with one regrouped policy is refused, as is one with a policy's condition moved from USING to WITH CHECK, one that adds a cast between built-in types and a function in `pg_catalog` and disables a table's foreign-key triggers, and one that changes built-ins (`now()` marked immutable, `lpad` replaced, English text search without plain words) and adds a collation to `pg_catalog`. The evidence file lists the families that matched this way. In the synthetic rehearsal, built from production's migrations, only constraints did.

**What it does not prove.** These checks catch mistakes: the wrong file, a stale or copied reading, a bundle changed after its checksums. They cannot catch someone with control of this computer who deliberately edits both the bundle and the receipts. The Auth receipt's GoTrue version comes from the project's public health endpoint and the image's registry digest, not from the database.

## If a step stops

| Message | What to do |
| --- | --- |
| `Run this with bash 4.4 or newer` | On a Mac, run `brew install bash`, open a new terminal, and check that `bash --version` shows 5. |
| `Python 3.11 or newer is required.` or `PostgreSQL 17 psql is required (PG_BIN selects it).` (or `pg_dump`, `pg_dumpall`, `pg_restore`) | Install what "What you need" lists, export `PG_BIN` in this terminal and run step 3 again (it made no directory). Run step 2 again first, into a new directory, if two hours have passed. |
| `SUPABASE_ACCESS_TOKEN: Set SUPABASE_ACCESS_TOKEN ...` or `SUPABASE_PUBLISHABLE_KEY: Set SUPABASE_PUBLISHABLE_KEY ...` | Set it as step 2 shows, in this terminal, and run step 2 again. |
| `The Management API refused the reading: ...` | The reason after the colon comes from Supabase. If the token has expired or lacks access to the project, create a new personal access token; otherwise send the line. Then `rm -rf ~/agentflow-receipts` and run step 2 again. Never send the token. |
| `Could not connect read-only` | Check `~/.pgpass` and the exports. If the pooler refuses startup options, `export AGENTFLOW_NO_PGOPTIONS=1`. Then `rm -rf ~/agentflow-bundle` and run step 3 again. The dump and readings are read-only either way. |
| A TLS or certificate error | Download the project's CA certificate again, set `PGSSLROOTCERT` to it, `rm -rf ~/agentflow-bundle` and run step 3 again. |
| `Choose a directory that does not exist yet.` | A step that stopped leaves its directory behind. Delete it (`rm -rf ~/agentflow-receipts` or `rm -rf ~/agentflow-bundle`) and run that step again. |
| `pg_dump: error: ... permission denied for ...` | Stop. Send only the object name from that line. The production role may need a read grant on a managed object, and that is a separate decision. |
| `The schema changed while it was being dumped` or `The source changed while it was being dumped` | Run steps 2 to 4 again into new directories, away from midnight UTC. |
| `The archive does not match the independent schema receipt in: ...`, `The archive's two readings do not bracket one dump of at most 30 minutes.` or `The archive was not made between the two readings that accompany it.` | Production changed between steps 2 and 3 (Realtime rotates its dated partitions at midnight UTC), the dump took longer than 30 minutes, or this computer's clock is more than a minute off (pg_dump stamps the archive with it, so set the time automatically). Run steps 2 to 4 again into new directories, step 3 straight after step 2, away from midnight UTC. |
| `... was not taken within two hours of the dump` or `more than 72 hours old` | Run steps 2 to 4 again into new directories. |
| `... read through the same connection as the archive's readings`, `... not the Management API's own connection`, `... taken at the same moment as one of the archive's own readings`, `... taken at the same moment as the archive's own canonical reading`, or `... not an independent reading` | RECEIPTS must be the directory step 2 wrote, never a copy of bundle files or a reading you took yourself. Run steps 2 to 4 again into new directories. If step 2's own directory still gives `... not the Management API's own connection`, stop and send the line: the Management API has renamed the connection the check relies on. |
| `automations v2 rollback drift: <function>` or `... back-out drift: <function>`, then `The rollback ... refused ...` | Stop and send the lines. The rollback files do not match the migrations at this commit; Claude regenerates them. |
| `... invalid indexes ... are never dumped ...` (from `make-schema-bundle.sh`) | Stop and send the line; it is a count only. A failed or interrupted concurrent index build left them, and pg_dump leaves them out, so no restored copy could match. Removing or rebuilding them on production is a change that needs its own approval; afterwards run steps 2 to 4 again into new directories. |
| `... tables keep TOAST storage settings (toast.*) on a TOAST table a restore would not create ...` (from `make-schema-bundle.sh`) | Stop and send the line; it is a count only. Such a table kept its TOAST table and its settings after the last column that needed one was dropped, and a restore does not create that TOAST table, so no restored copy could match. The check is cautious: a remaining wide bounded column, such as `varchar(3000)`, also trips it, although a restore keeps that TOAST table. Changing those tables on production needs its own approval; afterwards run steps 2 to 4 again into new directories. Production had no TOAST settings when read on November 25. |
| `The archive's extension ownership reading must be format 2 ...`, `The extension ownership reading is not format 2.` or `... was not taken between its two schema readings.` | The bundle was made by an older `make-schema-bundle.sh`, or its files were mixed. Run steps 2 to 4 again into new directories with this commit's scripts. |
| `Reproducing the source's extension ownership failed: ERROR: ... Stop and send this line.` | Send the line. It names extensions, object types and names, roles, object addresses and the statement that failed, never data. Claude fixes the script or explains what the source holds (the README lists what each message means). |
| `Native archive restore failed; baseline is unverified. ERROR: ... Stop and send this line.` or `Native restore of the archive's privileges failed; baseline is unverified. ERROR: ... Command was: ... Stop and send this line.` | Send the line. A statement in the archive failed in the first restore pass, or a grant or revoke failed after the ownership step. It gives PostgreSQL's error, which names objects and roles but no data, and for a privilege the GRANT or REVOKE that failed. |
| `Managed GraphQL bootstrap entries missing or ambiguous` or `Matching managed GraphQL initial privileges required.` | Send the line. Only an archive that still holds pg_graphql takes this path, and production's has none. |
| `... differs from the expected schema in: <families>` | Send the line. It names the families, never their content. `builtins` alone means the platform changed a system catalog (a `CLUSTER` of one, for example), which only `allow_system_table_mods` undoes. `acls`, `namespaces` or `statistics` with any of `extensions`, `functions`, `relations` or `types` can also mean an extension history the restore does not reproduce: a statistics object an extension created on one of its tables (production has no statistics objects), a privilege outside any extension that a role other than its owner granted and later revoked (production's two such schemas hold only their owner's grants), or the initial privileges a pg_net older than 0.13.0 leaves after an update in place (production's has none). Stop and send the line. |
| `pg_dump: error: ... lock timeout` | Production was busy for a moment. `rm -rf ~/agentflow-bundle` and run step 3 again (step 2 first, into a new directory, if two hours have passed). |
| Any other message | Stop and send that line, leaving out any host name. Steps 2 and 3 have never run against production, so a stop there can be new. Never send a file from the bundle or the receipts, the token or the password. |

## Claude's part

Claude reviews the lines and evidence files you send back and updates the release packet. That needs no access beyond what Claude has. The receipts always come from your step 2, never from this repository.
