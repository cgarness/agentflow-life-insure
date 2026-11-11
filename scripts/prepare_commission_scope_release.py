#!/usr/bin/env python3
"""Prepare exact, atomic SQL Editor apply/rollback packages. This script never connects to a database.

First build: --postimages <native catalog JSON>. Later regeneration can use the emitted manifest;
source-definition hashes refuse stale catalog evidence after function edits. Execute only with separate
approval, through a project-bound SQL Editor/tool after verifying TARGET_PROJECT externally.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION = "20261111015438"
NAME = "policy_commission_scoped_reads"
TARGET_PROJECT = "jncvvsvckxhqgqvkppmj"
SOURCE = ROOT / f"supabase/migrations/{VERSION}_{NAME}.sql"
RECOVERY = ROOT / f"supabase/migrations/rollback/{VERSION}_{NAME}.sql"
OUT = ROOT / "docs/plans/2026-11-08-team-commissions/release"
OLD = {f"public.get_my_commission_{name}" for name in (
    "overview", "installments", "receipts", "policies", "breakdown", "policy_list", "receipt_list"
)} | {"public.get_my_policy_commission", "policy_commission_reporting.policies", "policy_commission_reporting.installments"}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def function_pins(native: list[dict], sql: str) -> list[dict]:
    selected = []
    for row in native:
        row = dict(row)
        if "." not in row["signature"].split("(")[0]:
            row["signature"] = "public." + row["signature"]
        name = row["signature"].split("(")[0]
        if name not in OLD and not name.startswith(("policy_commission_scoped.", "public.get_scoped_")) and name != "public.get_commission_agent_scope":
            continue
        match = re.search(r"CREATE (?:OR REPLACE )?FUNCTION " + re.escape(name) + r"\(.*?AS \$function\$(.*?)\$function\$", sql, re.S)
        if not match:
            raise ValueError(f"Missing reviewed function: {name}")
        body_hash = digest(match.group(1).encode())
        definition_hash = digest(match.group(0).encode())
        header = match.group(0).split("AS $function$")[0]
        declared_config = []
        for setting in re.finditer(r"\bSET\s+(\w+)\s+(?:TO|=)\s*(.*?)(?=\bSET\b|$)", header, re.S | re.I):
            key, value = setting.group(1).lower(), setting.group(2).strip()
            value = ", ".join(part.strip().strip("'") for part in value.split(","))
            declared_config.append(f"{key}={value}")
        args = header.split(name + "(", 1)[1].split(")", 1)[0]
        declared_types = [re.split(r"\s+DEFAULT\s+", arg.strip(), flags=re.I)[0].split(" ", 1)[1].strip()
                          for arg in args.split(",") if arg.strip()]
        declared_signature = name + "(" + ",".join(declared_types) + ")"
        if (declared_signature.replace(" ", "") != row["signature"].replace(" ", "")
                or declared_config != row["proconfig"]
                or not re.search(r"\bSTABLE\b", header)
                or re.search(r"\bSECURITY\s+DEFINER\b", header)
                or row["provolatile"] != "s" or row["prosecdef"]):
            raise ValueError(f"Native signature/security/config evidence is stale: {name}")
        if "definition" in row:
            def declared_shape(value: str) -> str:
                result = re.search(r"\bRETURNS\s+(.*?)\bLANGUAGE\s+(\w+)", value, re.S | re.I)
                if not result:
                    raise ValueError(f"Missing function return/language declaration: {name}")
                return re.sub(r"\s+", "", result.group(1) + ":" + result.group(2)).lower()
            if declared_shape(header) != declared_shape(row["definition"].split("AS $function$")[0]):
                raise ValueError(f"Native return/language evidence is stale: {name}")
            body = row["definition"].split("AS $function$")[1].rsplit("$function$", 1)[0]
            if body != match.group(1):
                raise ValueError(f"Native postimage is stale: {name}")
        elif (body_hash != row.get("source_body_sha256")
              or definition_hash != row.get("source_definition_sha256")):
            raise ValueError(f"Catalog evidence must be refreshed after SQL edits: {name}")
        selected.append({key: row[key] for key in (
            "signature", "definition_md5", "owner", "acl", "proconfig", "provolatile", "prosecdef"
        )} | {"source_body_sha256": body_hash, "source_definition_sha256": definition_hash})
    if len(selected) != 29 or len({row["signature"] for row in selected}) != 29:
        raise ValueError("Exactly 19 new and 10 replaced functions must be pinned")
    return sorted(selected, key=lambda row: row["signature"])


def checks(rows: list[dict]) -> str:
    values = []
    for row in rows:
        values.append("      (" + ", ".join(quote(str(value)) for value in (
            row["signature"], row["definition_md5"], row["owner"], row["acl"],
            json.dumps(row["proconfig"]), row["provolatile"], str(row["prosecdef"]).lower()
        )) + ")")
    return """  FOR r IN SELECT * FROM (VALUES
""" + ",\n".join(values) + """) pins(fn, digest, owner_name, acl, config, volatility, security_definer)
  LOOP
    IF to_regprocedure(r.fn) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.digest
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.owner_name
       OR (SELECT proacl::text FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.acl
       OR (SELECT to_jsonb(proconfig) FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.config::jsonb
       OR (SELECT provolatile::text FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.volatility
       OR (SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure(r.fn)) IS DISTINCT FROM r.security_definer::boolean THEN
      RAISE EXCEPTION 'Team Commissions postimage/security readback failed: %',r.fn USING ERRCODE='55000';
    END IF;
  END LOOP;
"""


def package(sql_bytes: bytes, *, rollback: bool, hosted_head: str, pins: list[dict], forward_hash: str) -> str:
    action = "rollback" if rollback else "apply"
    encoded = base64.b64encode(sql_bytes).decode()
    prefix = f"""-- Team Commissions {action}; exact separately approved SQL Editor package.
-- EXTERNAL TARGET CHECK REQUIRED: Supabase project {TARGET_PROJECT}.
-- The database name 'postgres' is NOT project identity. Verify the dashboard/tool project binding.
-- No production execution is authorized by generating or testing this file.
-- Atomic and replay-refusing. On uncertain outcome, inspect history/functions; never blindly retry.
-- {'Removes only the exact guarded migration-history row; financial/business rows are untouched.' if rollback else 'Stores the exact source SQL as one schema_migrations.statements entry with the CLI-generated version.'}
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='180s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $team_commissions_release$
DECLARE
  reviewed_sql text := convert_from(decode('{encoded}','base64'),'UTF8');
  reviewed_hash text := '{digest(sql_bytes)}';
  r record;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Use the separately approved database operator context' USING ERRCODE='42501';
  END IF;
  IF encode(sha256(convert_to(reviewed_sql,'UTF8')),'hex') IS DISTINCT FROM reviewed_hash THEN
    RAISE EXCEPTION 'Embedded SQL differs from approved bytes' USING ERRCODE='55000';
  END IF;
"""
    if not rollback:
        body = f"""  IF (SELECT max(version) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '{hosted_head}'
     OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='{VERSION}')
     OR '{VERSION}' <= '{hosted_head}' THEN
    RAISE EXCEPTION 'Hosted migration history drift or replay; review before applying' USING ERRCODE='55000';
  END IF;
  EXECUTE reviewed_sql;
""" + checks(pins) + f"""  INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    VALUES('{VERSION}','{NAME}',ARRAY[reviewed_sql]);
"""
    else:
        body = f"""  IF (SELECT max(version) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '{VERSION}'
     OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version='{VERSION}' AND name='{NAME}' AND cardinality(statements)=1
          AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='{forward_hash}') THEN
    RAISE EXCEPTION 'Recovery history differs from the exact approved release' USING ERRCODE='55000';
  END IF;
  EXECUTE reviewed_sql;
  DELETE FROM supabase_migrations.schema_migrations
    WHERE version='{VERSION}' AND name='{NAME}' AND cardinality(statements)=1
      AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='{forward_hash}';
  IF NOT FOUND OR to_regnamespace('policy_commission_scoped') IS NOT NULL
     OR (SELECT max(version) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '{hosted_head}' THEN
    RAISE EXCEPTION 'Recovery metadata readback failed' USING ERRCODE='55000';
  END IF;
"""
    return prefix + body + "END $team_commissions_release$;\nCOMMIT;\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postimages", type=Path, default=OUT / "manifest.json")
    parser.add_argument("--hosted-head", default="20261110205228")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{14}", args.hosted_head) or args.hosted_head >= VERSION:
        parser.error("--hosted-head must be the freshly verified earlier hosted migration version")
    loaded = json.loads(args.postimages.read_text())
    native = loaded["functions"] if isinstance(loaded, dict) else loaded
    forward, recovery = SOURCE.read_bytes(), RECOVERY.read_bytes()
    pins = function_pins(native, forward.decode())
    # Recovery must pin the same native postimages, rather than restoring across newer function changes.
    for row in pins:
        if quote(row["signature"]) not in recovery.decode() or quote(row["definition_md5"]) not in recovery.decode():
            raise ValueError(f"Recovery postimage guard is stale: {row['signature']}")
    OUT.mkdir(parents=True, exist_ok=True)
    apply = package(forward, rollback=False, hosted_head=args.hosted_head, pins=pins, forward_hash=digest(forward))
    undo = package(recovery, rollback=True, hosted_head=args.hosted_head, pins=pins, forward_hash=digest(forward))
    (OUT / "apply.sql").write_text(apply)
    (OUT / "rollback.sql").write_text(undo)
    manifest = {
        "project_id": TARGET_PROJECT, "external_project_binding_required": True,
        "status": "prepared_not_applied", "source_base": "e07d28bdef1d8a9a21f0eee408b181b625389527",
        "version": VERSION, "name": NAME, "expected_hosted_head": args.hosted_head,
        "migration": str(SOURCE.relative_to(ROOT)), "migration_sha256": digest(forward),
        "rollback": str(RECOVERY.relative_to(ROOT)), "rollback_sha256": digest(recovery),
        "apply_package_sha256": digest(apply.encode()), "rollback_package_sha256": digest(undo.encode()),
        "sql_effects": "19 new invoker/stable functions, 2 types, 1 non-exposed schema; replace 10 legacy reader/helper bodies; authenticated execute only; set a 20-second PostgREST request budget only on the three new public Overview, Scheduled and Breakdown RPCs; insert one exact migration-history row",
        "request_budget": {
            "statement_timeout_seconds": 20,
            "functions": ["public.get_scoped_commission_" + name for name in ("overview", "installments", "breakdown")],
            "mechanism": "Function SET statement_timeout, hoisted by PostgREST for that request transaction",
            "unchanged": "Role/database defaults and all legacy/helper function settings",
        },
        "rollback_effects": "Restore 10 captured reader/helper definitions; remove 19 functions, 2 types and schema with RESTRICT; delete only the exact guarded migration-history row; no business data changes",
        "production_authorization": "Separate exact release approval required; rollback also requires authorization unless explicitly included",
        "functions": pins,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({key: manifest[key] for key in (
        "migration_sha256", "rollback_sha256", "apply_package_sha256", "rollback_package_sha256"
    )}, indent=2))


if __name__ == "__main__":
    main()
