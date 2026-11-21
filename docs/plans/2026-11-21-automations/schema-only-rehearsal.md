# Production schema source for the isolated rehearsal

The release rehearsal needs a current PostgreSQL 17 custom-format schema-only archive of database `postgres` on AgentFlow project `jncvvsvckxhqgqvkppmj`. Retain managed schemas, extensions, owners and permissions. Use the dedicated internal Docker network, disabled cron execution, synthetic credentials, and synthetic providers described in the local acceptance README.

## Current evidence

On November 21, 2026 at 07:32 UTC, read-only inspection found 19 non-system schemas on PostgreSQL 17.6. These include `public`, `private`, `auth`, `storage`, `realtime`, `net`, `cron`, `vault`, and the authorization and commission schemas. The database had 10 extensions, 35 roles, 29 role memberships, 27 default privilege entries, six event triggers and two publications. The catalog reported zero foreign servers, user mappings and subscriptions. The migration ledger contained 391 records through `20261121045526`, including one without statements.

The production fingerprint matched in two independent reads on November 21, 2026, last checked at 07:56 UTC. It uses effective ACLs, including implicit owner defaults, preserves initial extension privileges, and compares the visible order of columns and enum labels. This allows native replay to compact internal dropped-column positions or renumber enum positions. The SQL returns object counts and SHA-256 digests, including digests of routine definitions, role attributes, owners, grants and policies. It never returns individual definitions or reads application tables or cron jobs. The receipt contains 945 functions/procedures, 391 policies, 209 triggers and 1,149 constraints. A fingerprint supports drift detection. It cannot restore an object. Keep the source archive provenance, version, extension and role inventories, full archive table of contents, and restore results with the run evidence. The existing 33-migration pre-feature test fixture differs from the production receipt in 24 fingerprint families, including routines, relations, ownership/privilege metadata, indexes and extensions.

[Fingerprint SQL](../../../e2e/automations-local/schema-fingerprint.sql) · [Production fingerprint](production-schema-fingerprint.json) · [Local acceptance](../../../e2e/automations-local/README.md)

## Obtain an approved source

An operator with an existing authorized libpq service can produce this input. Use a private temporary directory on the operator's approved machine. Keep passwords, complete connection strings, globals containing credentials, row backups and generated archives out of Git, terminal output and chat. Verify that the service selects the named project and database. Use TLS server verification for the production connection.

Run these commands from a release checkout using PostgreSQL 17 clients and GNU Coreutils. Supply the name of the approved service as `PGSERVICE`. The service carries the connection settings. The output files remain on that machine until cleared for transfer.

```bash
set -euo pipefail
umask 077
: "${PGSERVICE:?Select the existing read-only AgentFlow production libpq service}"
export PGSSLMODE=verify-full
export PGDATABASE=postgres
export PGCONNECT_TIMEOUT=5
export PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=30s'
schema_dir=$(mktemp -d)
fingerprint_sql=e2e/automations-local/schema-fingerprint.sql
python3 e2e/automations-local/canonical-receipt.py query > "$schema_dir/canonical-query.sql"
psql -XqAt -v ON_ERROR_STOP=1 -f "$schema_dir/canonical-query.sql" > "$schema_dir/canonical-before.json"
psql -XqAt -v ON_ERROR_STOP=1 -f "$fingerprint_sql" > "$schema_dir/before.json"
timeout 120s pg_dump --no-password --schema-only --format=custom --lock-wait-timeout=2s \
  --file="$schema_dir/agentflow-schema.dump"
psql -XqAt -v ON_ERROR_STOP=1 -f "$fingerprint_sql" > "$schema_dir/after.json"
cmp "$schema_dir/before.json" "$schema_dir/after.json"
cp "$schema_dir/after.json" "$schema_dir/source-fingerprint.json"
psql -XqAt -v ON_ERROR_STOP=1 -f "$schema_dir/canonical-query.sql" > "$schema_dir/canonical-source.json"
python3 e2e/automations-local/canonical-receipt.py check "$schema_dir/canonical-before.json" "$schema_dir/canonical-source.json"
timeout 60s pg_dumpall --roles-only --no-role-passwords --no-password > "$schema_dir/roles.sql"
pg_restore --list "$schema_dir/agentflow-schema.dump" > "$schema_dir/toc.list"
if grep -Eq ' (TABLE DATA|FOREIGN TABLE DATA|MATERIALIZED VIEW DATA|SEQUENCE SET|STATISTICS DATA|BLOB|BLOBS|LARGE OBJECT|SUBSCRIPTION|USER MAPPING|SERVER)( |$)' "$schema_dir/toc.list"; then
  echo 'Data-bearing archive entry detected' >&2
  exit 1
fi
(cd "$schema_dir" && sha256sum agentflow-schema.dump roles.sql source-fingerprint.json > SHA256SUMS)
```

