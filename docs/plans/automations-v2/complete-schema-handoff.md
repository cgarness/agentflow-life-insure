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

- A trusted computer, Linux or macOS 13 or newer (Apple silicon or Intel), with:
  - Docker (Docker Desktop on a Mac, which includes `buildx`), with several gigabytes free for its images;
  - bash 4.4 or newer, Node 20 or newer, Python 3.11 or newer, `openssl` and `curl`;
  - PostgreSQL 17 client tools (`psql`, `pg_dump`, `pg_dumpall`, `pg_restore`).
- On a Mac, the two missing pieces come from Homebrew. Open a new terminal afterwards, so `bash --version` shows 5:

  ```bash
  brew install bash postgresql@17
  ```

  ```bash
  export PG_BIN="$(brew --prefix postgresql@17)/bin"
  ```

  On Linux, install the PGDG package `postgresql-client-17` and leave `PG_BIN` unset.
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

- **The receipts are independent of the bundle.** They are read through the Management API, whose connection names itself `mgmt-api`. The bundle's readings come through your own connection, named `agentflow-schema-bundle`. A receipt read through the bundle's connection is refused. So is one taken at the same moment as one of the bundle's readings, or one that is a copy of a bundle file, byte for byte or reformatted. The receipts are format 2, with the expected session settings, and within two hours of the dump.
- **Nothing changed while the dump ran.** The bundle's two readings, taken before and after the dump, are identical, and they match the receipt exactly. The archive was made between them.
- **The restored database matches the receipt in all 34 fingerprint families, before and after Auth starts.**
  - 27 families must match exactly. They cover every schema (Auth, Storage, Realtime, Vault, cron and net included), function bodies, roles and memberships, database and role settings, and default, initial and catalog-object privileges. They also cover parameter grants, extensions and their members, publications, event triggers, security labels, partition keys and replica identity.
  - The seven families that hold expressions PostgreSQL parses again on restore are columns, constraints, indexes, views, triggers, policies and rules. They must match exactly or on PostgreSQL's precedence-aware printing.
- **Every target is a faithful copy.** That means the installation base and all 35 copies the migrations and rollbacks are applied to. Each is checked against the database it was copied from before anything is applied, and the base itself is checked against the receipt.
- **The seven files stop, resume, back out and roll back** after each of 0 to 6 files, as in the local rehearsal. The guarded full rollback also runs on real V2 work on another verified copy.

One difference is expected and named in the output. A restore parses stored expressions again, and PostgreSQL then flattens nested AND and OR chains: a `BETWEEN` followed by `AND` becomes one flat `AND` chain. Printed the way PostgreSQL prints for people, the flattened chain and the nested original read the same. Any regrouping still differs, such as `a AND (b OR c)` against `(a AND b) OR c`. The synthetic rehearsal proves this: an archive with one regrouped policy is refused. The evidence file lists the families that matched this way. In the synthetic rehearsal, built from production's migrations, only constraints did (three of them).

**What it does not prove.** These checks catch mistakes: the wrong file, a stale or copied reading, a bundle changed after its checksums. They cannot catch someone with control of this computer who deliberately edits both the bundle and the receipts. The Auth receipt's GoTrue version comes from the project's public health endpoint and the image's registry digest, not from the database.

## If a step stops

| Message | What to do |
| --- | --- |
| `Run this with bash 4.4 or newer` | On a Mac, run `brew install bash`, open a new terminal, and check that `bash --version` shows 5. |
| `The Management API refused the reading: ...` | The reason after the colon comes from Supabase. Usually the token has expired or lacks access to the project, so create a new personal access token. Never send the token. |
| `Could not connect read-only` | Check `~/.pgpass` and the exports. If the pooler refuses startup options, add `AGENTFLOW_NO_PGOPTIONS=1` before step 3. The dump and readings are read-only either way. |
| A TLS or certificate error | Download the project's CA certificate again and set `PGSSLROOTCERT` to it. |
| `pg_dump: error: ... permission denied for ...` | Stop. Send only the object name from that line. The production role may need a read grant on a managed object, and that is a separate decision. |
| `The schema changed while it was being dumped` | Run steps 2 to 4 again into new directories, at a quieter time. |
| `... was not taken within two hours of the dump` or `more than 72 hours old` | Run steps 2 to 4 again. |
| `... read through the same connection as the archive's readings`, `... taken at the same moment as one of the archive's own readings`, or `... not an independent reading` | RECEIPTS must be the directory step 2 wrote, never a copy of bundle files. Run steps 2 to 4 again. |
| `... differs from the expected schema in: <families>` | Send the line. It names the families, never their content. |

## Claude's part

Claude reviews the lines and evidence files you send back and updates the release packet. That needs no access beyond what Claude has. The receipts always come from your step 2, never from this repository.
