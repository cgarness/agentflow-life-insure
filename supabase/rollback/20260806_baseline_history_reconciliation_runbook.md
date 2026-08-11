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

| Gate | Worktree | Post-gate `supabase --workdir … migration list --linked` expectation |
|---|---|---|
| S1, S2 | `/Users/chrisgarness/agentflow-s1-main` — a dedicated clean worktree of **corrected `origin/main`** at a recorded commit | LOCAL and REMOTE both contain exactly `20260806000000` (main carries only the baseline; M1–M3 are not in this worktree — their production **absence** is proven by the remote list itself) |
| — same remote state viewed from the PR #352 worktree | PR #352 head | REMOTE contains the baseline only; M1/M2/M3 appear **local-only/pending** |
| S3 | PR #352 head worktree (M1–M3 live there) | LOCAL and REMOTE both contain baseline + M1 + M2 + M3 |

Never write "local and remote both contain exactly the baseline" without naming the corrected-main
worktree — from the PR #352 worktree that wording is false.

---

## Binding paths, placeholders, and execution rules

| Purpose | Absolute path (binding, not an example) |
|---|---|
| S1/S2 execution worktree | `/Users/chrisgarness/agentflow-s1-main` |
| Operator artifact directory | `/Users/chrisgarness/agentflow-operator` |

The operator directory is mode **700**; every artifact in it (snapshot, checksums, verification and
restoration scripts, fingerprints, expected/actual inventories) is mode **600**. Nothing in it is
ever committed, pasted, uploaded, or printed.

```bash
set -euo pipefail; set +x; umask 077
mkdir -p /Users/chrisgarness/agentflow-operator
chmod 700 /Users/chrisgarness/agentflow-operator
```

**Placeholder resolution rule.** Every `<RESOLVE-BEFORE-S1: …>` token below MUST be resolved to a
literal value and recorded in the S1 execution plan before S1 begins. **S1 hard-stops while any
placeholder remains unresolved.**

**Fail-closed shell rule.** Every copy-runnable block below begins with exactly two lines —
`set -euo pipefail; set +x; umask 077` and a `.` (source) of the shared helper file created below.
The single exception is the operator-directory setup block, which necessarily runs before the
helper file exists and therefore carries the `set` line plus its own inline guard.
Consequences, all mandatory:

- Any failed CLI command, `psql` command, checksum verification, `cmp` comparison, count check,
  project-binding check, file-mode check, or fingerprint comparison **terminates the block** before
  the next command runs — the protection is the shell's exit status, never prose.
- `set +x` guarantees no shell tracing; `set -u` plus the helpers' `: "${OPERATOR_DB_URL:?…}"`
  assertion makes a lost or unexported connection string an immediate failure rather than a silent
  empty connection string.
- Expected-negative assertions (baseline absence, file presence, counts) live in helper functions
  built from explicit `if/then` blocks, so they are **fail-closed even when the target file is
  missing**. A count check written inline as `if [ "$(wc -l < FILE)" -ne N ]` is NOT safe: when
  `FILE` is absent the substitution yields an empty string, `[` exits 2, and because it sits in an
  `if` condition `set -e` is suppressed and the STOP branch is skipped. This was found by
  adversarial review of an earlier draft of this runbook and is the reason `require_lines` exists.
- **No automatic recovery is authorized.** Any unexpected failure means: stop, preserve every
  artifact and all command output, report, and await Chris's separate direction.

**Artifact preservation rule (no destructive setup).** Before creating any snapshot, checksum,
expected inventory, actual inventory, verification script, restoration script, or fingerprint, its
target path **must not already exist**. `require_absent` hard-stops if it does. A prior or
partially completed attempt's artifacts are evidence: **never overwritten, never deleted.** (The
disposable-local rehearsal may remove only the artifacts that rehearsal itself created.)

**Create the shared helper file first** (mode 600; every later block sources it, so a missing or
unreadable helper file aborts that block immediately):

```bash
set -euo pipefail; set +x; umask 077
if [ -e /Users/chrisgarness/agentflow-operator/s1_helpers.sh ]; then
  printf 'STOP: s1_helpers.sh already exists — preserving prior evidence\n' >&2; exit 1
fi
cat > /Users/chrisgarness/agentflow-operator/s1_helpers.sh <<'HELPERS'
OPDIR=/Users/chrisgarness/agentflow-operator
S1WT=/Users/chrisgarness/agentflow-s1-main
: "${OPERATOR_DB_URL:?STOP: run this inside the prepared S1 shell — OPERATOR_DB_URL is not exported}"

require_absent() {                     # <path> — never overwrite prior evidence
  if [ -e "$1" ]; then
    printf 'STOP: %s already exists — preserving prior evidence; never overwrite or delete it.\n' "$1" >&2
    exit 1
  fi
}
require_file() {                       # <path>
  if [ ! -f "$1" ]; then printf 'STOP: %s is missing\n' "$1" >&2; exit 1; fi
}
require_lines() {                      # <path> <expected-count> — fail-closed when absent
  require_file "$1"
  __n=$(wc -l < "$1" | tr -d '[:space:]')   # pipefail keeps this fail-closed
  if [ "$__n" -ne "$2" ]; then
    printf 'STOP: %s has %s lines, expected %s\n' "$1" "$__n" "$2" >&2; exit 1
  fi
}
require_server_count() {               # <expected-count> — independent of the captured file
  __s=$(psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
        -c "select count(*) from supabase_migrations.schema_migrations")
  if [ "$__s" -ne "$1" ]; then
    printf 'STOP: server reports %s history rows, expected %s\n' "$__s" "$1" >&2; exit 1
  fi
}
capture_inventory() {                  # <absolute-path>
  require_absent "$1"
  psql -X -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" -c \
    "\copy (select version from supabase_migrations.schema_migrations order by version) to '$1'"
  require_file "$1"
  chmod 600 "$1"
}
require_baseline_absent() {            # <path>
  if grep -qx 20260806000000 "$1"; then
    printf 'STOP: baseline 20260806000000 present in %s — must be absent at this stage\n' "$1" >&2
    exit 1
  fi
}
require_project_binding() {            # re-proves CLI targeting immediately before a mutation
  require_file "$S1WT/supabase/config.toml"
  require_file "$S1WT/supabase/.temp/project-ref"
  if [ "$(cat "$S1WT/supabase/.temp/project-ref")" != "jncvvsvckxhqgqvkppmj" ]; then
    printf 'STOP: linked project-ref is not jncvvsvckxhqgqvkppmj\n' >&2; exit 1
  fi
}
HELPERS
chmod 600 /Users/chrisgarness/agentflow-operator/s1_helpers.sh
```