Confirm PostgreSQL reported a successful dump. A small lock timeout permits a clean retry if concurrent DDL blocks it. The same fingerprint on both sides of the dump checks drift during its consistent snapshot. Review any difference from the historical receipt recorded with the PR.

Cluster roles and memberships are separate from a database dump. Capture the source role **names, non-password attributes, memberships, role/database settings and grantors** using the approved administrator's password-free role inventory. PostgreSQL 17 provides `pg_dumpall --roles-only --no-role-passwords --no-password` for an operator to prepare that inventory in the same private directory. Reconcile it against the matching Supabase image on the isolated cluster. Use local synthetic passwords for fixture logins. Database-level ownership, locale, privileges and settings also need to match the source. The source role must have catalog access sufficient to capture this metadata. A permission failure leaves this step open.

The operator's existing secret and content review must cover routine bodies, view definitions, defaults, comments, role settings and any other DDL that can embed literal credentials or private content. Use the organization's approved private transfer process for the cleared schema, the password-free role inventory and checksums. Report a redacted or excluded object by name/class and reason, then account for its effect on the scope claim. A PostgreSQL data backup, Supabase Restore action, production database branch and raw cron job export each exceed this procedure.

## Restore and verify

The archive input directory must contain `agentflow-schema.dump`, `roles.sql`, `source-fingerprint.json`, `SHA256SUMS`, `canonical-source.json` and `auth-schema-migrations.txt`. The canonical catalog and Auth version list each have an independent receipt. Capture the Auth version IDs with the read-only export in the [Auth rehearsal procedure](auth-runtime-rehearsal.md), then compare its SHA-256 with [the Auth source receipt](production-auth-receipt.json). The observed version list checksum is `d82ee2c062ac0b3dd65235df4976c9cd10b55c2e3d7534dd3a4227d133a534d9`. The runner compares the supplied receipt with the independently captured production receipt in this checkout. If the source has changed, set `AUTOMATIONS_SOURCE_RECEIPT` to a current receipt obtained through a separate, authorized catalog read. Verify its capture time, database and project through that channel. Never choose the bundle's copy as the independent receipt. Set `LOCAL_POSTGRES_IMAGE` to the previously validated managed image with matching server, extensions and locale.

```bash
bash e2e/automations-local/run.sh release-full "$schema_dir"
```

1. Start a dedicated isolated cluster with matching managed Postgres and extension versions. Run cron with `cron.launch_active_jobs=off` and block outbound network. Preserve the primary database name `postgres` required by the pg_cron installation. The runner validates the three checksums, archive TOC and role-file shape, retains existing managed roles by name, and applies the source role attributes and grants. It refuses unexpected role syntax and requires the resulting roles and memberships to match the source receipt. Existing privileges in the image that differ from production cause a mismatch.
2. Verify the received SHA-256 values. Restore the complete cleared custom archive with PostgreSQL 17 `pg_restore --exit-on-error` under the matching local managed owner. Preserve every archive owner, ACL, extension, provider schema, publication and event trigger. `pg_restore --create` recreates the disposable primary from the archive's database metadata. Every archive entry is restored. The caller creates the container and internal-only Docker network for this run and removes both afterward.
3. Before GoTrue migrations, synthetic fixtures or candidate changes, execute `schema-fingerprint.sql` against the isolated primary and compare parsed JSON with the accompanying current source receipt. Compare role membership and settings inventories as well. Investigate all differences. For example, a skipped GraphQL ACL, a different event-trigger owner or a provider-schema mismatch leaves the complete-copy rehearsal open.
For a Supabase archive containing the managed GraphQL wrapper ACL, native `pg_restore` normally installs the provider's event trigger after its extension. The installer needs that trigger to create the wrapper and record its initial grants. The runner partitions the original archive, verifies every entry is present exactly once, restores `grant_pg_graphql_access()` and `issue_pg_graphql_access` before `pg_graphql`, and reapplies the matching managed image's initial `graphql_public` schema privileges before extension installation. The original archive ACL executes normally. A stock Supabase PG17.6.1.085 synthetic trial restored all 173 archive entries and matched all 22 populated catalog fingerprint families. Repeating with `pg_cron` and `pg_net` installed also matched all 25 populated families with cron job execution disabled and no copied job rows. A separate synthetic archive with a dropped column, enum insertion, missing role, table grants and RLS matched 17 families and restored zero source rows. Data-bearing archives and checksum mismatches were rejected.

