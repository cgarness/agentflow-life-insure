#!/usr/bin/env python3
"""Check schema fingerprints and the independent production receipts that a release-full run is measured against.

compare EXPECTED ACTUAL LABEL      both are schema-fingerprint.sql format 2 output; every family must match exactly
restored EXPECTED ACTUAL LABEL     ACTUAL is a dump and restore of EXPECTED's source: every family must match, with
                                   the parentheses PostgreSQL drops when it parses stored expressions again ignored
validate ARCHIVE RECEIPTS TOC COPY the receipts come from outside the archive, from another channel, in its window;
                                   COPY holds the archive files as checksummed, which are the bytes read
connector-sql FILE                 a query in the form a connector that returns only the last result can run
auth-receipt READING VERSION DIGEST PROJECT OUT
                                   the Auth receipt from auth-receipt.sql's reading, the health version and the
                                   registry digest of that version's image
"""
import datetime
import hashlib
import json
import os
import re
import sys
from pathlib import Path

FORMAT = "agentflow-schema-fingerprint/2"
CANONICAL_KEYS = {"row_script_sha256", "rollup_script_sha256", "rows_sha256", "rollup_sha256", "bucket_sha256"}
AUTH_KEYS = {"project_ref", "database", "observed_at", "version_count", "versions_sha256", "gotrue_version",
             "image_index_digest"}
BUNDLE_FILES = ("agentflow-schema.dump", "roles.sql", "source-fingerprint-before.json", "source-fingerprint.json",
                "canonical-source.json", "auth-schema-migrations.txt")
RECEIPT_FILES = ("schema-fingerprint.json", "canonical.json", "auth.json")
# The receipts are read in the same window as the dump: the platform renames and rotates some managed objects on its
# own (Realtime's dated partitions), so a reading from another day describes a different schema.
WINDOW = datetime.timedelta(hours=2)
MAX_AGE = datetime.timedelta(hours=72)
DUMP_LIMIT = datetime.timedelta(minutes=30)


def fail(message):
    raise SystemExit(message)


def when(value, what):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z", value):
        fail(f"{what} has no UTC capture time")
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def fingerprint(path, what):
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        fail(f"{what} is not readable JSON")
    if not isinstance(value, dict) or value.get("format") != FORMAT:
        fail(f"{what} is not schema-fingerprint.sql format 2; capture it again with the current file")
    families = value.get("families")
    def valid(row):
        return (isinstance(row, dict) and set(row) == {"kind", "objects", "sha256", "loose"}
                and isinstance(row["kind"], str) and type(row["objects"]) is int and row["objects"] > 0
                and all(isinstance(row[k], str) and re.fullmatch(r"[0-9a-f]{64}", row[k]) for k in ("sha256", "loose")))
    if not isinstance(families, list) or not families or not all(valid(row) for row in families):
        fail(f"{what} has malformed families")
    by_kind = {row["kind"]: row for row in families}
    if len(by_kind) != len(families) or "session" not in by_kind:
        fail(f"{what} has duplicate families or no session family")
    return when(value.get("captured_at"), what), by_kind


def compare(expected_path, actual_path, label, restored=False):
    _, expected = fingerprint(expected_path, "The expected fingerprint")
    _, actual = fingerprint(actual_path, f"The fingerprint of {label}")
    keys = ("objects", "loose") if restored else ("objects", "sha256", "loose")
    def same(kind):
        return kind in expected and kind in actual and all(expected[kind][k] == actual[kind][k] for k in keys)
    changed = sorted(kind for kind in expected.keys() | actual.keys() if not same(kind))
    if changed:
        fail(f"{label} differs from the expected schema in: " + ", ".join(changed))
    reparsed = sorted(kind for kind in expected if expected[kind]["sha256"] != actual[kind]["sha256"])
    note = (" Restoring parsed the stored expressions again, so these print with fewer parentheses: "
            + ", ".join(reparsed) + ".") if reparsed else ""
    print(f"{label} matches the expected schema in all {len(expected)} fingerprint families.{note}")


def regular(path, what):
    if not path.is_file() or path.is_symlink():
        fail(f"Missing regular file: {what}")
    return path.stat()


