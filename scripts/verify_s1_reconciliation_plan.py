#!/usr/bin/env python3
"""
STATIC verification of the S1 baseline-history reconciliation plan.

Reads supabase/rollback/20260806_baseline_history_reconciliation_runbook.md and proves, WITHOUT
any database connection, that the plan cannot destroy an applied migration.

Production truth this file pins (measured read-only 2026-08-25, fingerprint
f3c62cf0842b92730f9a8ba63d5db1fa over the comma-joined ordered version list):

    272 history rows = 262 pre-baseline (20240401 .. 20260805090000)
                     + 10 post-baseline that are ALREADY APPLIED and MUST SURVIVE

S1 reverts ONLY the 262 pre-baseline versions, then marks 20260806000000 applied.
The correct end state is 11 rows -- the baseline plus the ten. NOT one row.

Any count or set mismatch exits non-zero, so the mismatch is caught in CI / at the desk,
long before an operator reaches a production write.

Usage:  python3 scripts/verify_s1_reconciliation_plan.py [path/to/runbook.md]
Exit:   0 = plan is internally consistent and safe;  1 = violation (details on stderr)
"""

import re
import sys
from pathlib import Path

# --- Canonical constants. These are the contract; do not relax them to make a check pass. ---
TOTAL_ROWS = 272
PRE_BASELINE = 262
BASELINE = "20260806000000"
PRE_BASELINE_CEILING = "20260805090000"
BATCH_SIZES = [66, 66, 65, 65]
LADDER = [272, 206, 140, 75, 10, 11]  # start -> b1 -> b2 -> b3 -> b4 -> final

PRESERVED = [
    "20260811200920", "20260811201250", "20260811201401", "20260812042319",
    "20260819163413", "20260820233402", "20260823203257", "20260823222528",
    "20260823222805", "20260823222926",
]

DEFAULT_RUNBOOK = "supabase/rollback/20260806_baseline_history_reconciliation_runbook.md"

# Wording that encodes the superseded "history ends at one row" model.
BANNED_PHRASES = [
    "the single remaining row",
    "exactly one version, `20260806000000`",
    "baseline-only expected inventory",
    "proves the table empty",
    "262/196/130/65/0/1",
]

failures = []
notes = []


def check(condition, message):
    if condition:
        notes.append(f"  ok    {message}")
    else:
        failures.append(message)


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_RUNBOOK)
    if not path.is_file():
        print(f"STOP: runbook not found at {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")

    # ---------------------------------------------------------------- 1. revert list (planned)
    m = re.search(
        r"insert into planned_versions \(version, batch\) values\s*(.*?);",
        text, re.S,
    )
    if not m:
        print("STOP: could not locate the literal planned_versions insert block", file=sys.stderr)
        return 1
    planned_block = m.group(1)
    planned = re.findall(r"\('(\d+)',\s*(\d)\)", planned_block)
    planned_versions = [v for v, _ in planned]

    check(len(planned_versions) == PRE_BASELINE,
          f"revert list holds exactly {PRE_BASELINE} entries (found {len(planned_versions)})")
    check(len(set(planned_versions)) == PRE_BASELINE,
          f"revert list holds {PRE_BASELINE} UNIQUE versions (found {len(set(planned_versions))})")

    sizes = [sum(1 for _, b in planned if int(b) == i) for i in (1, 2, 3, 4)]
    check(sizes == BATCH_SIZES, f"batch sizes are {BATCH_SIZES} (found {sizes})")

    check(all(v <= PRE_BASELINE_CEILING for v in planned_versions),
          f"every revert target is pre-baseline (<= {PRE_BASELINE_CEILING})")

    # The catastrophic edit: populating the allowlist from the live table instead of literals.
    check(not re.search(r"insert\s+into\s+planned_versions\b(?!\s*\(version,\s*batch\)\s*values)",
                        text, re.I),
          "revert list is populated ONLY from hard-typed literals, never from a query")
    check(not re.search(r"\bselect\b", planned_block, re.I),
          "no INSERT ... SELECT populates the revert list (would sweep in applied migrations)")

    # ---------------------------------------------------------------- 2. preserved set
    m = re.search(r"insert into preserved_versions \(version\) values\s*(.*?);", text, re.S)
    if not m:
        print("STOP: runbook declares no preserved_versions table -- the ten applied "
              "post-baseline migrations are unprotected", file=sys.stderr)
        return 1
    preserved_versions = re.findall(r"'(\d+)'", m.group(1))

    check(preserved_versions == PRESERVED,
          f"preserved set is exactly the ten expected versions (found {len(preserved_versions)})")
    check(len(set(preserved_versions)) == 10, "preserved set holds 10 unique versions")
    check(all(v > BASELINE for v in preserved_versions),
          "every preserved version sorts after the baseline")

    # ---------------------------------------------------------------- 3. THE SAFETY PROPERTY
    overlap = sorted(set(planned_versions) & set(preserved_versions))
    check(not overlap,
          f"NO preserved version appears in the revert list (overlap: {overlap or 'none'})")

    # ---------------------------------------------------------------- 4. repair commands
    reverted = []
    for cmd in re.finditer(r"migration repair --linked --status reverted((?:.*\\\n)*.*)", text):
        reverted += re.findall(r"\b(\d{8,14})\b", cmd.group(1))
    reverted_set = set(reverted)
    # inverse A legitimately names the baseline alone; exclude it from the batch comparison.
    reverted_set.discard(BASELINE)

    check(reverted_set == set(planned_versions),
          "the reverted-status commands name EXACTLY the planned revert list "
          f"(commands={len(reverted_set)}, planned={len(set(planned_versions))})")
    bad = sorted(reverted_set & set(preserved_versions))
    check(not bad, f"no reverted-status command names a preserved version (found: {bad or 'none'})")

    applied = set()
    for cmd in re.finditer(r"migration repair --linked --status applied((?:.*\\\n)*.*)", text):
        applied |= set(re.findall(r"\b(\d{8,14})\b", cmd.group(1)))
    check(not (applied & set(preserved_versions)),
          "no applied-status command re-applies a preserved version")
    check(BASELINE in applied, f"the baseline {BASELINE} is marked applied")

    # ---------------------------------------------------------------- 5. checkpoint ladder
    expected_files = re.findall(
        r'require_lines "\$OPDIR/expected_(?:start|after_batch_\d|final)\.txt"\s+(\d+)', text)
    check([int(x) for x in expected_files] == LADDER,
          f"expected-inventory ladder is {LADDER} (found {expected_files})")

    # arithmetic must actually close
    walk = [TOTAL_ROWS]
    for size in BATCH_SIZES:
        walk.append(walk[-1] - size)
    walk.append(walk[-1] + 1)  # + baseline
    check(walk == LADDER, f"ladder arithmetic closes: {walk} == {LADDER}")
    check(walk[-2] == 10, "after the last revert batch, exactly the ten preserved rows remain")
    check(walk[-1] == 11, "final history is exactly 11 rows (baseline + the ten)")

    # ---------------------------------------------------------------- 6. superseded wording
    for phrase in BANNED_PHRASES:
        check(phrase not in text,
              f"no superseded one-row wording: {phrase!r}")

    # ---------------------------------------------------------------- report
    print(f"S1 reconciliation plan -- static verification of {path}")
    print("\n".join(notes))
    if failures:
        print(f"\nFAILED ({len(failures)}):", file=sys.stderr)
        for f in failures:
            print(f"  STOP: {f}", file=sys.stderr)
        return 1
    print(f"\nALL {len(notes)} CHECKS PASSED -- revert list is {PRE_BASELINE} pre-baseline "
          f"versions, the ten applied post-baseline versions are protected, "
          f"final history is {LADDER[-1]} rows.")
    return 0