`$OPERATOR_DB_URL` is the operator's percent-encoded production connection string, exported
privately in the session. **It is never printed, never written to an artifact, and the environment
is never dumped.** Shell tracing stays off (`set +x`) for the entire procedure.

---

## S1 procedure

### 0. Preflight — worktree binding, CLI linkage, and psql identity (read-only; HARD STOP on any mismatch)

The Supabase CLI's linkage and `$OPERATOR_DB_URL` are **independent targeting mechanisms**.
Verifying the CLI worktree alone does not prove that the snapshot and checkpoint `psql` queries
address the same database. Both must be proven, separately, before anything is exported.

**0a. Worktree binding.** `--workdir` is a global flag that changes the CLI process's working
directory before it resolves the project (verified against v2.84.5: a nonexistent path fails with
`failed to change workdir: chdir …`, exit 1). Every Supabase command in this runbook therefore
carries the literal `--workdir /Users/chrisgarness/agentflow-s1-main` **and** an explicit
`--linked`. No command depends on the shell's current directory.

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh

test -f "$S1WT/supabase/config.toml"
test -f "$S1WT/supabase/.temp/project-ref"
if [ "$(cat "$S1WT/supabase/.temp/project-ref")" != "jncvvsvckxhqgqvkppmj" ]; then
  printf 'STOP: linked project-ref is not jncvvsvckxhqgqvkppmj\n' >&2; exit 1
fi
if [ "$(git -C "$S1WT" rev-parse HEAD)" != "<RESOLVE-BEFORE-S1: S1_WORKTREE_COMMIT_SHA>" ]; then
  printf 'STOP: S1 worktree is not at the recorded corrected-main commit\n' >&2; exit 1
fi
if [ -n "$(git -C "$S1WT" status --porcelain)" ]; then
  printf 'STOP: S1 worktree is not clean\n' >&2; exit 1
fi
supabase --workdir "$S1WT" --version                        # must print 2.84.5
supabase --workdir "$S1WT" migration repair --help          # [version]... --status [applied|reverted], --linked default true
supabase --workdir "$S1WT" migration list --help            # unexpected flags/behavior → STOP
supabase --workdir "$S1WT" migration list --linked          # REMOTE: 262 versions, 20240401 .. 20260805090000
```

`supabase link` is **never** run during S1 — missing or incorrect linkage is a hard stop, not
something to fix mid-operation. Chris confirms in the S1 approval that **no deployment, CI
migration job, or other migration operator is active** for the duration.

**0b. psql connection identity (non-secret fields only).** Resolve and record these literals before
S1, then assert them. The connection must be either the **direct** production host, or an
**exact allowlisted pooler** host/port whose username carries the production project-ref suffix.

| Field | Resolved literal |
|---|---|
| Connection form (direct \| pooler) | `<RESOLVE-BEFORE-S1: CONN_FORM>` |
| Expected host — direct form MUST be `db.jncvvsvckxhqgqvkppmj.supabase.co`; pooler form MUST be the exact allowlisted pooler host | `<RESOLVE-BEFORE-S1: EXPECTED_HOST>` |
| Expected port — `5432` direct; allowlisted pooler port otherwise | `<RESOLVE-BEFORE-S1: EXPECTED_PORT>` |
| Expected database | `postgres` |
| Expected user — direct form `postgres`; pooler form MUST end in `.jncvvsvckxhqgqvkppmj` | `<RESOLVE-BEFORE-S1: EXPECTED_USER>` |

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/psql_identity_actual.txt"
require_absent "$OPDIR/psql_identity_server.txt"

# Non-secret identity only: psql's own :HOST/:PORT/:DBNAME/:USER variables. The password, the full
# URI, and any query parameters are never rendered, logged, or written to an artifact.
psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
  -c '\echo :HOST :PORT :DBNAME :USER' > "$OPDIR/psql_identity_actual.txt"
chmod 600 "$OPDIR/psql_identity_actual.txt"

EXPECTED_IDENTITY='<RESOLVE-BEFORE-S1: EXPECTED_HOST> <RESOLVE-BEFORE-S1: EXPECTED_PORT> postgres <RESOLVE-BEFORE-S1: EXPECTED_USER>'
if [ "$(cat "$OPDIR/psql_identity_actual.txt")" != "$EXPECTED_IDENTITY" ]; then
  printf 'STOP: psql connection identity does not match the resolved expected identity\n' >&2; exit 1
fi

# Server-side corroboration (still non-secret).
psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
  -c "select current_database() || ' ' || current_user" > "$OPDIR/psql_identity_server.txt"
chmod 600 "$OPDIR/psql_identity_server.txt"
if [ "$(cat "$OPDIR/psql_identity_server.txt")" != "postgres <RESOLVE-BEFORE-S1: EXPECTED_USER>" ]; then
  printf 'STOP: server-reported database/user does not match the resolved expected identity\n' >&2; exit 1
fi
```

**Every** subsequent `psql` invocation in this runbook — snapshot export, fidelity verification,
planned/expected inventories, all actual-inventory captures, both fingerprints, and inverse B —
uses this same preverified `$OPERATOR_DB_URL` — including the §1a column-inventory gate and the §4 count check. A mismatch in either mechanism is a hard stop.

### 1a. Verify the live column inventory (HARD STOP on any difference)

The confirmed production shape (read-only inspections, 2026-08-09 and 2026-08-11) is exactly
**six columns in this order**: `version, statements, name, created_by, idempotency_key, rollback`.

Run through the **preverified** connection of §0b (this gate is targeting-verified like every
other psql step in this runbook):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/live_column_inventory.txt"
psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" -c \
  "select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'" \
  > "$OPDIR/live_column_inventory.txt"