def validate(archive, receipts, toc, copy):
    archive, receipts = Path(archive).resolve(strict=True), Path(receipts).resolve(strict=True)
    if archive == receipts or receipts.is_relative_to(archive) or archive.is_relative_to(receipts):
        fail("The receipts must come from a directory outside the archive, and the archive from outside the receipts.")
    bundle = {name: Path(copy) / name for name in BUNDLE_FILES}
    taken = {name: (bundle[name].read_bytes(), regular(archive / name, name)) for name in BUNDLE_FILES}
    found = {}
    for name in RECEIPT_FILES:
        path = receipts / name
        info = regular(path, name)
        data = path.read_bytes()
        for other, (content, stat) in taken.items():
            if (info.st_dev, info.st_ino) == (stat.st_dev, stat.st_ino) or data == content:
                fail(f"Receipt {name} is the archive's own {other}, not an independent reading.")
        found[name] = path
    # The schema: two readings around the dump, and the independent receipt, in one window.
    before, before_families = fingerprint(bundle["source-fingerprint-before.json"], "The archive's fingerprint before the dump")
    after, after_families = fingerprint(bundle["source-fingerprint.json"], "The archive's fingerprint after the dump")
    captured, receipt_families = fingerprint(found["schema-fingerprint.json"], "The independent schema receipt")
    if before_families != after_families:
        fail("The source changed while it was being dumped; dump it again.")
    if not before <= after or after - before > DUMP_LIMIT:
        fail("The archive's two readings do not bracket one dump of at most 30 minutes.")
    created = re.search(r"^;\s+Archive created at (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC$", Path(toc).read_text(), re.M)
    if not created:
        fail("The archive does not record its creation time in UTC; make it with make-schema-bundle.sh.")
    made = datetime.datetime.fromisoformat(created[1] + "+00:00")
    slack = datetime.timedelta(minutes=1)
    if not before - slack <= made <= after + slack:
        fail("The archive was not made between the two readings that accompany it.")
    # The canonical and Auth receipts carry their own capture times.
    canonical = json.loads(found["canonical.json"].read_text())
    if not isinstance(canonical, dict) or set(canonical) != CANONICAL_KEYS | {"captured_at", "kinds"}:
        fail("The independent canonical receipt must hold the five digests, the per-kind digests and its capture time.")
    source_canonical = json.loads(bundle["canonical-source.json"].read_text())
    if not isinstance(source_canonical, dict) or set(source_canonical) != CANONICAL_KEYS | {"captured_at", "kinds"}:
        fail("The archive's canonical reading must hold the five digests, the per-kind digests and its capture time.")
    auth = json.loads(found["auth.json"].read_text())
    if not isinstance(auth, dict) or set(auth) != AUTH_KEYS:
        fail("The independent Auth receipt has unexpected fields.")
    project = os.environ.get("AUTOMATIONS_SOURCE_PROJECT", "jncvvsvckxhqgqvkppmj")
    if auth["project_ref"] != project or auth["database"] != "postgres":
        fail("The Auth receipt describes another project or database.")
    times = {
        "the schema receipt": captured,
        "the canonical receipt": when(canonical["captured_at"], "The canonical receipt"),
        "the archive's canonical reading": when(source_canonical["captured_at"], "The archive's canonical reading"),
        "the Auth receipt": when(auth["observed_at"], "The Auth receipt"),
    }
    for what, moment in times.items():
        if abs(moment - after) > WINDOW:
            fail(f"{what[0].upper() + what[1:]} was not taken within two hours of the dump.")
    now = datetime.datetime.now(datetime.timezone.utc)
    if now - min(times["the schema receipt"], after) > MAX_AGE:
        fail("The receipts and the archive are more than 72 hours old; capture both again.")
    if receipt_families != after_families:
        changed = sorted(k for k in receipt_families.keys() | after_families.keys()
                         if receipt_families.get(k) != after_families.get(k))
        fail("The archive does not match the independent schema receipt in: " + ", ".join(changed))
    digests = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in found.items()}
    print(json.dumps({"archive_created_at": made.isoformat().replace("+00:00", "Z"),
                      "receipt_captured_at": times["the schema receipt"].isoformat().replace("+00:00", "Z"),
                      "families": len(receipt_families), "receipt_sha256": digests, "project_ref": project}))


def auth_receipt(reading_path, version, digest, project, out):
    reading = json.loads(Path(reading_path).read_text())
    if not isinstance(reading, dict) or set(reading) != {"version_count", "versions_sha256", "observed_at"}:
        fail("The Auth reading has unexpected fields")
    when(reading["observed_at"], "The Auth reading")
    if not re.fullmatch(r"v\d+\.\d+\.\d+", version) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        fail("Invalid Auth version or registry digest")
    Path(out).write_text(json.dumps({"project_ref": project, "database": "postgres", **reading,
                                     "gotrue_version": version, "image_index_digest": digest}, indent=2) + "\n")


def connector_sql(path):
    text = Path(path).read_text().rstrip()
    if not text.endswith("COMMIT;"):
        fail("Expected a query file that ends with COMMIT;")
    print(text[: -len("COMMIT;")].rstrip())


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 4 and args[0] == "compare":
        compare(*args[1:])
    elif len(args) == 4 and args[0] == "restored":
        compare(*args[1:], restored=True)
    elif len(args) == 5 and args[0] == "validate":
        validate(*args[1:])
    elif len(args) == 2 and args[0] == "connector-sql":
        connector_sql(args[1])
    elif len(args) == 6 and args[0] == "auth-receipt":
        auth_receipt(*args[1:])
    else:
        fail(__doc__)
