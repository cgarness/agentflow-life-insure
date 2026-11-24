# Production schema source for the isolated rehearsal

The release rehearsal needs a current PostgreSQL 17 custom-format schema-only archive of database `postgres` on AgentFlow project `jncvvsvckxhqgqvkppmj`. Retain managed schemas, extensions, owners and permissions. Use the dedicated internal Docker network, disabled cron execution, synthetic credentials, and synthetic providers described in the local acceptance README.

## Current evidence

On November 21, 2026 at 07:32 UTC, read-only inspection found 19 non-system schemas on PostgreSQL 17.6. These include `public`, `private`, `auth`, `storage`, `realtime`, `net`, `cron`, `vault`, and the authorization and commission schemas. The database had 10 extensions, 35 roles, 29 role memberships, 27 default privilege entries, six event triggers and two publications. The catalog reported zero foreign servers, user mappings and subscriptions. The migration ledger contained 391 records through `20261121045526`, including one without statements.

The production fingerprint matched in two independent reads on November 21, 2026, last checked at 07:56 UTC. It uses effective ACLs, including implicit owner defaults, preserves initial extension privileges, and compares the visible order of columns and enum labels. This allows native replay to compact internal dropped-column positions or renumber enum positions. The SQL returns object counts and SHA-256 digests, including digests of routine definitions, role attributes, owners, grants and policies. It never returns individual definitions or reads application tables or cron jobs. The receipt contains 945 functions/procedures, 391 policies, 209 triggers and 1,149 constraints. A fingerprint supports drift detection. It cannot restore an object. Keep the source archive provenance, version, extension and role inventories, full archive table of contents, and restore results with the run evidence. The existing 33-migration pre-feature test fixture differs from the production receipt in 24 fingerprint families, including routines, relations, ownership/privilege metadata, indexes and extensions.

[Fingerprint SQL](../../../e2e/automations-local/schema-fingerprint.sql) · [Production fingerprint](production-schema-fingerprint.json) · [Local acceptance](../../../e2e/automations-local/README.md)

## Obtain an approved source

**Updated November 24, 2026.** The procedure that was here is now scripted. The operator's steps are in the [complete-schema handoff](../automations-v2/complete-schema-handoff.md):

- **[`make-schema-bundle.sh`](../../../e2e/automations-local/make-schema-bundle.sh)** writes the bundle on the operator's computer:
  - two fingerprint readings around a PostgreSQL 17 `pg_dump --schema-only --format=custom` (made with `TZ=UTC`, so the archive records its creation time in UTC);
  - the canonical reading and the Auth version list;
  - `pg_dumpall --roles-only --no-role-passwords`;
  - a table-of-contents check for data-bearing entries;
  - `SHA256SUMS` over the six files.

  It connects read-only through the operator's own libpq settings and `~/.pgpass`, and prints checksums and counts only.
