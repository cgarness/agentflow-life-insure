#!/usr/bin/env python3
"""Generate a hash-only wrapper for the repository fingerprints and verify its three receipts."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROW_SCRIPT = ROOT / "scripts/fingerprint.sql"
ROLLUP_SCRIPT = ROOT / "scripts/fingerprint_rollup.sql"
KEYS = {"row_script_sha256", "rollup_script_sha256", "rows_sha256", "rollup_sha256", "bucket_sha256"}
# Row kinds a dump and restore can store differently without changing them: their detail hashes an expression
# PostgreSQL stores parsed (parsed again on restore, which can flatten AND and OR chains), or a raw privilege array
# (rebuilt from GRANT statements on restore, which can store the same entries in another order). A restored copy must
# match their row counts exactly; their content is compared through the schema fingerprint (receipts.py restored),
# which sorts privileges and compares functions, privileges and every other family exactly, and the expression families
# on PostgreSQL's precedence-aware printing, so a regrouped condition still fails. Every other kind must match exactly.
RESTORE_SENSITIVE_KINDS = {"column", "constraint", "index", "policy", "trigger", "function", "view", "type",
                           "grants", "sequence", "colacl", "defacl"}


def embed_query(path):
    raw = path.read_bytes()
    statement = raw.decode("utf-8").rstrip()
    if not statement.endswith(";"):
        raise SystemExit(f"Missing terminating semicolon in {path.name}")
    return statement[:-1], hashlib.sha256(raw).hexdigest()


def hash_sql():
    rows, row_source = embed_query(ROW_SCRIPT)
    rollup, rollup_source = embed_query(ROLLUP_SCRIPT)
    # Nested queries preserve the canonical expressions. Only the outer statement
    # serializes rows. A separate digest identifies bucket-configuration drift.
    return f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='250ms';
SET LOCAL search_path=public,pg_catalog;
WITH canonical_rows AS MATERIALIZED (
{rows}
), canonical_rollup AS MATERIALIZED (
{rollup}
), row_hashes AS (
  SELECT line,encode(sha256(convert_to(jsonb_build_array(line)::text,'UTF8')),'hex') digest
  FROM canonical_rows
), rollup_hashes AS (
  SELECT kind,encode(sha256(convert_to(jsonb_build_array(kind,n,fp_md5)::text,'UTF8')),'hex') digest
  FROM canonical_rollup
)
SELECT jsonb_build_object(
  'captured_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'client',jsonb_build_object('application_name',current_setting('application_name'),'session_user',session_user::text),
  'row_script_sha256','{row_source}',
  'rollup_script_sha256','{rollup_source}',
  'rows_sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY line COLLATE "C" NULLS FIRST),''),'UTF8')),'hex') FROM row_hashes),
  'rollup_sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY kind COLLATE "C"),''),'UTF8')),'hex') FROM rollup_hashes),
  'bucket_sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY kind COLLATE "C"),''),'UTF8')),'hex') FROM rollup_hashes WHERE kind='bucket'),
  'kinds',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'rows',n,'sha256',digest) ORDER BY kind COLLATE "C"),'[]'::jsonb) FROM (
    SELECT split_part(line,'|',1) AS kind,count(*) AS n,
      encode(sha256(convert_to(string_agg(digest,'' ORDER BY line COLLATE "C" NULLS FIRST),'UTF8')),'hex') AS digest
    FROM row_hashes GROUP BY 1) per_kind)
) AS canonical_receipt;
COMMIT;"""


def bucket_sql():
    sources = [
        ("20260806000000_baseline_production_schema.sql", "-- ===== APPENDIX B:"),
        ("20260915053646_inbound_voicemails.sql", "-- ── 3. Private storage bucket"),
    ]
    inserts = []
    for name, section in sources:
        sql = (ROOT / "supabase/migrations" / name).read_text()
        offset = sql.index(section)
        match = re.search(
            r"INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)"
            r"\s+VALUES\s+[^;]+?ON CONFLICT \(id\) DO NOTHING;",
            sql[offset:], re.DOTALL,
        )
        if not match:
            raise SystemExit(f"Review bucket configuration in {name}")
        inserts.append(match[0])
    return "BEGIN;\n" + "\n".join(inserts) + "\nCOMMIT;"


