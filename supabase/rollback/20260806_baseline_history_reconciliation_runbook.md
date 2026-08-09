# Production migration-history reconciliation runbook — baseline `20260806000000`

**Nature of this operation:** metadata-only. `supabase migration repair` edits rows in
`supabase_migrations.schema_migrations`; it applies **no SQL** and reverts **no SQL** (CLI docs +
v2.84.5 `--help`). The baseline migration's first executable statement is a multi-sentinel guard
that raises on any initialized AgentFlow database, so production is structurally incapable of
executing it even if mis-pushed. No table, row, policy, or function changes in either direction.

**Approval gates (each requires Chris's explicit go, in order):**
- **S1** — execute this reconciliation.
- **S2** — any `supabase db push` after reconciliation (advisors run here).
- **S3** — apply PR #352 M1 → M2 → M3.

---

## S1 procedure

### 1. EXACT full-row snapshot (read-only; HARD STOP if it cannot be created and verified)

The snapshot must capture **every column of every row** — including the complete `statements`
arrays and `name` values — not a digest. The statements contain historical SQL (embedded URLs,
object names, historical configuration): treat the artifact as **potentially sensitive**.

```sql
-- Export EVERY column, all rows (psql \copy writes client-side; adjust column list to match
-- the live table's actual columns — verify with \d supabase_migrations.schema_migrations first):
\copy (select * from supabase_migrations.schema_migrations order by version) to 'schema_migrations_full_snapshot.csv' with (format csv, header true)
```

Storage and handling rules:
- Save **outside the Git repository** in a permission-restricted location (e.g.
  `~/agentflow-operator/` with `chmod 700` directory / `chmod 600` file). **Never commit it,
  never paste it into the PR, logs, or chat.**
- Record `shasum -a 256 schema_migrations_full_snapshot.csv` alongside it.
- Verify before proceeding: row count = **262**; first version `20240401`; last version
  `20260805090000`; version list diffs empty against
  `supabase/migrations_archive/pre_baseline/` (minus the three never-applied files).
- **If the export or any verification fails, STOP. Do not delete anything.**

### 2. Mark the 262 historical versions reverted (deletes tracking rows only)

```bash
supabase migration repair --status reverted <versions, batched (e.g. 4 × ~65)>
```

### 3. Mark the baseline applied (inserts one tracking row)

```bash
supabase migration repair --status applied 20260806000000
```

### 4. Verify

`supabase migration list` → LOCAL and REMOTE both show exactly `20260806000000`;
`select count(*) from supabase_migrations.schema_migrations` → 1; then run
`scripts/fingerprint_rollup.sql` against production and compare with the values recorded in the
repair PR — **must be unchanged** (reconciliation touches no schema).

## Failure recovery (partial completion)

Each version's repair is independent and idempotent: diff `migration list` against the snapshot's
version list and re-issue the missing operations. No SQL ran at any point.

## Inverse — two distinct restorations (never without separate approval)

**A. Version-presence restoration (CLI, approximate).**
`supabase migration repair --status reverted 20260806000000` followed by `--status applied
<262 versions>` restores which versions are *recorded as applied*. **This is NOT claimed to
reproduce the original rows exactly** — `repair --status applied` inserts rows the CLI constructs
(v2.84.5 behavior for `name`/`statements` content has not been demonstrated against a disposable
database, and this runbook makes no assumption about it). Use A only when version-presence is all
that matters (e.g. immediately unblocking a push).

**B. Exact row restoration (from the secure snapshot; the true inverse).**
A single transaction, executed by the operator from the full snapshot of step 1:

```sql
begin;
delete from supabase_migrations.schema_migrations;
\copy supabase_migrations.schema_migrations from 'schema_migrations_full_snapshot.csv' with (format csv, header true)
commit;
```

Post-restore verification (all mandatory): row count 262 · version list identical · `name` values
identical · per-row `md5(array_to_string(statements, E'\n'))` identical to the values computed at
snapshot time · `supabase migration list` matches the pre-S1 state · schema fingerprint
(`scripts/fingerprint_rollup.sql`) unchanged. Restoration B is itself metadata-only.

---

## Related one-off record (NOT part of this runbook's procedure)

The approved emergency ACL hotfix of 2026-08-09 (`REVOKE ALL ON FUNCTION
public.wipe_organization_operational_data(uuid) FROM PUBLIC, anon, authenticated;`) was executed
directly with **no** migration-history row, by design. Its documented inverse — requiring separate
approval, and deliberately **excluding PUBLIC**, which had no EXECUTE before the hotfix — is:

```sql
GRANT EXECUTE ON FUNCTION public.wipe_organization_operational_data(uuid) TO anon, authenticated;
```
