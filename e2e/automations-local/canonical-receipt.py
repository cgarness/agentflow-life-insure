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
  'row_script_sha256','{row_source}',
  'rollup_script_sha256','{rollup_source}',
  'rows_sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY line COLLATE "C" NULLS FIRST),''),'UTF8')),'hex') FROM row_hashes),
  'rollup_sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY kind COLLATE "C"),''),'UTF8')),'hex') FROM rollup_hashes),
  'bucket_sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(digest,'' ORDER BY kind COLLATE "C"),''),'UTF8')),'hex') FROM rollup_hashes WHERE kind='bucket')
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
    if not isinstance(value, dict) or set(value) != KEYS or not all(
        isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest) for digest in value.values()
    ):
        raise SystemExit("Invalid canonical receipt fields")
    return value


def check(paths):
    expected = read_receipt(paths[0])
    for path in paths[1:]:
        actual = read_receipt(path)
        changed = sorted(key for key in KEYS if actual[key] != expected[key])
        if changed:
            raise SystemExit("Repository catalog equivalence failed for " + ", ".join(changed))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("query")
    buckets = sub.add_parser("buckets")
    buckets.add_argument("--reviewed-config", type=Path)
    compare = sub.add_parser("check")
    compare.add_argument("receipts", nargs="+", type=Path)
    args = parser.parse_args()
    if args.action == "query":
        print(hash_sql())
    elif args.action == "buckets":
        print(approved_config_sql(args.reviewed_config) if args.reviewed_config else bucket_sql())
    elif len(args.receipts) >= 2:
        check(args.receipts)
    else:
        parser.error("check needs an independent receipt and at least one comparison")