require_file "$OPDIR/live_column_inventory.txt"
chmod 600 "$OPDIR/live_column_inventory.txt"
if [ "$(cat "$OPDIR/live_column_inventory.txt")" \
     != "version,statements,name,created_by,idempotency_key,rollback" ]; then
  printf 'STOP: live column inventory differs — this runbook'"'"'s export and restoration\n' >&2
  printf '      statements no longer match the live table and must be revised first.\n' >&2
  exit 1
fi
```

### 1b. EXACT full-row snapshot (HARD STOP if it cannot be created and verified)

Exports all six named columns, ordered by version (psql `\copy` writes client-side). The snapshot
captures every column of every row — complete `statements` arrays, `name`, `created_by`,
`idempotency_key`, `rollback`, and any NULLs — not a digest. The statements contain historical SQL
(embedded URLs, object names, historical configuration): treat the artifact as **potentially
sensitive**. Never print, paste, commit, or upload it.

**Checksum records use the artifact's ABSOLUTE path.** A record written from a relative filename
(`shasum -a 256 art.csv`) stores only the bare name, so `shasum -c` invoked from any other
directory re-hashes whatever file of that name exists in the *current* directory — verified
locally: it silently targeted a same-named decoy. Every checksum record below is therefore created
by hashing the absolute path, making verification cwd-independent. Checksum files are never
hand-edited.

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/schema_migrations_full_snapshot.csv"
require_absent "$OPDIR/schema_migrations_full_snapshot.csv.sha256"

psql -X -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" -c \
 "\copy (select version, statements, name, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations order by version) to '$OPDIR/schema_migrations_full_snapshot.csv' with (format csv, header true)"
chmod 600 "$OPDIR/schema_migrations_full_snapshot.csv"

shasum -a 256 "$OPDIR/schema_migrations_full_snapshot.csv" \
  > "$OPDIR/schema_migrations_full_snapshot.csv.sha256"
chmod 600 "$OPDIR/schema_migrations_full_snapshot.csv.sha256"
shasum -a 256 -c "$OPDIR/schema_migrations_full_snapshot.csv.sha256"   # must print: … OK
```

**NEVER parse this CSV with `awk`, `cut`, `grep`, or any other line-oriented tool** — `statements`
contains multiline quoted SQL, so line-oriented parsing is structurally invalid. The only reader of
this file is PostgreSQL's own CSV parser via `\copy` (below, and in inverse B).

### 1c. Artifact fidelity, archive provenance, and the planned inventory (HARD STOP before any repair)

**Why:** the snapshot is the sole input to inverse B. Validating the live table proves nothing
about the exported artifact. The artifact itself must be re-parsed **by the exact mechanism the
recovery would use** and compared full-row, both directions, against the still-unchanged live
table (AGENT_RULES invariant: exported recovery artifacts must be proven, not assumed).

**Archive ruling (Chris, 2026-08-11).** The binding pre-S1 authority is this snapshot compared
against the live table. The archived files under `supabase/migrations_archive/pre_baseline/` are
**historical provenance only**. The archive comparison is performed **by migration-name multiset**
(262 snapshot names vs 262 archive-name suffixes after excluding the documented never-applied trio
`20260527000000_phone_system_rls_harden.sql`, `20260527133000_call_recordings_storage_update_policy.sql`,
`20260614120000_leaderboard_rpc_tiebreak.sql`; zero grouped-count differences, duplicate
multiplicity preserved). Measured 2026-08-11 and recorded here: the former **version-prefix**
comparison mismatches **34↔34**, and the archive contains duplicate prefixes `20260602120000` and
`20260603120000` (two files each) — the renamed/duplicate-prefix history the archive README
documents. That version-prefix equality requirement is removed as structurally impossible. Name
equality proves **inventory provenance only** — it does NOT prove archived filenames, version
prefixes, or SQL contents equal production (README class 5: 25 as-applied deltas, verified
cosmetic). **S1 repair versions are NEVER derived from archive filenames** — only from the
validated production snapshot, cross-checked against the literal `planned_versions` inventory
below.

