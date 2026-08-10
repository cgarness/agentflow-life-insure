# Production migration-history reconciliation runbook — baseline `20260806000000`

**Nature of this operation:** migration-history metadata reconciliation. It **does change rows** —
specifically, and only, rows of `supabase_migrations.schema_migrations` (the CLI's tracking table).
The accurate safety claims are: **no application DDL executes, no application-data DML executes,
and the baseline SQL itself is never executed in production** (`supabase migration repair` edits
tracking rows without running any migration SQL — CLI docs + v2.84.5 `--help`; additionally, the
baseline's first executable statement is a multi-sentinel guard that raises on any initialized
AgentFlow database, so production is structurally incapable of executing it even if mis-pushed).
No application table, policy, function, or datum changes in either direction.

**Approval gates (each requires Chris's explicit go, in order):**
- **S1** — execute this reconciliation.
- **S2** — any `supabase db push` after reconciliation (advisors run here).
- **S3** — apply PR #352 M1 → M2 → M3.

---

## S1 procedure

### 1. EXACT full-row snapshot (read-only; HARD STOP if it cannot be created and verified)

**1a. Verify the live column inventory first.** The confirmed production shape (read-only
inspection, 2026-08-09) is exactly **six columns in this order**:
`version, statements, name, created_by, idempotency_key, rollback`.

```sql
select string_agg(column_name, ',' order by ordinal_position)
from information_schema.columns
where table_schema = 'supabase_migrations' and table_name = 'schema_migrations';
-- REQUIRED result, exactly: version,statements,name,created_by,idempotency_key,rollback
-- If it differs in any way (columns added/removed/reordered), STOP: this runbook's export and
-- restoration statements no longer match the live table and must be revised first.
```

**1b. Export all six named columns, ordered by version** (psql `\copy` writes client-side). The
snapshot captures every column of every row — including complete `statements` arrays, `name`,
`created_by`, `idempotency_key`, `rollback`, and any NULLs — not a digest. The statements contain
historical SQL (embedded URLs, object names, historical configuration): treat the artifact as
**potentially sensitive**.

```sql
\copy (select version, statements, name, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations order by version) to 'schema_migrations_full_snapshot.csv' with (format csv, header true)
```

Storage and handling rules:
- Save **outside the Git repository** in a permission-restricted location (e.g.
  `~/agentflow-operator/` with `chmod 700` directory / `chmod 600` file). **Never commit it,
  never paste it into the PR, logs, or chat.**
- Record the checksum in `shasum -c` format alongside it (used again by inverse B):
  `cd ~/agentflow-operator && shasum -a 256 schema_migrations_full_snapshot.csv > schema_migrations_full_snapshot.csv.sha256`
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
version list and re-issue the missing operations. No migration SQL ran at any point — only
tracking-table row edits.

## Inverse — two distinct restorations (never without separate approval)

**A. Version-presence restoration (CLI, approximate).**
`supabase migration repair --status reverted 20260806000000` followed by `--status applied
<262 versions>` restores which versions are *recorded as applied*. **This is NOT claimed to
reproduce the original rows exactly** — `repair --status applied` inserts rows the CLI constructs
(v2.84.5 behavior for `name`/`statements` content has not been demonstrated against a disposable
database, and this runbook makes no assumption about it). Use A only when version-presence is all
that matters (e.g. immediately unblocking a push).

**B. Exact row restoration (from the secure snapshot; the true inverse).**
Failure-safe by construction: the snapshot is checksum-verified immediately before use, staged and
validated in a session-local temporary table **before** any live row is deleted, and the whole
replacement runs in one fail-fast transaction — any checksum, file, parse, validation, DELETE, or
INSERT failure aborts and leaves the original metadata rows intact. (`\copy` reads a client-side
file; without these safeguards a missing or malformed file could otherwise let psql continue past
the failed COPY and commit an emptied history table.)

**B-1. Re-verify the snapshot checksum recorded at S1 (abort on any mismatch):**

```bash
cd ~/agentflow-operator && shasum -a 256 -c schema_migrations_full_snapshot.csv.sha256
# Proceed ONLY on: schema_migrations_full_snapshot.csv: OK
```

**B-2. Save as `restore_schema_migrations.sql`** (absolute, permission-restricted snapshot path;
adjust the operator home if different — the path must live OUTSIDE the Git repository):

```sql
\set ON_ERROR_STOP on

begin;

-- Session-local staging table shaped from the live table; ON COMMIT DROP; lives in this
-- session's pg_temp schema only — no application schema is created or changed.
create temporary table schema_migrations_restore
  (like supabase_migrations.schema_migrations)
  on commit drop;

-- Stage the snapshot FIRST. If the file is missing, unreadable, or malformed, ON_ERROR_STOP
-- aborts HERE — the live rows have not been touched.
\copy schema_migrations_restore (version, statements, name, created_by, idempotency_key, rollback) from '/Users/chrisgarness/agentflow-operator/schema_migrations_full_snapshot.csv' with (format csv, header true)

-- Validate the staged rows BEFORE any delete.
do $validate$
declare
  v_count bigint; v_nulls bigint; v_dups bigint; v_first text; v_last text;
begin
  select count(*), count(*) filter (where version is null)
    into v_count, v_nulls from schema_migrations_restore;
  select count(*) into v_dups
    from (select version from schema_migrations_restore group by version having count(*) > 1) d;
  if v_count <> 262 then
    raise exception 'staged row count % <> 262 — aborting; live rows untouched', v_count;
  end if;
  if v_nulls <> 0 then
    raise exception '% staged rows have NULL version — aborting; live rows untouched', v_nulls;
  end if;
  if v_dups <> 0 then
    raise exception '% duplicate staged versions — aborting; live rows untouched', v_dups;
  end if;
  select min(version), max(version) into v_first, v_last from schema_migrations_restore;
  if v_first <> '20240401' or v_last <> '20260805090000' then
    raise exception 'staged version range % .. % does not match the snapshot inventory 20240401 .. 20260805090000 — aborting; live rows untouched', v_first, v_last;
  end if;
end
$validate$;

-- Only after validation: replace the live rows, same transaction.
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations
  (version, statements, name, created_by, idempotency_key, rollback)
select version, statements, name, created_by, idempotency_key, rollback
from schema_migrations_restore;

commit;
```

**B-3. Run non-interactively, fail-fast:**

```bash
psql -X -v ON_ERROR_STOP=1 -f restore_schema_migrations.sql "$OPERATOR_DB_URL"
```

Post-restore verification (all mandatory):
1. **Re-export with the IDENTICAL ordered query from step 1b** to a second file, and require
   **byte-for-byte equality** with the pre-S1 export — compare `shasum -a 256` of both files.
   Equal hashes verify EVERY column — `statements` (full array contents), `name`, `created_by`,
   `idempotency_key`, `rollback` — including NULL values and array contents, not just the three
   digest columns.
2. Row count 262 · version list identical · `supabase migration list` matches the pre-S1 state.
3. Schema fingerprint (`scripts/fingerprint_rollup.sql`) unchanged.
Restoration B changes only `supabase_migrations.schema_migrations` rows; no application DDL or
application-data DML executes.

---

## Related one-off record (NOT part of this runbook's procedure)

The approved emergency ACL hotfix of 2026-08-09 (`REVOKE ALL ON FUNCTION
public.wipe_organization_operational_data(uuid) FROM PUBLIC, anon, authenticated;`) was executed
directly with **no** migration-history row, by design. Its documented inverse — requiring separate
approval, and deliberately **excluding PUBLIC**, which had no EXECUTE before the hotfix — is:

```sql
GRANT EXECUTE ON FUNCTION public.wipe_organization_operational_data(uuid) TO anon, authenticated;
```