- **[`capture-receipts.sh`](../../../e2e/automations-local/capture-receipts.sh)** reads the three independent receipts through the Supabase Management API, a channel separate from the database connection the dump uses. Each reading names its connection (`mgmt-api` for the Management API, `agentflow-schema-bundle` for the bundle's), so the two can be told apart.

Both scripts, and `run.sh release-full`, run on Linux or on macOS 13 or newer with bash 4.4 or newer (Homebrew's `bash` on a Mac) and need no GNU coreutils.

The bundle now stays on the operator's computer. `run.sh release-full` runs there, and only its pass lines and evidence files (counts, digests, timings) are sent back. If a bundle ever has to leave that computer, first review it for secrets and private content: routine bodies, view definitions, defaults, comments, and role and database settings, including `ALTER ROLE … SET` and `ALTER DATABASE … SET` values in `roles.sql`. A PostgreSQL data backup, a Supabase Restore action, a production database branch and a raw cron job export each exceed this procedure.

## Restore and verify

```bash
bash e2e/automations-local/run.sh release-full ARCHIVE RECEIPTS
```

ARCHIVE holds:
- `agentflow-schema.dump` and `roles.sql`;
- `source-fingerprint-before.json` and `source-fingerprint.json`;
- `canonical-source.json` and `auth-schema-migrations.txt`;
- `SHA256SUMS`, which covers all six.

RECEIPTS holds `schema-fingerprint.json`, `canonical.json` and `auth.json`. No receipt comes from this checkout any more: the November 21 readings are format 1, and the November 24 one was read under another `search_path`. Neither can serve as the reference.

Before anything is restored, [`receipts.py`](../../../e2e/automations-local/receipts.py) refuses the run when:
- the receipts sit inside the bundle, or are copies of its files, byte for byte or reformatted;
- the schema receipt was read through the bundle's own connection, or at the moment of one of its readings;
- a fingerprint is not format 2;
- a capture time is more than two hours from the dump, or the readings are more than 72 hours old;
- the archive was not made between its two readings;
- the readings differ from each other or from the receipt.

`restore-full.sh` then restores the archive with PostgreSQL 17 `pg_restore --create --exit-on-error`, as before (managed role inventory, GraphQL bootstrap order). After that:

- **The restored database** must match the receipt in every [schema fingerprint](../../../e2e/automations-local/schema-fingerprint.sql) family, before and after Auth starts. It must match exactly in 27 of the 34 families. A restore parses stored expressions again and flattens nested AND and OR chains. So the seven families that hold them (columns, constraints, indexes, views, triggers, policies, rules) may instead match on PostgreSQL's precedence-aware printing, which reads the same for a flattened chain and its nested original but differs for any regrouping. The output and the evidence file name the families that matched that way.
- **The installation base** is a faithful template copy of that database ([`faithful-copy.sh`](../../../e2e/automations-local/faithful-copy.sh)), checked against it and against the receipt.
- **Every interrupted-install copy and the rollback rehearsal copy** are checked against the database they were copied from before anything is applied to them.

The rehearsal that failed on a filtered `pg_dump` copy (no cron schema, no GraphQL wrapper privileges, no database privileges or settings) is gone. The base keeps all of those. The cluster runs without the pg_cron and pg_net workers only while the primary database itself is copied.

Set `LOCAL_POSTGRES_IMAGE` only for a synthetic run. The session family fails the run when production's server version differs from the image. `e2e/automations-local/release-full-synthetic.sh` runs the whole path against a stand-in source, with twelve refusals (among them an archive with one policy regrouped after its readings), and passes.

## Repository catalog and bucket equivalence

AgentFlow invariant 25 names the per-object and per-kind repository queries as its equivalence checks. Their shared expression defines 18 catalog/configuration families. The checked-in harness embeds both original queries, hashes their ordered outputs inside the database and emits only SHA-256 values. An additional bucket digest pinpoints configuration drift. It verifies the exact query files by digest as well. The complete-schema catalog fingerprint separately checks managed schemas, extension versions, database roles and other platform objects. Both checks must pass. [Invariant 25](../../../AGENT_RULES.md) · [Object fingerprint](../../../scripts/fingerprint.sql) · [Rollup fingerprint](../../../scripts/fingerprint_rollup.sql) · [Independent production canonical receipt](production-canonical-receipt.json)

The bundle carries the canonical reading taken right after the dump, and RECEIPTS carries an independent one. Both now record their capture time and a digest per row kind.
- The two readings, both of the source itself, must match exactly.
- On the restored copy, every kind's row count must match. So must the bucket digest, the two query digests and every kind a restore stores identically.
- Kinds that hash stored expressions or raw privilege arrays (column, constraint, index, policy, trigger, function, view, type, grants, sequence, column privileges and default privileges) can be stored differently by a restore without changing. Their content is compared through the schema fingerprint, which sorts privileges and compares function bodies and every other family exactly, and the expression families on PostgreSQL's precedence-aware printing. The output names them.

Schema-only archives omit bucket configuration rows. Before a user fixture or feature migration, the isolated harness applies only the configuration inserts from Appendix B of the August baseline and the September voicemail migration. These sources define seven platform buckets. On November 21 an isolated PostgreSQL 17 smoke test reconstructed those definitions and matched the production bucket-family digest. Changing a single bucket's visibility caused the per-object, per-kind and bucket comparisons to fail. The verifier also rejected a missing source receipt. Existing conflicting definitions and extra buckets remain visible to the comparison. On unexpected drift, hold the rehearsal and review the configuration provenance. If the source of record has changed, an operator can supply an approved private JSON array using `AUTOMATIONS_BUCKET_CONFIG`. Each item accepts only `id`, `public`, `file_size_limit` and `allowed_mime_types`. The harness derives the bucket name from its ID, writes only to its singleton internal test database, and requires the project's independently captured canonical digest. Copying objects, file contents, owner rows or customer data is outside this procedure. [Verifier](../../../e2e/automations-local/verify-canonical.sh)

A replay from the August baseline and subsequent code could be accepted as an equivalent structural source if its platform image, role/privilege inventory, full catalog and both canonical fingerprints all match current production before applying the four migrations. The historical baseline contains selected auth/storage appendices and generated ACL restoration. Its original authority covered the project at that point in August. The present 33-migration fixture differed in 24 catalog families. No archived per-object digest supplies the missing DDL, and no verified current archive was found among the checked-in assets. The rehearsal remains on hold until an isolated database passes the complete comparison and the migrations run successfully there.
