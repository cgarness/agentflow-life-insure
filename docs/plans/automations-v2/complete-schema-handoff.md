# Complete-schema rehearsal: operator handoff

The seven Automations V2 files and both rollbacks are rehearsed on an isolated copy of the complete current production schema by `bash e2e/automations-local/run.sh release-full ARCHIVE RECEIPTS`. This page is for the person who runs it. It needs no repository, GitHub, Vercel or Supabase change, and nothing on it is a credential or customer data.

## Who can produce the bundle

**Chris (GitHub `cgarness`), on his own computer.** Only he holds the production database password. He entered it, with the session pooler host, into the protected GitHub environment `google-sheets-production` (secrets `SUPABASE_DB_PASSWORD` and `SUPABASE_POOLER_HOST`; he is its required reviewer).

Nothing else can produce the bundle today:

- **Claude** has read-only SQL through the Supabase connector and no database credentials. `pg_dump` is a client program that needs a database login, so the archive cannot come from Claude.
- **The protected release workflows** (`reports-release`, `hierarchy-m3-history`, `dashboard-*-release`, `google-sheets-*-release`) each run fixed stages from `main` with PostgreSQL 16 tools. None can make a PostgreSQL 17 archive without a code change.
  - A new workflow would be dispatchable only after a merge to `main`, which also rebuilds both production Vercel projects.
  - The repository is public, so an uploaded archive could be downloaded by any signed-in GitHub user.
  - That route needs its own approval and is not proposed here.
- **`supabase db dump`** is not a substitute: it is not a native custom-format archive of every schema, and it drops ACL revocations (AGENT_RULES).

## What you need

- A trusted computer with:
  - Docker (with `buildx`, as Docker Desktop includes);
  - Node 20 or newer, Python 3.11 or newer, `openssl` and `curl`;
  - PostgreSQL 17 client tools: on macOS `brew install postgresql@17` (then `export PG_BIN=$(brew --prefix postgresql@17)/bin`), on Linux the PGDG package `postgresql-client-17`.
- This repository checked out at the commit named in the approval request.
- Three values that stay on your computer:
  - the database password, in `~/.pgpass`;
  - a Supabase personal access token, in `SUPABASE_ACCESS_TOKEN`, used only for the read-only receipt queries;
  - the project's public client key (publishable key), in `SUPABASE_PUBLISHABLE_KEY`, used only for the Auth health version.
- About 45 minutes. The receipts and the dump must be taken within two hours of each other, and the run within 72 hours of both.

## Steps

1. **Connection settings, once.** Put the session pooler connection in `~/.pgpass` and make it private:

   ```bash
   chmod 600 ~/.pgpass
   ```

   The line has the form `HOST:5432:postgres:postgres.jncvvsvckxhqgqvkppmj:PASSWORD`, with the session pooler host from the database settings (port 5432, not the transaction pooler). Download the project's CA certificate (Database settings, SSL configuration) and point libpq at it:

   ```bash
   export PGHOST=<session pooler host> PGPORT=5432 PGUSER=postgres.jncvvsvckxhqgqvkppmj
   export PGSSLMODE=verify-full PGSSLROOTCERT=<path to the downloaded certificate>
   ```

2. **The receipts**, read through the Supabase Management API: a separate channel from the database connection the dump uses. Read-only, digests only:

   ```bash
   bash e2e/automations-local/capture-receipts.sh ~/agentflow-receipts
   ```

3. **The bundle**, straight after. It prints checksums and counts only, and the files stay on your computer:

   ```bash
   bash e2e/automations-local/make-schema-bundle.sh ~/agentflow-bundle
   ```

4. **The rehearsal** (about 20 minutes; it builds and removes its own isolated containers):

   ```bash
   bash e2e/automations-local/run.sh release-full ~/agentflow-bundle ~/agentflow-receipts
   ```

5. **Send back** the last lines it printed, from `Receipts accepted:` to `PASS release-full`, and the two evidence files `/tmp/automation-ui-evidence/automations-v2-release-full.json` and `/tmp/automation-ui-evidence/automations-v2-install-stops.json`. They hold counts, digests, timings and pass results only. Keep the bundle; delete it when the review is done:

   ```bash
   rm -rf ~/agentflow-bundle ~/agentflow-receipts
   ```

## What the rehearsal proves

- The receipts are read through another channel, come from outside the bundle, are format 2 with the expected session settings, and are within two hours of the dump.
- The bundle's two readings, taken before and after the dump, are identical, so nothing changed while it ran. They also match the receipt exactly.
- The restored database matches the receipt in every fingerprint family, before and after Auth starts. That covers:
  - every schema, including Auth, Storage, Realtime, Vault, cron and net;
  - roles, memberships and database and role settings;
  - default privileges, initial privileges and privileges on catalog objects;
  - parameter grants, extensions and their members, publications, event triggers and security labels.
- The installation base, and every copy the migrations and rollbacks are applied to (35 of them), are faithful copies checked against the database they were copied from before anything is applied. The base itself is checked against the receipt.
- The seven files then stop after each of 0 to 6 files, resume, back out and roll back as in the local rehearsal. The guarded full rollback also runs on real V2 work on another verified copy.

One difference is expected and named in the output. A restore parses stored expressions again, and PostgreSQL then prints some definitions with fewer parentheses: a `BETWEEN` followed by `AND` becomes one flat `AND` chain. So the restored copy is compared on a digest that leaves parentheses out. Readings taken straight from production are always compared exactly.

## If a step stops

| Message | What to do |
| --- | --- |
| `Could not connect read-only` | Check `~/.pgpass` and the exports. If the pooler refuses startup options, add `AGENTFLOW_NO_PGOPTIONS=1` before step 3. The dump and readings are read-only either way. |
| A TLS or certificate error | Download the project's CA certificate again and set `PGSSLROOTCERT` to it. |
| `pg_dump: error: ... permission denied for ...` | Stop. Send only the object name from that line. The production role may need a read grant on a managed object, and that is a separate decision. |
| `The schema changed while it was being dumped` | Run steps 2 to 4 again into new directories, at a quieter time. |
| `... was not taken within two hours of the dump` or `more than 72 hours old` | Run steps 2 to 4 again. |
| `... differs from the expected schema in: <families>` | Send the line. It names the families, never their content. |

## Claude's part

If you prefer, Claude can read the three receipts through its own read-only connector instead of step 2. They then come in the same format, committed under `docs/plans/automations-v2/receipts/` for you to pass as RECEIPTS. Run step 3 within two hours of that reading. Everything after step 4 (reviewing the evidence and updating the release packet) needs no access beyond what Claude has.