4. After clean restore and comparison, apply the candidate to the isolated copy, run the old-build session and new-build cutover/rollback exercises and retain only schema fingerprints, metadata counts, test outcomes and revision IDs in the release packet.

A protected release runner can supply a reviewed schema-only export under its existing access policy. The existing release workflows include production credentials for their own operations. This procedure requires no changes to those workflows or credential grants.


## Repository catalog and bucket equivalence

AgentFlow invariant 25 names the per-object and per-kind repository queries as its equivalence checks. Their shared expression defines 18 catalog/configuration families. The checked-in harness embeds both original queries, hashes their ordered outputs inside the database and emits only SHA-256 values. An additional bucket digest pinpoints configuration drift. It verifies the exact query files by digest as well. The complete-schema catalog fingerprint separately checks managed schemas, extension versions, database roles and other platform objects. Both checks must pass. [Invariant 25](../../../AGENT_RULES.md) · [Object fingerprint](../../../scripts/fingerprint.sql) · [Rollup fingerprint](../../../scripts/fingerprint_rollup.sql) · [Independent production canonical receipt](production-canonical-receipt.json)

The source archive procedure above captures the two canonical digests before and after the dump. Transfer `canonical-source.json` with the reviewed bundle. After a separately approved source change, capture the hash-only canonical result independently on the named source and pass that copy via `AUTOMATIONS_CANONICAL_RECEIPT`. The gate rejects the bundle's own receipt as its independent reference. The before/after and independent copies must agree with the restored result.

Schema-only archives omit bucket configuration rows. Before a user fixture or feature migration, the isolated harness applies only the configuration inserts from Appendix B of the August baseline and the September voicemail migration. These sources define seven platform buckets. On November 21 an isolated PostgreSQL 17 smoke test reconstructed those definitions and matched the production bucket-family digest. Changing a single bucket's visibility caused the per-object, per-kind and bucket comparisons to fail. The verifier also rejected a missing source receipt. Existing conflicting definitions and extra buckets remain visible to the comparison. On unexpected drift, hold the rehearsal and review the configuration provenance. If the source of record has changed, an operator can supply an approved private JSON array using `AUTOMATIONS_BUCKET_CONFIG`. Each item accepts only `id`, `public`, `file_size_limit` and `allowed_mime_types`. The harness derives the bucket name from its ID, writes only to its singleton internal test database, and requires the project's independently captured canonical digest. Copying objects, file contents, owner rows or customer data is outside this procedure. [Verifier](../../../e2e/automations-local/verify-canonical.sh)

A replay from the August baseline and subsequent code could be accepted as an equivalent structural source if its platform image, role/privilege inventory, full catalog and both canonical fingerprints all match current production before applying the four migrations. The historical baseline contains selected auth/storage appendices and generated ACL restoration. Its original authority covered the project at that point in August. The present 33-migration fixture differed in 24 catalog families. No archived per-object digest supplies the missing DDL, and no verified current archive was found among the checked-in assets. The rehearsal remains on hold until an isolated database passes the complete comparison and the migrations run successfully there.