def approved_config_sql(path):
    # Accept only configuration metadata. Never execute SQL supplied with an archive.
    if path.is_symlink() or not path.is_file():
        raise SystemExit("Missing regular, reviewed bucket configuration")
    try:
        buckets = json.loads(path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise SystemExit("Invalid bucket configuration file")
    fields = {"id", "public", "file_size_limit", "allowed_mime_types"}
    if not isinstance(buckets, list) or not buckets:
        raise SystemExit("A reviewed bucket configuration list is required")
    ids = set()
    for bucket in buckets:
        if not isinstance(bucket, dict) or set(bucket) != fields:
            raise SystemExit("Unexpected bucket configuration fields")
        key, limit, mimes = bucket["id"], bucket["file_size_limit"], bucket["allowed_mime_types"]
        if not isinstance(key, str) or not key or key in ids or not isinstance(bucket["public"], bool):
            raise SystemExit("Invalid bucket identifier or visibility")
        if limit is not None and (type(limit) is not int or limit < 0):
            raise SystemExit("Invalid bucket size limit")
        if mimes is not None and (not isinstance(mimes, list) or any(not isinstance(m, str) for m in mimes)):
            raise SystemExit("Invalid allowed MIME types")
        ids.add(key)
    literal = json.dumps(buckets).replace("'", "''")
    return f"""BEGIN;
SET LOCAL standard_conforming_strings=on;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
SELECT id,id,public,file_size_limit,allowed_mime_types
FROM jsonb_to_recordset('{literal}'::jsonb) AS cfg(id text,public boolean,file_size_limit bigint,allowed_mime_types text[])
ON CONFLICT(id) DO NOTHING;
COMMIT;"""


def read_receipt(path):
    if not path.is_file() or path.is_symlink():
        raise SystemExit("Missing regular canonical receipt")
    try:
        value = json.loads(path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise SystemExit("Invalid canonical receipt file")
    # A reading carries the time it was taken, the connection that took it, and per-kind digests; only the digests are
    # compared.
    if not isinstance(value, dict) or set(value) - {"captured_at", "kinds", "client"} != KEYS or not all(
        isinstance(value[key], str) and re.fullmatch(r"[a-f0-9]{64}", value[key]) for key in KEYS
    ):
        raise SystemExit("Invalid canonical receipt fields")
    kinds = value.get("kinds", [])
    if not isinstance(kinds, list) or not all(
        isinstance(row, dict) and set(row) == {"kind", "rows", "sha256"} and isinstance(row["kind"], str)
        and type(row["rows"]) is int and isinstance(row["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
        for row in kinds
    ):
        raise SystemExit("Invalid canonical receipt kinds")
    return value


def check(paths):
    expected = read_receipt(paths[0])
    for path in paths[1:]:
        actual = read_receipt(path)
        changed = sorted(key for key in KEYS if actual[key] != expected[key])
        if "kinds" in expected and "kinds" in actual and expected["kinds"] != actual["kinds"]:
            changed.append("kinds")
        if changed:
            raise SystemExit("Repository catalog equivalence failed for " + ", ".join(changed))


def check_restored(expected_path, actual_path):
    """A dump and restore of the receipt's source: every kind's row count and every kind without stored expressions
    must match exactly, with the bucket digest and both script digests. Expression kinds are named when they differ."""
    expected, actual = read_receipt(expected_path), read_receipt(actual_path)
    if "kinds" not in expected or "kinds" not in actual:
        raise SystemExit("A restored copy is compared on per-kind digests; capture the receipt with the current query")
    exact = [key for key in ("row_script_sha256", "rollup_script_sha256", "bucket_sha256") if actual[key] != expected[key]]
    if exact:
        raise SystemExit("Repository catalog equivalence failed for " + ", ".join(exact))
    want = {row["kind"]: row for row in expected["kinds"]}
    have = {row["kind"]: row for row in actual["kinds"]}
    changed = sorted(kind for kind in want.keys() | have.keys() if kind not in want or kind not in have
                     or want[kind]["rows"] != have[kind]["rows"]
                     or (kind not in RESTORE_SENSITIVE_KINDS and want[kind]["sha256"] != have[kind]["sha256"]))
    if changed:
        raise SystemExit("Repository catalog equivalence failed for kinds: " + ", ".join(changed))
    reparsed = sorted(kind for kind in want if want[kind]["sha256"] != have[kind]["sha256"])
    if not reparsed and (actual["rows_sha256"] != expected["rows_sha256"] or actual["rollup_sha256"] != expected["rollup_sha256"]):
        raise SystemExit("Repository catalog equivalence failed for rows_sha256, rollup_sha256")
    note = (" Restoring stored these kinds differently: " + ", ".join(reparsed)
            + "; the schema fingerprint compares their content with privileges sorted, on PostgreSQL's "
            "precedence-aware printing.") if reparsed else ""
    print(f"Repository catalog matches the receipt in all {len(want)} kinds.{note}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("query")
    buckets = sub.add_parser("buckets")
    buckets.add_argument("--reviewed-config", type=Path)
    compare = sub.add_parser("check")
    compare.add_argument("receipts", nargs="+", type=Path)
    restored = sub.add_parser("restored")
    restored.add_argument("receipt", type=Path)
    restored.add_argument("copy", type=Path)
    args = parser.parse_args()
    if args.action == "query":
        print(hash_sql())
    elif args.action == "buckets":
        print(approved_config_sql(args.reviewed_config) if args.reviewed_config else bucket_sql())
    elif args.action == "restored":
        check_restored(args.receipt, args.copy)
    elif len(args.receipts) >= 2:
        check(args.receipts)
    else:
        parser.error("check needs an independent receipt and at least one comparison")
