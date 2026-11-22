# Matching the production Auth runtime in the isolated rehearsal

The schema-only archive omits table data. GoTrue consults the version IDs in `auth.schema_migrations` on startup to decide which schema changes to apply. The release-full harness restores only those numeric version IDs, boots the version-matched official Auth image and checks that the binary preserves both the ledger and the full restored catalog. Fresh synthetic logins then supply the browser fixtures.

The independent November 21 receipt covers AgentFlow project `jncvvsvckxhqgqvkppmj`, database `postgres`, 84 distinct version IDs and Auth health version `v2.198.0`. The Docker registry index for the official `supabase/gotrue:v2.198.0` image was `sha256:ba8c0c82c574756c835c696df2a2c698020cc408a42034013d3712e34de7964d`. The health service reports a release version. The registry independently supplies the digest used to pin the local image. [Supabase Auth health check](https://supabase.com/kb/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR)

Use the PostgreSQL service and schema archive directory from [the schema acquisition procedure](schema-only-rehearsal.md). The supplied bundle requires one additional regular file, `auth-schema-migrations.txt`. Its SHA-256 is covered by the independent Auth receipt. The three checksums for the schema archive, roles and catalog receipt stay in `SHA256SUMS`.

```bash
set -euo pipefail
umask 077
: "${schema_dir:?choose the private schema archive directory}"
psql -XqAt -v ON_ERROR_STOP=1 -d postgres > "$schema_dir/auth-schema-migrations.txt" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='3s';
DO $$
BEGIN
  IF EXISTS (SELECT FROM auth.schema_migrations WHERE version IS NULL OR version !~ '^(00|[0-9]{14})$')
     OR (SELECT count(*) <> count(DISTINCT version) OR count(*)=0 FROM auth.schema_migrations) THEN
    RAISE EXCEPTION 'Unexpected Auth migration version format or duplicates';
  END IF;
END $$;
SELECT version FROM auth.schema_migrations ORDER BY version COLLATE "C";
COMMIT;
SQL
sha256sum "$schema_dir/auth-schema-migrations.txt"
```

Obtain the independent source receipt through a separate, authorized observation of the named project. Run the following in a read-only SQL transaction with a three-second statement timeout. The canonical digest hashes the sorted version IDs encoded as UTF-8, each followed by LF. Reconfirm that every ID is either `00` or exactly fourteen digits. An authorized operator can also compare a current capture with the [reviewed version list](evidence/auth-schema-migrations.txt).

```sql
SELECT count(*) AS version_count,
       count(*) FILTER (WHERE version IS NULL OR version !~ '^(00|[0-9]{14})$') AS invalid_count,
       count(DISTINCT version) AS distinct_count,
       encode(sha256(convert_to(string_agg(version || chr(10), '' ORDER BY version COLLATE "C"),'UTF8')),'hex') AS versions_sha256,
       transaction_timestamp() AS observed_at
FROM auth.schema_migrations;
```

Read `/auth/v1/health` at the production project URL with its existing public publishable API key. Record only the `version` field. Resolve the corresponding official Docker registry tag using `docker buildx imagetools inspect supabase/gotrue:<version>` and record the index digest. The reviewed values appear in [the Auth receipt](production-auth-receipt.json). If any value changed, use a newly verified receipt outside the bundle via `AUTOMATIONS_AUTH_SOURCE_RECEIPT`.

Before launching Auth, `restore-auth-state.sh prepare` verifies the manifest shape, sort order, uniqueness and independent checksum. It atomically fills an empty local ledger or verifies an existing exact match. A partial ledger fails intact. After startup, `restore-auth-state.sh verify` verifies the actual container image reference, the local health response and every persisted version. The harness separately recomputes the complete schema fingerprint after startup. A failed check leaves the production-equivalent rehearsal pending.