def selftest() -> int:
    """Prove the checks actually fire. A verifier that cannot fail is worthless.

    Each case mutates the real runbook text the way a hurried operator might "fix" a failing
    guard, and asserts this script rejects it.
    """
    path = Path(DEFAULT_RUNBOOK)
    original = path.read_text(encoding="utf-8")
    ten_literals = ("  ('20260811200920'),('20260811201250'),('20260811201401'),"
                    "('20260812042319'),('20260819163413'),\n"
                    "  ('20260820233402'),('20260823203257'),('20260823222528'),"
                    "('20260823222805'),('20260823222926');")

    cases = [
        ("sweep a preserved version into the revert list",
         lambda t: t.replace("insert into planned_versions (version, batch) values\n",
                             "insert into planned_versions (version, batch) values\n"
                             "  ('20260823222926',1),\n", 1)),
        ("replace the literal allowlist with a live query",
         lambda t: re.sub(r"insert into planned_versions \(version, batch\) values\s*.*?;",
                          "insert into planned_versions (version, batch) "
                          "select version, 1 from supabase_migrations.schema_migrations;",
                          t, count=1, flags=re.S)),
        ("drop a preserved version from the protected set",
         lambda t: t.replace(ten_literals, ten_literals.replace(",('20260823222926')", ""), 1)),
        ("revert the whole table to one row (restore the old ladder)",
         lambda t: t.replace('require_lines "$OPDIR/expected_final.txt"            11',
                             'require_lines "$OPDIR/expected_final.txt"            1', 1)),
        ("reintroduce the superseded one-row assertion",
         lambda t: t + "\nif [ x != y ]; then printf 'STOP: the single remaining row is not ok\\n'; fi\n"),
    ]

    tmp = path.with_suffix(".selftest.tmp")
    passed = 0
    try:
        for name, mutate in cases:
            mutated = mutate(original)
            if mutated == original:
                print(f"  SELFTEST INCONCLUSIVE (mutation was a no-op): {name}", file=sys.stderr)
                return 1
            tmp.write_text(mutated, encoding="utf-8")
            global failures, notes
            failures, notes = [], []
            rc = main.__wrapped__(tmp) if hasattr(main, "__wrapped__") else _run(tmp)
            if rc == 0:
                print(f"  SELFTEST FAILED — script accepted a bad plan: {name}", file=sys.stderr)
                return 1
            print(f"  ok    rejected: {name}")
            passed += 1
    finally:
        if tmp.exists():
            tmp.unlink()
    print(f"\nSELFTEST PASSED — all {passed} dangerous mutations were rejected.")
    return 0


def _run(path: Path) -> int:
    argv = sys.argv
    sys.argv = [argv[0], str(path)]
    try:
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            return main()
    finally:
        sys.argv = argv


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.argv = [a for a in sys.argv if a != "--selftest"]
        print("S1 plan verifier — self-test (each case must be REJECTED)")
        sys.exit(selftest())
    sys.exit(main())
