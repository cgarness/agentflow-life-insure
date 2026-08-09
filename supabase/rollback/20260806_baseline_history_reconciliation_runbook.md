# Production migration-history reconciliation runbook — baseline `20260806000000`

**Nature of this operation:** metadata-only. `supabase migration repair` edits rows in
`supabase_migrations.schema_migrations`; it applies **no SQL** and reverts **no SQL** (CLI docs,
confirmed v2.84.5 `--help` + official reference). The baseline migration itself opens with a guard
that raises on any initialized database, so production is **structurally incapable** of executing
it even if mis-pushed. No table, row, policy, or function changes in either direction.

**Approval gates (each requires Chris's explicit go, in order):**
- **S1** — execute this reconciliation.
- **S2** — any `supabase db push` after reconciliation (advisors run here).
- **S3** — apply PR #352 M1 → M2 → M3.

---

## S1 procedure

### 1. Snapshot (read-only; abort if it fails)

```sql
select version, name, md5(array_to_string(statements, E'\n')) as content_md5
from supabase_migrations.schema_migrations order by version;
```

Save the full result beside this runbook as `schema_migrations_snapshot_<date>.txt`.
Expected: **262 rows**, `20240401` … `20260805090000` (inventory:
`supabase/migrations_archive/pre_baseline/` minus the three never-applied files).

### 2. Mark the 262 historical versions reverted (deletes tracking rows only)

```bash
supabase migration repair --status reverted <all 262 versions, batched>
```

Multi-version invocations are supported (`migration repair [version] ... --status ...`). Batch to
keep command lines manageable (e.g. 4 × ~65). Non-atomic across invocations — see recovery below.

### 3. Mark the baseline applied (inserts one tracking row)

```bash
supabase migration repair --status applied 20260806000000
```

### 4. Verify

```bash
supabase migration list     # LOCAL and REMOTE both show exactly: 20260806000000
```

```sql
select count(*) from supabase_migrations.schema_migrations;   -- expected: 1
```

Then run `scripts/fingerprint_rollup.sql` against production and compare with the values recorded
in the repair PR: **must be unchanged** — reconciliation touches no schema.

## Failure recovery (partial completion)

Every version's repair is independent and idempotent. If interrupted: re-run `migration list`,
diff against the snapshot, and re-issue `--status reverted` for any version still present /
`--status applied 20260806000000` if missing. No SQL ran at any point.

## Complete inverse (never without separate approval)

```bash
supabase migration repair --status reverted 20260806000000
supabase migration repair --status applied <all 262 versions from the snapshot, batched>
```

Restores the tracking table to the snapshot exactly. Metadata-only in this direction too.

---

## Related one-off record (NOT part of this runbook's procedure)

The approved emergency ACL hotfix of 2026-08-09 (`REVOKE ALL ON FUNCTION
public.wipe_organization_operational_data(uuid) FROM PUBLIC, anon, authenticated;`) was executed
directly with **no** migration-history row, by design. Its documented inverse — requiring separate
approval, and deliberately **excluding PUBLIC**, which had no EXECUTE before the hotfix — is:

```sql
GRANT EXECUTE ON FUNCTION public.wipe_organization_operational_data(uuid) TO anon, authenticated;
```