Generate the archive-name input (single-column file; migration filenames are single-line tokens, so
this listing is safe — the prohibition on line-oriented parsing applies to the six-column CSV):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/archive_names.txt"
ls "$S1WT"/supabase/migrations_archive/pre_baseline/*.sql \
 | xargs -n1 basename | sed -E 's/^[0-9]+_//; s/\.sql$//' \
 | grep -vxE 'phone_system_rls_harden|call_recordings_storage_update_policy|leaderboard_rpc_tiebreak' \
 > "$OPDIR/archive_names.txt"
chmod 600 "$OPDIR/archive_names.txt"
if [ "$(wc -l < "$OPDIR/archive_names.txt")" -ne 262 ]; then
  printf 'STOP: archive name count is not 262\n' >&2; exit 1
fi
```

Save the following verbatim as `/Users/chrisgarness/agentflow-operator/verify_snapshot_fidelity.sql`
(mode 600). It stages the snapshot, validates it, validates the 262-literal planned inventory,
proves planned == snapshot in both directions, and only then writes the six expected checkpoint
inventories — all inside one transaction that ends in `ROLLBACK` (the `\copy … to` exports are
client-side filesystem writes and survive; no database state does).

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

-- The 262 literal versions to be reverted, with their batch numbers. These are the ONLY versions
-- any repair command may name, and they are proven equal to the staged snapshot below.
create temporary table planned_versions (version text not null, batch int not null) on commit drop;
insert into planned_versions (version, batch) values
  ('20240401',1),('20260303233510',1),('20260303233519',1),('20260304000001',1),('20260305173109',1),('20260307090000',1),
  ('20260307101000',1),('20260307233600',1),('20260307235939',1),('20260308000000',1),('20260308093000',1),('20260308120000',1),
  ('20260308142900',1),('20260308143000',1),('20260308152955',1),('20260308165638',1),('20260308170000',1),('20260308171000',1),
  ('20260308180000',1),('20260308190000',1),('20260308200000',1),('20260308205935',1),('20260308221542',1),('20260309030005',1),
  ('20260309035008',1),('20260309100000',1),('20260310120000',1),('20260310130000',1),('20260310140000',1),('20260310200001',1),
  ('20260312192401',1),('20260313024713',1),('20260315180000',1),('20260315183000',1),('20260315184000',1),('20260315185000',1),
  ('20260315190000',1),('20260316120000',1),('20260320152407',1),('20260321024500',1),('20260323014000',1),('20260323110000',1),
  ('20260323213152',1),('20260323213525',1),('20260323214202',1),('20260324000000',1),('20260324100000',1),('20260324100001',1),
  ('20260325000000',1),('20260325000001',1),('20260325010000',1),('20260325021000',1),('20260325100000',1),('20260326170000',1),
  ('20260326173000',1),('20260326180000',1),('20260326200000',1),('20260326210000',1),('20260326220000',1),('20260327171000',1),
  ('20260328014500',1),('20260328120000',1),('20260329180000',1),('20260330150000',1),('20260331195900',1),('20260331200000',1),
  ('20260331200100',2),('20260331200200',2),('20260331200300',2),('20260331200400',2),('20260401000000',2),('20260401000100',2),
  ('20260401000200',2),('20260401000300',2),('20260401000400',2),('20260402000000',2),('20260402000001',2),('20260402000002',2),
  ('20260402000003',2),('20260402000004',2),('20260402000005',2),('20260402000006',2),('20260403000000',2),('20260403000001',2),
  ('20260403100000',2),('20260404000000',2),('20260404000001',2),('20260404000002',2),('20260404100000',2),('20260405000000',2),
  ('20260405000001',2),('20260405100000',2),('20260406000000',2),('20260406100000',2),('20260406200000',2),('20260406300000',2),
  ('20260406400000',2),('20260406500000',2),('20260406600000',2),('20260406700000',2),('20260406800000',2),('20260406900000',2),
  ('20260406950000',2),('20260407000000',2),('20260408010000',2),('20260408020000',2),('20260409120000',2),('20260411190000',2),
  ('20260412120000',2),('20260412140000',2),('20260412210000',2),('20260413183000',2),('20260413190000',2),('20260413200000',2),
  ('20260413220000',2),('20260413230000',2),('20260413240000',2),('20260413250000',2),('20260414120000',2),('20260417000000',2),
  ('20260417000001',2),('20260417120000',2),('20260417220000',2),('20260418160000',2),('20260418170000',2),('20260418170001',2),
  ('20260418170002',2),('20260418170003',2),('20260418170004',2),('20260418170005',2),('20260418170006',2),('20260418170007',2),
  ('20260418170010',3),('20260420180000',3),('20260421120000',3),('20260422130000',3),('20260422183000',3),('20260422190000',3),
  ('20260423020622',3),('20260423100000',3),('20260423140000',3),('20260423183000',3),('20260424100000',3),('20260424120000',3),
  ('20260424180000',3),('20260425120000',3),('20260425140000',3),('20260426120000',3),('20260428120000',3),('20260429120000',3),
  ('20260429143000',3),('20260429152000',3),('20260429170000',3),('20260429190000',3),('20260430120000',3),('20260430120100',3),
  ('20260430143000',3),('20260430203000',3),('20260502120000',3),('20260504120000',3),('20260504140000',3),('20260504153000',3),
  ('20260504154000',3),('20260504155500',3),('20260505000000',3),('20260505200000',3),('20260505221000',3),('20260511153600',3),
  ('20260512120000',3),('20260512130000',3),('20260512164000',3),('20260512164500',3),('20260513120000',3),('20260513130000',3),
  ('20260513180000',3),('20260514120000',3),('20260514120100',3),('20260514120200',3),('20260514150000',3),('20260514160000',3),
  ('20260514160100',3),('20260515120000',3),('20260515120100',3),('20260516120000',3),('20260516120001',3),('20260516150000',3),
  ('20260516150100',3),('20260516180000',3),('20260516230000',3),('20260517000000',3),('20260517140000',3),('20260517180000',3),
  ('20260518000000',3),('20260519120000',3),('20260519120001',3),('20260519130000',3),('20260519140000',3),('20260520120000',4),
  ('20260520120001',4),('20260520173115',4),('20260520200000',4),('20260520210000',4),('20260521000000',4),('20260521044133',4),
  ('20260521220000',4),('20260522120000',4),('20260522165000',4),('20260522170000',4),('20260522180000',4),('20260522211500',4),
  ('20260522212000',4),('20260523000000',4),('20260524120000',4),('20260524130000',4),('20260524140000',4),('20260524180000',4),
  ('20260524203157',4),('20260524203211',4),('20260524231933',4),('20260525035417',4),('20260525051519',4),('20260525120000',4),
  ('20260525185146',4),('20260525215122',4),('20260525222642',4),('20260526044944',4),('20260526120000',4),('20260526232518',4),
  ('20260527130000',4),('20260527210617',4),('20260527231858',4),('20260528231010',4),('20260529003210',4),('20260529163148',4),
  ('20260529211013',4),('20260530024229',4),('20260530051039',4),('20260601193140',4),('20260602172141',4),('20260603000536',4),
  ('20260603015807',4),('20260603034943',4),('20260603211123',4),('20260604040346',4),('20260604194202',4),('20260605153745',4),
  ('20260606020638',4),('20260607155544',4),('20260608163256',4),('20260615163119',4),('20260615163246',4),('20260619172143',4),
  ('20260619175346',4),('20260620184619',4),('20260621231958',4),('20260623164242',4),('20260625162731',4),('20260625184050',4),
  ('20260629231658',4),('20260730120000',4),('20260731180000',4),('20260805090000',4);
do $verify$
declare
  v_count bigint; v_nulls bigint; v_dups bigint; v_first text; v_last text;
  v_only_staged bigint; v_only_live bigint;
  v_arch_count bigint; v_arch_nulls bigint; v_name_mismatches bigint;
  v_pcount bigint; v_puniq bigint; v_b1 bigint; v_b2 bigint; v_b3 bigint; v_b4 bigint;
  v_plan_only bigint; v_snap_only bigint;
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

  ---------------------------------------------------------------- planned repair inventory
  select count(*), count(distinct version) into v_pcount, v_puniq from planned_versions;
  if v_pcount <> 262 then raise exception 'planned_versions count % <> 262', v_pcount; end if;
  if v_puniq  <> 262 then raise exception 'planned_versions has duplicate versions (% distinct)', v_puniq; end if;
  select count(*) filter (where batch = 1), count(*) filter (where batch = 2),
         count(*) filter (where batch = 3), count(*) filter (where batch = 4)
    into v_b1, v_b2, v_b3, v_b4 from planned_versions;
  if v_b1 <> 66 or v_b2 <> 66 or v_b3 <> 65 or v_b4 <> 65 then
    raise exception 'batch sizes %/%/%/%  <> 66/66/65/65', v_b1, v_b2, v_b3, v_b4;
  end if;
  if exists (select 1 from planned_versions where batch not between 1 and 4) then
    raise exception 'planned_versions contains an out-of-range batch number';
  end if;

  -- Bidirectional exact-set equality: planned == staged snapshot.
  select count(*) into v_plan_only from (
    select version from planned_versions except select version from snapshot_verify) d;
  select count(*) into v_snap_only from (
    select version from snapshot_verify except select version from planned_versions) d;
  if v_plan_only <> 0 or v_snap_only <> 0 then
    raise exception 'planned/snapshot set mismatch: % planned-only, % snapshot-only',
      v_plan_only, v_snap_only;
  end if;

  -- The baseline must not already be recorded anywhere.
  if exists (select 1 from planned_versions where version = '20260806000000')
     or exists (select 1 from snapshot_verify where version = '20260806000000') then
    raise exception 'baseline 20260806000000 must be absent before S1';
  end if;

  raise notice 'verified: 262 rows, 0/0 full-row diff, 0 name-multiset diff, planned==snapshot, baseline absent';
end
$verify$;

-- Expected checkpoint inventories — written ONLY after every validation above passed.
-- Same ordering and same \copy mechanism as the actual captures, so cmp -s is byte-exact.
\copy (select version from planned_versions order by version)                 to '/Users/chrisgarness/agentflow-operator/expected_start.txt'
\copy (select version from planned_versions where batch > 1 order by version) to '/Users/chrisgarness/agentflow-operator/expected_after_batch_1.txt'
\copy (select version from planned_versions where batch > 2 order by version) to '/Users/chrisgarness/agentflow-operator/expected_after_batch_2.txt'
\copy (select version from planned_versions where batch > 3 order by version) to '/Users/chrisgarness/agentflow-operator/expected_after_batch_3.txt'
\copy (select version from planned_versions where batch > 4 order by version) to '/Users/chrisgarness/agentflow-operator/expected_after_batch_4.txt'
\copy (select '20260806000000')                                               to '/Users/chrisgarness/agentflow-operator/expected_final.txt'

rollback;   -- verification only: temp tables dropped, no database state persisted, live rows untouched
```

Run it (fail-fast; any load, parse, checksum, count, range, uniqueness, planned-inventory, or
comparison failure aborts **before any repair command exists**):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
for f in expected_start expected_after_batch_1 expected_after_batch_2 \
         expected_after_batch_3 expected_after_batch_4 expected_final; do
  require_absent "$OPDIR/$f.txt"
done
require_absent "$OPDIR/verify_snapshot_fidelity.sql.written"
chmod 600 "$OPDIR/verify_snapshot_fidelity.sql"
if [ "$(shasum -a 256 "$OPDIR/verify_snapshot_fidelity.sql" | cut -d' ' -f1)" \
     != "<RESOLVE-BEFORE-S1: VERIFY_SQL_SHA256>" ]; then
  printf 'STOP: verify_snapshot_fidelity.sql does not match the recorded SHA-256 — it is saved by\n' >&2
  printf '      hand, so a truncated paste would otherwise produce only SOME expected files.\n' >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 -f "$OPDIR/verify_snapshot_fidelity.sql" "$OPERATOR_DB_URL"

# Fail-closed: EVERY expected file must exist with EXACTLY the right count. Written as explicit
# per-file checks (never a glob, never an inline `[ "$(wc -l < …)" -ne N ]`, which silently skips
# its STOP branch when the file is absent — see the fail-closed shell rule above).
require_lines "$OPDIR/expected_start.txt"          262
require_lines "$OPDIR/expected_after_batch_1.txt"  196
require_lines "$OPDIR/expected_after_batch_2.txt"  130
require_lines "$OPDIR/expected_after_batch_3.txt"   65
require_lines "$OPDIR/expected_after_batch_4.txt"    0
require_lines "$OPDIR/expected_final.txt"            1
for f in expected_start expected_after_batch_1 expected_after_batch_2 \
         expected_after_batch_3 expected_after_batch_4 expected_final; do
  chmod 600 "$OPDIR/$f.txt"
done
```

### 1d. Pre-S1 fingerprint capture (read-only)

Record in the S1 execution plan, as literals, before S1:

- S1 execution worktree absolute path: `/Users/chrisgarness/agentflow-s1-main`
- Its branch and commit SHA: `<RESOLVE-BEFORE-S1: S1_WORKTREE_COMMIT_SHA>`
- Fingerprint script absolute path:
  `/Users/chrisgarness/agentflow-s1-main/scripts/fingerprint_rollup.sql`
- Its SHA-256: `<RESOLVE-BEFORE-S1: FINGERPRINT_SCRIPT_SHA256>`

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/fingerprint_pre_s1.txt"
require_absent "$OPDIR/fingerprint_pre_s1.txt.sha256"

if [ "$(shasum -a 256 "$S1WT/scripts/fingerprint_rollup.sql" | cut -d' ' -f1)" \
     != "<RESOLVE-BEFORE-S1: FINGERPRINT_SCRIPT_SHA256>" ]; then
  printf 'STOP: fingerprint script SHA-256 does not match the recorded value\n' >&2; exit 1
fi

psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
  -f "$S1WT/scripts/fingerprint_rollup.sql" > "$OPDIR/fingerprint_pre_s1.txt"
chmod 600 "$OPDIR/fingerprint_pre_s1.txt"
shasum -a 256 "$OPDIR/fingerprint_pre_s1.txt" > "$OPDIR/fingerprint_pre_s1.txt.sha256"
chmod 600 "$OPDIR/fingerprint_pre_s1.txt.sha256"
shasum -a 256 -c "$OPDIR/fingerprint_pre_s1.txt.sha256"
```

Both fingerprint scripts emit deterministically ordered output, so byte-identical comparison is a
valid post-S1 criterion. The script path is absolute, so the invocation works from any directory.

### 2. Mark the 262 historical versions reverted — four literal batches, with executable checkpoints

The versions below are **literal strings** identical to the `planned_versions` inventory proven
equal to the validated snapshot in §1c. No variables, no globs, no command substitution, no
archive-derived versions — ever.

Each checkpoint captures the live inventory through the **preverified** `$OPERATOR_DB_URL`, using
the same `\copy … order by version` mechanism that produced the expected files, and compares them
with `cmp -s` (non-printing, so no inventory contents reach the terminal or any log). The
worktree-bound `supabase … migration list --linked` is a required human cross-check; **the ordered
`schema_migrations` query plus the byte-exact file comparison is the binding assertion.**

A **pre-mutation re-check runs immediately before every repair**, so a concurrent change to the recorded **version set** arriving after the previous
checkpoint is caught before this runbook mutates anything further. Scope note (identified by
adversarial review): these checkpoints project to `version` only, so they cannot detect a change
confined to a surviving row's other five columns — see §5 for the three deferred hardening items.

#### Start checkpoint (before any mutation)

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_start.txt"
require_lines      "$OPDIR/actual_start.txt" 262
require_server_count 262          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_start.txt" "$OPDIR/expected_start.txt"; then
  printf 'STOP: start state exact-set mismatch vs expected_start.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_start.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

#### Batch 1/4 — 66 versions (`20240401` .. `20260331200000`)

**Pre-mutation re-check** (freshly recaptured immediately before the repair — detects a concurrent change to the *version set* arriving since the previous checkpoint):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_before_batch_1.txt"
require_lines      "$OPDIR/actual_before_batch_1.txt" 262
require_server_count 262          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_before_batch_1.txt" "$OPDIR/expected_start.txt"; then
  printf 'STOP: pre-batch-1 state exact-set mismatch vs expected_start.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_before_batch_1.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

**Repair** (the interlock re-proves the checkpoint and the project binding before mutating):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
# INTERLOCK — refuse to mutate unless THIS batch's pre-mutation checkpoint actually ran in
# this same prepared shell and still matches. A checkpoint block that exited 1 cannot stop
# an operator from pasting the next block; this guard can.
require_file  "$OPDIR/actual_before_batch_1.txt"
if ! cmp -s "$OPDIR/actual_before_batch_1.txt" "$OPDIR/expected_start.txt"; then
  printf 'STOP: pre-batch-1 checkpoint artifact does not match expected_start.txt\n' >&2; exit 1
fi
require_project_binding
supabase --workdir "$S1WT" migration repair --linked --status reverted \
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
```

**Post-mutation checkpoint** (must equal `expected_after_batch_1.txt`, 196 rows):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_after_batch_1.txt"
require_lines      "$OPDIR/actual_after_batch_1.txt" 196
require_server_count 196          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_after_batch_1.txt" "$OPDIR/expected_after_batch_1.txt"; then
  printf 'STOP: post-batch-1 state exact-set mismatch vs expected_after_batch_1.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_after_batch_1.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

#### Batch 2/4 — 66 versions (`20260331200100` .. `20260418170007`)

**Pre-mutation re-check** (freshly recaptured immediately before the repair — detects a concurrent change to the *version set* arriving since the previous checkpoint):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_before_batch_2.txt"
require_lines      "$OPDIR/actual_before_batch_2.txt" 196
require_server_count 196          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_before_batch_2.txt" "$OPDIR/expected_after_batch_1.txt"; then
  printf 'STOP: pre-batch-2 state exact-set mismatch vs expected_after_batch_1.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_before_batch_2.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

**Repair** (the interlock re-proves the checkpoint and the project binding before mutating):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
# INTERLOCK — refuse to mutate unless THIS batch's pre-mutation checkpoint actually ran in
# this same prepared shell and still matches. A checkpoint block that exited 1 cannot stop
# an operator from pasting the next block; this guard can.
require_file  "$OPDIR/actual_before_batch_2.txt"
if ! cmp -s "$OPDIR/actual_before_batch_2.txt" "$OPDIR/expected_after_batch_1.txt"; then
  printf 'STOP: pre-batch-2 checkpoint artifact does not match expected_after_batch_1.txt\n' >&2; exit 1
fi
require_project_binding
supabase --workdir "$S1WT" migration repair --linked --status reverted \
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
```

**Post-mutation checkpoint** (must equal `expected_after_batch_2.txt`, 130 rows):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_after_batch_2.txt"
require_lines      "$OPDIR/actual_after_batch_2.txt" 130
require_server_count 130          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_after_batch_2.txt" "$OPDIR/expected_after_batch_2.txt"; then
  printf 'STOP: post-batch-2 state exact-set mismatch vs expected_after_batch_2.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_after_batch_2.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

#### Batch 3/4 — 65 versions (`20260418170010` .. `20260519140000`)

**Pre-mutation re-check** (freshly recaptured immediately before the repair — detects a concurrent change to the *version set* arriving since the previous checkpoint):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_before_batch_3.txt"
require_lines      "$OPDIR/actual_before_batch_3.txt" 130
require_server_count 130          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_before_batch_3.txt" "$OPDIR/expected_after_batch_2.txt"; then
  printf 'STOP: pre-batch-3 state exact-set mismatch vs expected_after_batch_2.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_before_batch_3.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

**Repair** (the interlock re-proves the checkpoint and the project binding before mutating):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
# INTERLOCK — refuse to mutate unless THIS batch's pre-mutation checkpoint actually ran in
# this same prepared shell and still matches. A checkpoint block that exited 1 cannot stop
# an operator from pasting the next block; this guard can.
require_file  "$OPDIR/actual_before_batch_3.txt"
if ! cmp -s "$OPDIR/actual_before_batch_3.txt" "$OPDIR/expected_after_batch_2.txt"; then
  printf 'STOP: pre-batch-3 checkpoint artifact does not match expected_after_batch_2.txt\n' >&2; exit 1
fi
require_project_binding
supabase --workdir "$S1WT" migration repair --linked --status reverted \
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
```

**Post-mutation checkpoint** (must equal `expected_after_batch_3.txt`, 65 rows):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_after_batch_3.txt"
require_lines      "$OPDIR/actual_after_batch_3.txt" 65
require_server_count 65          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_after_batch_3.txt" "$OPDIR/expected_after_batch_3.txt"; then
  printf 'STOP: post-batch-3 state exact-set mismatch vs expected_after_batch_3.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_after_batch_3.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

#### Batch 4/4 — 65 versions (`20260520120000` .. `20260805090000`)

**Pre-mutation re-check** (freshly recaptured immediately before the repair — detects a concurrent change to the *version set* arriving since the previous checkpoint):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_before_batch_4.txt"
require_lines      "$OPDIR/actual_before_batch_4.txt" 65
require_server_count 65          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_before_batch_4.txt" "$OPDIR/expected_after_batch_3.txt"; then
  printf 'STOP: pre-batch-4 state exact-set mismatch vs expected_after_batch_3.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_before_batch_4.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

**Repair** (the interlock re-proves the checkpoint and the project binding before mutating):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
# INTERLOCK — refuse to mutate unless THIS batch's pre-mutation checkpoint actually ran in
# this same prepared shell and still matches. A checkpoint block that exited 1 cannot stop
# an operator from pasting the next block; this guard can.
require_file  "$OPDIR/actual_before_batch_4.txt"
if ! cmp -s "$OPDIR/actual_before_batch_4.txt" "$OPDIR/expected_after_batch_3.txt"; then
  printf 'STOP: pre-batch-4 checkpoint artifact does not match expected_after_batch_3.txt\n' >&2; exit 1
fi
require_project_binding
supabase --workdir "$S1WT" migration repair --linked --status reverted \
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
```

**Post-mutation checkpoint** (must equal `expected_after_batch_4.txt`, 0 rows):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_after_batch_4.txt"
require_lines      "$OPDIR/actual_after_batch_4.txt" 0
require_server_count 0          # independent corroboration: a failed or truncated
                                      # capture cannot masquerade as a valid inventory
if ! cmp -s "$OPDIR/actual_after_batch_4.txt" "$OPDIR/expected_after_batch_4.txt"; then
  printf 'STOP: post-batch-4 state exact-set mismatch vs expected_after_batch_4.txt\n' >&2; exit 1
fi
require_baseline_absent "$OPDIR/actual_after_batch_4.txt"
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

### 3. Mark the baseline applied — only after the executable batch-4 checkpoint proves the table empty

**Pre-mutation re-check** (the history table must still be empty; `require_server_count 0` is an
independent corroboration, so a failed or truncated capture cannot masquerade as a legitimately
empty inventory — the one checkpoint whose pass condition is an empty file):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_before_baseline.txt"
require_lines     "$OPDIR/actual_before_baseline.txt" 0
require_server_count 0
if ! cmp -s "$OPDIR/actual_before_baseline.txt" "$OPDIR/expected_after_batch_4.txt"; then
  printf 'STOP: pre-baseline state is not the empty expected_after_batch_4 inventory\n' >&2; exit 1
fi
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

**Apply** (the interlock re-proves the checkpoint and the project binding before mutating):

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_file "$OPDIR/actual_before_baseline.txt"
if ! cmp -s "$OPDIR/actual_before_baseline.txt" "$OPDIR/expected_after_batch_4.txt"; then
  printf 'STOP: pre-baseline checkpoint artifact does not match expected_after_batch_4\n' >&2; exit 1
fi
require_server_count 0
require_project_binding
supabase --workdir "$S1WT" migration repair --linked --status applied 20260806000000
```

**Final checkpoint:**

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
capture_inventory "$OPDIR/actual_final.txt"
require_lines     "$OPDIR/actual_final.txt" 1
require_server_count 1
if ! cmp -s "$OPDIR/actual_final.txt" "$OPDIR/expected_final.txt"; then
  printf 'STOP: final inventory does not equal the baseline-only expected inventory\n' >&2; exit 1
fi
if [ "$(cat "$OPDIR/actual_final.txt")" != "20260806000000" ]; then
  printf 'STOP: the single remaining row is not 20260806000000\n' >&2; exit 1
fi
supabase --workdir "$S1WT" migration list --linked   # required human cross-check
```

### 4. Verify (all mandatory)

1. `supabase --workdir /Users/chrisgarness/agentflow-s1-main migration list --linked` **from the
   corrected-main S1 worktree** → LOCAL and REMOTE both show exactly `20260806000000` (M1–M3 are
   absent from this worktree by construction; the remote list itself proves they are unapplied to
   production).
2. `select count(*), min(version) from supabase_migrations.schema_migrations` → `1 | 20260806000000`
   (already asserted byte-exactly by the final checkpoint above).
3. Post-S1 fingerprint with the IDENTICAL invocation of §1d:

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/fingerprint_post_s1.txt"
require_absent "$OPDIR/fingerprint_post_s1.txt.sha256"

psql -X -At -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" \
  -f "$S1WT/scripts/fingerprint_rollup.sql" > "$OPDIR/fingerprint_post_s1.txt"
chmod 600 "$OPDIR/fingerprint_post_s1.txt"
shasum -a 256 "$OPDIR/fingerprint_post_s1.txt" > "$OPDIR/fingerprint_post_s1.txt.sha256"
chmod 600 "$OPDIR/fingerprint_post_s1.txt.sha256"
shasum -a 256 -c "$OPDIR/fingerprint_pre_s1.txt.sha256"
shasum -a 256 -c "$OPDIR/fingerprint_post_s1.txt.sha256"
if ! cmp -s "$OPDIR/fingerprint_pre_s1.txt" "$OPDIR/fingerprint_post_s1.txt"; then
  printf 'STOP: production schema fingerprint changed across S1 — investigate immediately\n' >&2; exit 1
fi
```

Any fingerprint difference whatsoever is a hard stop and an immediate investigation trigger —
reconciliation touches no schema.

## Failure recovery (partial completion)

Each version's repair is independent and idempotent: diff the captured `actual_*` inventories
against the expected files to identify exactly which operations completed. Re-issuing a missing
`--status reverted` for a still-present historical version is safe to repeat; the baseline
`--status applied` is likewise idempotent. No migration SQL ran at any point — only tracking-table
row edits.

**Recovery is described here but is NEVER automatic, and never attempted in the same sitting
without direction.** After any unexpected production failure the operator: stops immediately;
**preserves every artifact** (the artifact-preservation rule means a resumed attempt cannot
overwrite the prior evidence — it will hard-stop instead, which is intended); reports the exact
failing command, its exit status, and the relevant checkpoint files; and awaits Chris's separate
direction. Do not "repair the repair".

## Inverse — two distinct restorations (never without separate approval)

**A. Version-presence restoration (CLI, approximate).**
`supabase --workdir /Users/chrisgarness/agentflow-s1-main migration repair --linked --status
reverted 20260806000000`, followed by `supabase --workdir /Users/chrisgarness/agentflow-s1-main
migration repair --linked --status applied <the same 262 literal versions, in the same four
batches, copied verbatim from §2 — never abbreviated, never generated>`, restores which versions
are *recorded as applied*. **This is NOT claimed to reproduce the original rows exactly** — `repair
--status applied` inserts rows the CLI constructs (v2.84.5 behavior for `name`/`statements` content
has not been demonstrated against a disposable database, and this runbook makes no assumption about
it). Use A only when version-presence is all that matters (e.g. immediately unblocking a push).

**B. Exact row restoration (from the secure snapshot; the true inverse).**
Failure-safe by construction: the snapshot is checksum-verified immediately before use, staged and
validated in a session-local temporary table **before** any live row is deleted, and the whole
replacement runs in one fail-fast transaction — any checksum, file, parse, validation, DELETE, or
INSERT failure aborts and leaves the original metadata rows intact. (`\copy` reads a client-side
file; without these safeguards a missing or malformed file could otherwise let psql continue past
the failed COPY and commit an emptied history table.)

**B-1. Re-verify the snapshot checksum recorded at S1 (abort on any mismatch).** The checksum
record stores the artifact's absolute path, so this works from any directory:

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
shasum -a 256 -c "$OPDIR/schema_migrations_full_snapshot.csv.sha256"
# Proceed ONLY on: /Users/chrisgarness/agentflow-operator/schema_migrations_full_snapshot.csv: OK
```

**B-2. Save verbatim as `/Users/chrisgarness/agentflow-operator/restore_schema_migrations.sql`,
mode 600** (absolute snapshot path; outside the Git repository):

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

**B-3. Run non-interactively, fail-fast, from any directory:**

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_file "$OPDIR/restore_schema_migrations.sql"
chmod 600 "$OPDIR/restore_schema_migrations.sql"
psql -X -v ON_ERROR_STOP=1 -f "$OPDIR/restore_schema_migrations.sql" "$OPERATOR_DB_URL"
```

Post-restore verification (all mandatory):
1. **Re-export with the IDENTICAL ordered query from step 1b** and require **byte-for-byte
   equality** with the pre-S1 export:

```bash
set -euo pipefail; set +x; umask 077
. /Users/chrisgarness/agentflow-operator/s1_helpers.sh
require_absent "$OPDIR/schema_migrations_full_snapshot_post_restore.csv"
psql -X -v ON_ERROR_STOP=1 "$OPERATOR_DB_URL" -c \
 "\copy (select version, statements, name, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations order by version) to '$OPDIR/schema_migrations_full_snapshot_post_restore.csv' with (format csv, header true)"
require_file "$OPDIR/schema_migrations_full_snapshot_post_restore.csv"
chmod 600 "$OPDIR/schema_migrations_full_snapshot_post_restore.csv"
if ! cmp -s "$OPDIR/schema_migrations_full_snapshot_post_restore.csv" \
            "$OPDIR/schema_migrations_full_snapshot.csv"; then
  printf 'STOP: post-restore export is not byte-identical to the pre-S1 snapshot\n' >&2; exit 1
fi
shasum -a 256 "$OPDIR/schema_migrations_full_snapshot_post_restore.csv" \
              "$OPDIR/schema_migrations_full_snapshot.csv"   # the two hashes must be equal
```

   Equal hashes verify EVERY column — `statements` (full array
   contents), `name`, `created_by`, `idempotency_key`, `rollback` — including NULL values and array
   contents. (This is where byte-identical CSV serialization is proven; §1c's `EXCEPT ALL` proves
   parsed row equivalence.)
2. Row count 262 · version list identical · `supabase --workdir /Users/chrisgarness/agentflow-s1-main
   migration list --linked` matches the pre-S1 state.
3. Schema fingerprint (identical invocation of §1d) unchanged.

Restoration B changes only `supabase_migrations.schema_migrations` rows; no application DDL or
application-data DML executes. **Executing inverse A or inverse B requires Chris's separate
explicit approval; neither is part of S1.**

## 5. Identified by adversarial review, deliberately NOT implemented (Chris's ruling required)

Three hardening items were surfaced by the adversarial review of this runbook. Each extends the
design Chris approved, so none is implemented here; all are recorded so the gap is explicit rather
than silent.

1. **Checkpoints project to `version` only.** Every checkpoint capture is
   `select version … order by version`. A concurrent change confined to a surviving row's other
   five columns (`statements`, `name`, `created_by`, `idempotency_key`, `rollback`) preserves the
   version set and would pass every checkpoint. The six-column full-row proof runs exactly once,
   pre-mutation, in §1c. Closing this would mean re-running the §1c-style six-column comparison at
   each checkpoint against the validated snapshot's surviving subset.
2. **The row `migration repair --status applied` writes is never inspected.** §4 asserts the
   baseline row's presence and version but never what the CLI put in `statements`/`name`/
   `created_by` — even though inverse A explicitly records that v2.84.5's row construction is
   undemonstrated.
3. **The six expected inventories have no integrity record.** The snapshot and both fingerprints
   are checksummed and re-verified; the expected files — the binding comparison target for every
   checkpoint — are not.

Note the asymmetry these leave: inverse B's post-restoration verification proves strictly more
(byte-exact six-column equality) than the forward S1 path it recovers from.

---

## Related one-off record (NOT part of this runbook's procedure)

The approved emergency ACL hotfix of 2026-08-09 (`REVOKE ALL ON FUNCTION
public.wipe_organization_operational_data(uuid) FROM PUBLIC, anon, authenticated;`) was executed
directly with **no** migration-history row, by design. Its documented inverse — requiring separate
approval, and deliberately **excluding PUBLIC**, which had no EXECUTE before the hotfix — is:

```sql
GRANT EXECUTE ON FUNCTION public.wipe_organization_operational_data(uuid) TO anon, authenticated;
```
