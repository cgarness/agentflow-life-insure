#!/usr/bin/env python3
"""Check schema fingerprints and the independent production receipts that a release-full run is measured against.

compare EXPECTED ACTUAL LABEL      both are schema-fingerprint.sql format 3 output; every family must match exactly
restored EXPECTED ACTUAL LABEL     ACTUAL is a dump and restore of EXPECTED's source: every family must match exactly,
                                   except that the families holding parsed expressions may instead match on their
                                   precedence-aware printing, which a restore's flattening of AND and OR chains leaves
                                   unchanged and any regrouping changes
validate ARCHIVE RECEIPTS TOC COPY the receipts come from outside the archive, at another moment in its window, each
                                   read through the Management API's own connection (mgmt-api); COPY holds the archive
                                   files as checksummed, which are the bytes read
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

FORMAT = "agentflow-schema-fingerprint/3"
# The families whose definitions hold expressions PostgreSQL parses again on restore (schema-fingerprint.sql gives each
# a precedence-aware printing). Every other family is stored as written, so a restore reproduces it exactly.
REPARSED = frozenset({"columns", "constraints", "indexes", "views", "triggers", "policies", "rules"})
CANONICAL_KEYS = {"row_script_sha256", "rollup_script_sha256", "rows_sha256", "rollup_sha256", "bucket_sha256"}
AUTH_KEYS = {"project_ref", "database", "observed_at", "version_count", "versions_sha256", "gotrue_version",
             "image_index_digest", "client"}
BUNDLE_FILES = ("agentflow-schema.dump", "roles.sql", "source-fingerprint-before.json", "source-fingerprint.json",
                "canonical-source.json", "auth-schema-migrations.txt", "extension-ownership.json")
OWNERSHIP_FORMAT = "agentflow-extension-ownership/2"
OWNERSHIP_KEYS = {"format", "captured_at", "client", "extensions", "members", "initial_privileges", "shared_dependencies"}
RECEIPT_FILES = ("schema-fingerprint.json", "canonical.json", "auth.json")
# The receipts are read in the same window as the dump: the platform renames and rotates some managed objects on its
# own (Realtime's dated partitions), so a reading from another day describes a different schema.
WINDOW = datetime.timedelta(hours=2)
MAX_AGE = datetime.timedelta(hours=72)
DUMP_LIMIT = datetime.timedelta(minutes=30)
# The receipts are read through the Supabase Management API, whose database connection names itself mgmt-api; the
# bundle is dumped through the operator's own database login. The synthetic rehearsal reads through its own named channel.
SYNTHETIC_PROJECT = "synthetic-release-full"


def receipt_channel(project):
    return "agentflow-receipt-channel" if project == SYNTHETIC_PROJECT else "mgmt-api"


def named_client(value):
    return (isinstance(value, dict) and set(value) == {"application_name", "session_user"}
            and all(isinstance(v, str) for v in value.values()))


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
        fail(f"{what} is not schema-fingerprint.sql format 3; capture it again with the current file")
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
    if not named_client(value.get("client")):
        fail(f"{what} does not name the connection that read it; capture it again with the current file")
    return when(value.get("captured_at"), what), by_kind


def compare(expected_path, actual_path, label, restored=False):
    _, expected = fingerprint(expected_path, "The expected fingerprint")
    _, actual = fingerprint(actual_path, f"The fingerprint of {label}")
    def exact(kind):
        return all(expected[kind][k] == actual[kind][k] for k in ("objects", "sha256", "loose"))
    def same(kind):
        if kind not in expected or kind not in actual:
            return False
        if exact(kind):
            return True
        return (restored and kind in REPARSED and expected[kind]["objects"] == actual[kind]["objects"]
                and expected[kind]["loose"] == actual[kind]["loose"])
    changed = sorted(kind for kind in expected.keys() | actual.keys() if not same(kind))
    if changed:
        fail(f"{label} differs from the expected schema in: " + ", ".join(changed))
    reparsed = sorted(kind for kind in expected if not exact(kind))
    note = (" Restoring parsed their stored expressions again, so these match on their precedence-aware printing "
            "rather than exactly: " + ", ".join(reparsed) + ".") if reparsed else ""
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
    def parsed(data):
        try:
            return json.loads(data)
        except (UnicodeError, json.JSONDecodeError):
            return None
    found = {}
    for name in RECEIPT_FILES:
        path = receipts / name
        info = regular(path, name)
        data = path.read_bytes()
        for other, (content, stat) in taken.items():
            # A copy of one of the archive's own files, byte for byte or reformatted, is not an independent reading.
            if ((info.st_dev, info.st_ino) == (stat.st_dev, stat.st_ino) or data == content
                    or (parsed(data) is not None and parsed(data) == parsed(content))):
                fail(f"Receipt {name} is the archive's own {other}, not an independent reading.")
        found[name] = path
    # The schema: two readings around the dump, and the independent receipt, in one window.
    before, before_families = fingerprint(bundle["source-fingerprint-before.json"], "The archive's fingerprint before the dump")
    after, after_families = fingerprint(bundle["source-fingerprint.json"], "The archive's fingerprint after the dump")
    captured, receipt_families = fingerprint(found["schema-fingerprint.json"], "The independent schema receipt")
    if before_families != after_families:
        fail("The source changed while it was being dumped; dump it again.")
    # Independent: read at another moment, through another connection than the bundle's own readings.
    receipt_reading = json.loads(found["schema-fingerprint.json"].read_text())
    bundle_readings = [json.loads(bundle[name].read_text()) for name in ("source-fingerprint-before.json", "source-fingerprint.json")]
    if any(captured == when(reading["captured_at"], "The archive's reading") for reading in bundle_readings):
        fail("The schema receipt was taken at the same moment as one of the archive's own readings; it is a copy of it.")
    if any(receipt_reading["client"] == reading["client"] for reading in bundle_readings):
        fail("The schema receipt was read through the same connection as the archive's readings "
             f"({receipt_reading['client']['application_name']}); read it through the other channel.")
    project = os.environ.get("AUTOMATIONS_SOURCE_PROJECT", "jncvvsvckxhqgqvkppmj")
    channel = receipt_channel(project)
    if not before <= after or after - before > DUMP_LIMIT:
        fail("The archive's two readings do not bracket one dump of at most 30 minutes.")
    # What the dump cannot carry for extensions, read through the archive's own connection between its two readings.
    ownership = parsed(taken["extension-ownership.json"][0])
    def address(parts):
        return (isinstance(parts[0], str) and all(isinstance(part, list) and all(isinstance(x, str) for x in part)
                                                  for part in parts[1:3]))
    def addresses(rows):
        return isinstance(rows, list) and all(
            isinstance(row, list) and len(row) == 4 and address(row[:3]) and isinstance(row[3], str) for row in rows)
    def dependencies(rows):
        # [type, object address, role]: an extension's owner ('o'), or a role an initial privilege names ('i').
        return isinstance(rows, list) and all(
            isinstance(row, list) and len(row) == 5 and row[0] in ("o", "i") and address(row[1:4])
            and isinstance(row[4], str) and (row[0] == "i" or row[1] == "extension") for row in rows)
    if (not isinstance(ownership, dict) or set(ownership) != OWNERSHIP_KEYS
            or ownership["format"] != OWNERSHIP_FORMAT or ownership["client"] != bundle_readings[1]["client"]
            or not isinstance(ownership["extensions"], list)
            or not all(isinstance(row, list) and len(row) == 2 and all(isinstance(x, str) for x in row)
                       for row in ownership["extensions"])
            or not addresses(ownership["members"]) or not addresses(ownership["initial_privileges"])
            or not dependencies(ownership["shared_dependencies"])):
        fail("The archive's extension ownership reading must be format 2, read through the archive's own connection; "
             "make the bundle with make-schema-bundle.sh.")
    if not before <= when(ownership["captured_at"], "The archive's extension ownership reading") <= after:
        fail("The archive's extension ownership reading was not taken between its two schema readings.")
    created = re.search(r"^;\s+Archive created at (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC$", Path(toc).read_text(), re.M)
    if not created:
        fail("The archive does not record its creation time in UTC; make it with make-schema-bundle.sh.")
    made = datetime.datetime.fromisoformat(created[1] + "+00:00")
    slack = datetime.timedelta(minutes=1)
    if not before - slack <= made <= after + slack:
        fail("The archive was not made between the two readings that accompany it.")
    # The canonical and Auth receipts carry their own capture times.
    canonical = json.loads(found["canonical.json"].read_text())
    if (not isinstance(canonical, dict) or set(canonical) != CANONICAL_KEYS | {"captured_at", "kinds", "client"}
            or not named_client(canonical["client"])):
        fail("The independent canonical receipt must hold the five digests, the per-kind digests, its capture time and "
             "the connection that read it.")
    source_canonical = json.loads(bundle["canonical-source.json"].read_text())
    if (not isinstance(source_canonical, dict) or set(source_canonical) != CANONICAL_KEYS | {"captured_at", "kinds", "client"}
            or not named_client(source_canonical["client"])):
        fail("The archive's canonical reading must hold the five digests, the per-kind digests, its capture time and "
             "the connection that read it.")
    if canonical["captured_at"] == source_canonical["captured_at"]:
        fail("The canonical receipt was taken at the same moment as the archive's own canonical reading; it is a copy of it.")
    auth = json.loads(found["auth.json"].read_text())
    if not isinstance(auth, dict) or set(auth) != AUTH_KEYS or not named_client(auth["client"]):
        fail("The independent Auth receipt has unexpected fields.")
    if auth["project_ref"] != project or auth["database"] != "postgres":
        fail("The Auth receipt describes another project or database.")
    # Independent of the operator's own login: every receipt came through the Management API's connection.
    for what, client in (("schema receipt", receipt_reading["client"]), ("canonical receipt", canonical["client"]),
                         ("Auth receipt", auth["client"])):
        if client["application_name"] != channel:
            fail(f"The {what} was read through {client['application_name']!r}, not the Management API's own connection "
                 f"({channel}); read the receipts with capture-receipts.sh.")
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
                      "receipt_client": receipt_reading["client"]["application_name"],
                      "archive_client": bundle_readings[1]["client"]["application_name"],
                      "families": len(receipt_families), "receipt_sha256": digests, "project_ref": project}))


def auth_receipt(reading_path, version, digest, project, out):
    reading = json.loads(Path(reading_path).read_text())
    if (not isinstance(reading, dict) or set(reading) != {"version_count", "versions_sha256", "observed_at", "client"}
            or not named_client(reading["client"])):
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
