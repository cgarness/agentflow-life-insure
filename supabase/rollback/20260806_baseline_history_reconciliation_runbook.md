# Production migration-history reconciliation runbook — baseline `20260806000000`

**Nature of this operation:** migration-history metadata reconciliation. It **does change rows** —
specifically, and only, rows of `supabase_migrations.schema_migrations` (the CLI's tracking table).
The accurate safety claims are: **no application DDL executes, no application-data DML executes,
and the baseline SQL itself is never executed in production** (`supabase migration repair` edits
tracking rows without running any migration SQL — CLI docs + v2.84.5 `--help`; additionally, the
baseline's first executable statement is a multi-sentinel guard that raises on any initialized
AgentFlow database, so production is structurally incapable of executing it even if mis-pushed).
No application table, policy, function, or datum changes in either direction.

**Approval gates (each requires Chris's explicit go, in order; never collapsed):**

- **S1** — migration-history **metadata reconciliation only** (this runbook's procedure).
- **S2** — **read-only** post-S1 verification, Supabase advisors, and S3 preparation. **No
  `supabase db push` occurs in S2.**
- **S3** — separately approved application of PR #352 M1 → M2 → M3. **This is the only
  `db push`.**
- Frontend merge/deployment only after the backend is ready.

**Execution worktrees (recorded per gate; migration-list wording must always name the worktree):**

| Gate | Worktree | Post-gate `supabase migration list --linked` expectation |
|---|---|---|
| S1, S2 | dedicated clean worktree of **corrected `origin/main`** at a recorded commit | LOCAL and REMOTE both contain exactly `20260806000000` (main carries only the baseline; M1–M3 are not in this worktree — their production **absence** is proven by the remote list itself) |
| — same remote state viewed from the PR #352 worktree | PR #352 head | REMOTE contains the baseline only; M1/M2/M3 appear **local-only/pending** |
| S3 | PR #352 head worktree (M1–M3 live there) | LOCAL and REMOTE both contain baseline + M1 + M2 + M3 |

Never write "local and remote both contain exactly the baseline" without naming the corrected-main
worktree — from the PR #352 worktree that wording is false.

---

## S1 procedure

**Operator artifact location (binding, not an example):** `/Users/chrisgarness/agentflow-operator`
— an explicit absolute path outside the Git repository. Directory mode **700**; every artifact in
it (snapshot, checksums, verification scripts, fingerprints, expected inventories) mode **600**.
Nothing in it is ever committed, pasted, uploaded, or printed.

```bash
mkdir -p /Users/chrisgarness/agentflow-operator
chmod 700 /Users/chrisgarness/agentflow-operator
```

**Resolution rule:** every `<RESOLVE-BEFORE-S1: …>` placeholder below (worktree path, commit SHA,
script SHA) MUST be resolved to a literal value and recorded in the S1 execution plan before S1
begins. **S1 hard-stops if any placeholder remains unresolved.**

### 0. Preflight (read-only; HARD STOP on any mismatch)

```bash
supabase --version                       # must print 2.84.5; any other version → STOP and report
supabase migration repair --help         # must match: [version]... --status [applied|reverted], --linked default true
supabase migration list --help           # unexpected flags/behavior → STOP
cat supabase/.temp/project-ref           # must print exactly: jncvvsvckxhqgqvkppmj
supabase migration list --linked         # REMOTE: 262 versions, 20240401 .. 20260805090000
```

Linkage must already exist. **`supabase link` is never run during S1** — missing or incorrect
linkage is a hard stop, not something to fix mid-operation. Chris confirms in the S1 approval that
**no deployment, CI migration job, or other migration operator is active** for the duration.

### 1a. Verify the live column inventory (HARD STOP on any difference)

The confirmed production shape (read-only inspections, 2026-08-09 and 2026-08-11) is exactly
**six columns in this order**: `version, statements, name, created_by, idempotency_key, rollback`.

```sql
select string_agg(column_name, ',' order by ordinal_position)
from information_schema.columns
where table_schema = 'supabase_migrations' and table_name = 'schema_migrations';
-- REQUIRED result, exactly: version,statements,name,created_by,idempotency_key,rollback
-- If it differs in any way (columns added/removed/reordered), STOP: this runbook's export and
-- restoration statements no longer match the live table and must be revised first.
```

### 1b. EXACT full-row snapshot (HARD STOP if it cannot be created and verified)

Export all six named columns, ordered by version (psql `\copy` writes client-side). The snapshot
captures every column of every row — complete `statements` arrays, `name`, `created_by`,
`idempotency_key`, `rollback`, and any NULLs — not a digest. The statements contain historical SQL
(embedded URLs, object names, historical configuration): treat the artifact as **potentially
sensitive**. Never print, paste, commit, or upload it.

```bash
cd /Users/chrisgarness/agentflow-operator
psql -X -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" -c \
 "\copy (select version, statements, name, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations order by version) to 'schema_migrations_full_snapshot.csv' with (format csv, header true)"
chmod 600 schema_migrations_full_snapshot.csv
shasum -a 256 schema_migrations_full_snapshot.csv > schema_migrations_full_snapshot.csv.sha256
chmod 600 schema_migrations_full_snapshot.csv.sha256
shasum -a 256 -c schema_migrations_full_snapshot.csv.sha256   # must print: OK → else STOP
```

(`$OPERATOR_DB_URL` is the operator's percent-encoded production connection string, exported
privately in the session and never echoed. It appears in no command output and no artifact.)

**NEVER parse this CSV with `awk`, `cut`, `grep`, or any other line-oriented tool** — `statements`
contains multiline quoted SQL, so line-oriented parsing is structurally invalid. The only reader of
this file is PostgreSQL's own CSV parser via `\copy` (below, and in inverse B).

### 1c. Artifact fidelity + archive provenance verification (HARD STOP before any repair)

**Why:** the snapshot is the sole input to inverse B. Validating the live table proves nothing
about the exported artifact. The artifact itself must be re-parsed **by the exact mechanism the
recovery would use** and compared full-row, both directions, against the still-unchanged live
table (AGENT_RULES invariant: exported recovery artifacts must be proven, not assumed).

**Archive ruling (Chris, 2026-08-11).** The binding pre-S1 authority is this snapshot compared
against the live table. The archived files under `supabase/migrations_archive/pre_baseline/` are
**historical provenance only**. The archive comparison is performed **by migration-name multiset**
(262 snapshot names vs 262 archive-name suffixes after excluding the documented never-applied trio
`20260527000000_phone_system_rls_harden.sql`, `20260527133000_call_recordings_storage_update_policy.sql`,
`20260614120000_leaderboard_rpc_tiebreak.sql`; zero multiset differences, duplicate multiplicity
preserved). Measured 2026-08-11 and recorded here: the former **version-prefix** comparison
mismatches **34↔34**, and the archive contains duplicate prefixes `20260602120000` and
`20260603120000` (two files each) — the renamed/duplicate-prefix history the archive README
documents. That version-prefix equality requirement is removed as structurally impossible. Name
equality proves **inventory provenance only** — it does NOT prove archived filenames, version
prefixes, or SQL contents equal production (README class 5: 25 as-applied deltas, verified
cosmetic). **S1 repair versions are NEVER derived from archive filenames** — only from the
validated production snapshot.

Generate the archive-name input (single-column file; migration filenames are single-line tokens,
so this listing is safe — the prohibition on line-oriented parsing applies to the six-column CSV,
not to this):

```bash
ls <RESOLVE-BEFORE-S1: S1_WORKTREE_ABS_PATH>/supabase/migrations_archive/pre_baseline/*.sql \
 | xargs -n1 basename | sed -E 's/^[0-9]+_//; s/\.sql$//' \
 | grep -vxE 'phone_system_rls_harden|call_recordings_storage_update_policy|leaderboard_rpc_tiebreak' \
 > /Users/chrisgarness/agentflow-operator/archive_names.txt
chmod 600 /Users/chrisgarness/agentflow-operator/archive_names.txt
wc -l < /Users/chrisgarness/agentflow-operator/archive_names.txt    # must print 262 → else STOP
```

Save the following verbatim as `/Users/chrisgarness/agentflow-operator/verify_snapshot_fidelity.sql`
(mode 600):

```sql
\set ON_ERROR_STOP on
begin;

-- Session-local staging shaped from the live table; parsed by the SAME mechanism inverse B uses.
create temporary table snapshot_verify
  (like supabase_migrations.schema_migrations) on commit drop;
\copy snapshot_verify (version, statements, name, created_by, idempotency_key, rollback) from '/Users/chrisgarness/agentflow-operator/schema_migrations_full_snapshot.csv' with (format csv, header true)

-- Archive-name provenance input (one name per line, no header).
create temporary table archive_names (name text) on commit drop;
\copy archive_names (name) from '/Users/chrisgarness/agentflow-operator/archive_names.txt'

do $verify$
declare
  v_count bigint; v_nulls bigint; v_dups bigint; v_first text; v_last text;
  v_only_staged bigint; v_only_live bigint;
  v_arch_count bigint; v_arch_nulls bigint; v_name_mismatches bigint;
begin
  ---------------------------------------------------------------- snapshot artifact fidelity
  select count(*), count(*) filter (where version is null) into v_count, v_nulls from snapshot_verify;
  select count(*) into v_dups
    from (select version from snapshot_verify group by version having count(*) > 1) d;
  select min(version), max(version) into v_first, v_last from snapshot_verify;
  if v_count <> 262 then raise exception 'staged row count % <> 262', v_count; end if;
  if v_nulls <> 0 then raise exception '% staged rows have NULL version', v_nulls; end if;
  if v_dups  <> 0 then raise exception '% duplicate staged versions', v_dups; end if;
  if v_first <> '20240401' or v_last <> '20260805090000' then
    raise exception 'staged version range % .. % does not match 20240401 .. 20260805090000', v_first, v_last;
  end if;

  -- Full-row, six-column, BIDIRECTIONAL comparison against the still-unchanged live table.
  -- EXCEPT ALL proves six-column ROW EQUIVALENCE AFTER PARSING (null-safe, duplicate-preserving,
  -- including complete statements array contents). It does NOT prove byte-identical CSV
  -- serialization — byte identity is separately proven by inverse B's post-restoration re-export
  -- and SHA-256 comparison against this snapshot.
  select count(*) into v_only_staged from (
    select version, statements, name, created_by, idempotency_key, rollback from snapshot_verify
    except all
    select version, statements, name, created_by, idempotency_key, rollback
      from supabase_migrations.schema_migrations) d;
  select count(*) into v_only_live from (
    select version, statements, name, created_by, idempotency_key, rollback
      from supabase_migrations.schema_migrations
    except all
    select version, statements, name, created_by, idempotency_key, rollback from snapshot_verify) d;
  if v_only_staged <> 0 or v_only_live <> 0 then
    raise exception 'snapshot/live full-row mismatch: % staged-only rows, % live-only rows',
      v_only_staged, v_only_live;
  end if;

  ---------------------------------------------------------------- archive provenance (by name)
  select count(*), count(*) filter (where name is null or btrim(name) = '')
    into v_arch_count, v_arch_nulls from archive_names;
  if v_arch_count <> 262 then raise exception 'archive name count % <> 262', v_arch_count; end if;
  if v_arch_nulls <> 0 then raise exception '% NULL/empty archive names', v_arch_nulls; end if;
  if exists (select 1 from snapshot_verify where name is null) then
    raise exception 'staged snapshot contains NULL migration names';
  end if;

  -- Grouped name/count pairs, compared in BOTH directions via FULL JOIN: preserves duplicate
  -- multiplicity (a set-only comparison would wrongly pass when a name legitimately appears
  -- twice on one side and once on the other).
  select count(*) into v_name_mismatches from (
    select coalesce(a.name, s.name) as name, a.c as archive_count, s.c as snapshot_count
    from (select name, count(*) c from archive_names group by name) a
    full join (select name, count(*) c from snapshot_verify group by name) s using (name)
    where a.c is distinct from s.c) d;
  if v_name_mismatches <> 0 then
    raise exception 'archive/snapshot name-multiset mismatch: % grouped differences', v_name_mismatches;
  end if;

  raise notice 'snapshot fidelity + archive provenance verified: 262 rows, 0/0 full-row diff, 0 name-multiset diff';
end
$verify$;

rollback;   -- verification only: temp tables dropped, nothing persisted, live rows untouched
```

Run it (fail-fast; any load, parse, checksum, count, range, uniqueness, or comparison failure
aborts **before any repair command exists**):

```bash
chmod 600 /Users/chrisgarness/agentflow-operator/verify_snapshot_fidelity.sql
psql -X -v ON_ERROR_STOP=1 -f /Users/chrisgarness/agentflow-operator/verify_snapshot_fidelity.sql "$OPERATOR_DB_URL"
```

### 1d. Pre-S1 fingerprint capture (read-only)

Record in the S1 execution plan, as literals, before S1:

- S1 execution worktree absolute path: `<RESOLVE-BEFORE-S1: S1_WORKTREE_ABS_PATH>` (a dedicated
  clean worktree of corrected `origin/main`)
- Its branch and commit SHA: `<RESOLVE-BEFORE-S1: S1_WORKTREE_COMMIT_SHA>`
- Fingerprint script absolute path:
  `<RESOLVE-BEFORE-S1: S1_WORKTREE_ABS_PATH>/scripts/fingerprint_rollup.sql`
- Its SHA-256: `<RESOLVE-BEFORE-S1: FINGERPRINT_SCRIPT_SHA256>`
  (`shasum -a 256 <S1_WORKTREE_ABS_PATH>/scripts/fingerprint_rollup.sql`)

```bash
psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
  -f "<RESOLVE-BEFORE-S1: S1_WORKTREE_ABS_PATH>/scripts/fingerprint_rollup.sql" \
  > /Users/chrisgarness/agentflow-operator/fingerprint_pre_s1.txt
chmod 600 /Users/chrisgarness/agentflow-operator/fingerprint_pre_s1.txt
cd /Users/chrisgarness/agentflow-operator
shasum -a 256 fingerprint_pre_s1.txt > fingerprint_pre_s1.txt.sha256
chmod 600 fingerprint_pre_s1.txt.sha256
```

Both fingerprint scripts emit deterministically ordered output, so byte-identical comparison is a
valid post-S1 criterion. No repository-relative script path is ever used — the invocation is
absolute, so it works regardless of the current directory.

### 2. Mark the 262 historical versions reverted (deletes tracking rows only) — four literal batches with checkpoints

The versions below are **literal strings derived from production's live inventory** (read-only,
2026-08-11), and the fresh validated snapshot of §1c MUST exactly match this combined 262-version
literal inventory before batch 1 runs (any difference → STOP). No variables, no globs, no command
substitution, no archive-derived versions — ever.

After EVERY batch, run `supabase migration list --linked` and compare the remote inventory against
the precomputed expected-remaining file for that checkpoint (four files generated from the
validated snapshot at execution time, mode 600, in the operator directory). **Exact-set
comparison, never count-only.** Any nonzero exit, unexpected output, inventory mismatch,
concurrent change, or partial result → STOP immediately.

| Checkpoint | Historical rows | Exact remaining set | Baseline |
|---|---|---|---|
| Start | 262 | all of `20240401 .. 20260805090000` | absent |
| After batch 1 (66) | **196** | `20260331200100 .. 20260805090000` | absent |
| After batch 2 (66) | **130** | `20260418170010 .. 20260805090000` | absent |
| After batch 3 (65) | **65** | `20260520120000 .. 20260805090000` | absent |
| After batch 4 (65) | **0** | ∅ | absent |

```bash
# Batch 1/4 — 66 versions (20240401 .. 20260331200000)
supabase migration repair --linked --status reverted \
  20240401 20260303233510 20260303233519 20260304000001 20260305173109 20260307090000 \
  20260307101000 20260307233600 20260307235939 20260308000000 20260308093000 20260308120000 \
  20260308142900 20260308143000 20260308152955 20260308165638 20260308170000 20260308171000 \
  20260308180000 20260308190000 20260308200000 20260308205935 20260308221542 20260309030005 \
  20260309035008 20260309100000 20260310120000 20260310130000 20260310140000 20260310200001 \
  20260312192401 20260313024713 20260315180000 20260315183000 20260315184000 20260315185000 \
  20260315190000 20260316120000 20260320152407 20260321024500 20260323014000 20260323110000 \
  20260323213152 20260323213525 20260323214202 20260324000000 20260324100000 20260324100001 \
  20260325000000 20260325000001 20260325010000 20260325021000 20260325100000 20260326170000 \
  20260326173000 20260326180000 20260326200000 20260326210000 20260326220000 20260327171000 \
  20260328014500 20260328120000 20260329180000 20260330150000 20260331195900 20260331200000

# CHECKPOINT 1: supabase migration list --linked → exactly the 196 expected-remaining versions.

# Batch 2/4 — 66 versions (20260331200100 .. 20260418170007)
supabase migration repair --linked --status reverted \
  20260331200100 20260331200200 20260331200300 20260331200400 20260401000000 20260401000100 \
  20260401000200 20260401000300 20260401000400 20260402000000 20260402000001 20260402000002 \
  20260402000003 20260402000004 20260402000005 20260402000006 20260403000000 20260403000001 \
  20260403100000 20260404000000 20260404000001 20260404000002 20260404100000 20260405000000 \
  20260405000001 20260405100000 20260406000000 20260406100000 20260406200000 20260406300000 \
  20260406400000 20260406500000 20260406600000 20260406700000 20260406800000 20260406900000 \
  20260406950000 20260407000000 20260408010000 20260408020000 20260409120000 20260411190000 \
  20260412120000 20260412140000 20260412210000 20260413183000 20260413190000 20260413200000 \
  20260413220000 20260413230000 20260413240000 20260413250000 20260414120000 20260417000000 \
  20260417000001 20260417120000 20260417220000 20260418160000 20260418170000 20260418170001 \
  20260418170002 20260418170003 20260418170004 20260418170005 20260418170006 20260418170007

# CHECKPOINT 2: exactly the 130 expected-remaining versions.

# Batch 3/4 — 65 versions (20260418170010 .. 20260519140000)
supabase migration repair --linked --status reverted \
  20260418170010 20260420180000 20260421120000 20260422130000 20260422183000 20260422190000 \
  20260423020622 20260423100000 20260423140000 20260423183000 20260424100000 20260424120000 \
  20260424180000 20260425120000 20260425140000 20260426120000 20260428120000 20260429120000 \
  20260429143000 20260429152000 20260429170000 20260429190000 20260430120000 20260430120100 \
  20260430143000 20260430203000 20260502120000 20260504120000 20260504140000 20260504153000 \
  20260504154000 20260504155500 20260505000000 20260505200000 20260505221000 20260511153600 \
  20260512120000 20260512130000 20260512164000 20260512164500 20260513120000 20260513130000 \
  20260513180000 20260514120000 20260514120100 20260514120200 20260514150000 20260514160000 \
  20260514160100 20260515120000 20260515120100 20260516120000 20260516120001 20260516150000 \
  20260516150100 20260516180000 20260516230000 20260517000000 20260517140000 20260517180000 \
  20260518000000 20260519120000 20260519120001 20260519130000 20260519140000

# CHECKPOINT 3: exactly the 65 expected-remaining versions.

# Batch 4/4 — 65 versions (20260520120000 .. 20260805090000)
supabase migration repair --linked --status reverted \
  20260520120000 20260520120001 20260520173115 20260520200000 20260520210000 20260521000000 \
  20260521044133 20260521220000 20260522120000 20260522165000 20260522170000 20260522180000 \
  20260522211500 20260522212000 20260523000000 20260524120000 20260524130000 20260524140000 \
  20260524180000 20260524203157 20260524203211 20260524231933 20260525035417 20260525051519 \
  20260525120000 20260525185146 20260525215122 20260525222642 20260526044944 20260526120000 \
  20260526232518 20260527130000 20260527210617 20260527231858 20260528231010 20260529003210 \
  20260529163148 20260529211013 20260530024229 20260530051039 20260601193140 20260602172141 \
  20260603000536 20260603015807 20260603034943 20260603211123 20260604040346 20260604194202 \
  20260605153745 20260606020638 20260607155544 20260608163256 20260615163119 20260615163246 \
  20260619172143 20260619175346 20260620184619 20260621231958 20260623164242 20260625162731 \
  20260625184050 20260629231658 20260730120000 20260731180000 20260805090000

# CHECKPOINT 4: zero historical versions remain; baseline still absent.
```

### 3. Mark the baseline applied (inserts one tracking row) — only after checkpoint 4 passes

```bash
supabase migration repair --linked --status applied 20260806000000
```

### 4. Verify (all mandatory)

1. `supabase migration list --linked` **from the corrected-main S1 worktree** → LOCAL and REMOTE
   both show exactly `20260806000000` (M1–M3 are absent from this worktree by construction; the
   remote list itself proves they are unapplied to production).
2. `select count(*), min(version) from supabase_migrations.schema_migrations` → `1 | 20260806000000`.
3. Post-S1 fingerprint with the IDENTICAL invocation of §1d:

```bash
psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
  -f "<RESOLVE-BEFORE-S1: S1_WORKTREE_ABS_PATH>/scripts/fingerprint_rollup.sql" \
  > /Users/chrisgarness/agentflow-operator/fingerprint_post_s1.txt
chmod 600 /Users/chrisgarness/agentflow-operator/fingerprint_post_s1.txt
cd /Users/chrisgarness/agentflow-operator
shasum -a 256 fingerprint_post_s1.txt > fingerprint_post_s1.txt.sha256
chmod 600 fingerprint_post_s1.txt.sha256
diff fingerprint_pre_s1.txt fingerprint_post_s1.txt       # must produce NO output
shasum -a 256 fingerprint_pre_s1.txt fingerprint_post_s1.txt   # the two hashes must be equal
```

Any fingerprint difference whatsoever is a hard stop and an immediate investigation trigger —
reconciliation touches no schema.

## Failure recovery (partial completion)

Each version's repair is independent and idempotent: diff `supabase migration list --linked`
against the snapshot's 262-version inventory (and the per-checkpoint expected-remaining files) to
identify exactly which operations completed. Re-issuing a missing `--status reverted` for a
still-present historical version is safe to repeat; the baseline `--status applied` is likewise
idempotent. No migration SQL ran at any point — only tracking-table row edits. **Recovery is
described here but is never automatic: after any unexpected production failure the operator stops,
preserves all artifacts and command output, reports, and awaits Chris's separate direction before
issuing any recovery command.**

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
cd /Users/chrisgarness/agentflow-operator && shasum -a 256 -c schema_migrations_full_snapshot.csv.sha256
# Proceed ONLY on: schema_migrations_full_snapshot.csv: OK
```

**B-2. Save as `restore_schema_migrations.sql`** (absolute, permission-restricted snapshot path;
the path must live OUTSIDE the Git repository):

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
   digest columns. (This is where byte-identical CSV serialization is proven; §1c's EXCEPT ALL
   proves parsed row equivalence.)
2. Row count 262 · version list identical · `supabase migration list` matches the pre-S1 state.
3. Schema fingerprint (identical invocation of §1d) unchanged.
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
