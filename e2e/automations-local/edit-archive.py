#!/usr/bin/env python3
"""release-full-synthetic.sh only: change one definition inside a synthetic schema-only archive and take its checksums
again, the way an archive edited after its readings would look. The receipt and the bundle's own readings still agree,
so only the restored database can show the change. Usage: edit-archive.py BUNDLE EDIT, where EDIT is one of:

regroup      regroup one row-level security policy's AND and OR, which lets every agency read other agencies' default
             layouts
swap-clause  move one FOR ALL policy's condition from USING to WITH CHECK, which stops it limiting the rows people read
outside      add a cast between built-in types and a function in pg_catalog, and disable a table's foreign-key triggers
builtin      change built-ins pg_dump never writes: now() marked immutable, lpad(text, integer) padding with asterisks,
             English text search without plain words, and a collation added to pg_catalog
owner        say in the bundle's extension ownership reading, not the archive, that pgcrypto belongs to supabase_admin,
             as a restore leaves it (and so has no owner row in its shared dependencies), so only the receipt can
             show that the restored copy is not the source
dependency   leave pgcrypto's owner row out of the shared dependencies the bundle's ownership reading records, so the
             ownership step's own check against that reading refuses the copy it made

The archive's table of contents stores each definition as a length-prefixed string (a sign byte, then the length in
intSize bytes, least significant first), so an edit that changes a definition's length rewrites its prefix. A
schema-only archive holds no data blocks whose offsets could move."""
import hashlib
import json
import sys
from pathlib import Path

POLICY = b'CREATE POLICY "Admins can manage org default layouts" ON public.report_layouts '
FOREIGN_KEY = b"ALTER TABLE ONLY public.a2p_accounts\n    ADD CONSTRAINT a2p_accounts_organization_id_fkey FOREIGN KEY "
OUTSIDE = (b"ALTER TABLE public.a2p_accounts DISABLE TRIGGER ALL;\n"
           b"CREATE CAST (uuid AS text) WITH INOUT AS IMPLICIT;\n"
           b"CREATE FUNCTION pg_catalog.get_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;\n")
BUILTIN = (b"ALTER FUNCTION pg_catalog.now() IMMUTABLE;\n"
           b"CREATE OR REPLACE FUNCTION pg_catalog.lpad(text, integer) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE"
           b" STRICT AS $$SELECT pg_catalog.rpad($1, $2, '*')$$;\n"
           b"ALTER TEXT SEARCH CONFIGURATION pg_catalog.english DROP MAPPING FOR asciiword;\n"
           b"CREATE COLLATION pg_catalog.agentflow_edit FROM \"C\";\n")


def fail(message):
    sys.exit(message)


def rewrite(data, start_marker, edit):
    """Replace the one definition that starts with start_marker by edit(definition)."""
    if data[:5] != b"PGDMP":
        fail("Not a custom-format archive.")
    int_size = data[8]  # PGDMP, major, minor, revision, intSize, offSize, format
    if data.count(start_marker) != 1:
        fail(f"{start_marker[:60]!r} was not found exactly once in the synthetic archive.")
    start = data.index(start_marker)
    sign, length = data[start - 1 - int_size], int.from_bytes(data[start - int_size:start], "little")
    definition = data[start:start + length]
    if sign != 0 or not definition.endswith(b";\n"):
        fail("The definition's length prefix was not where the archive format puts it.")
    edited = edit(definition)
    return data[:start - 1 - int_size] + bytes([0]) + len(edited).to_bytes(int_size, "little") + edited + data[start + length:]


def regroup(data):
    before = b"(((organization_id = public.get_org_id()) AND ((user_id = auth.uid()) OR (user_id IS NULL))))"
    after = b"((((organization_id = public.get_org_id()) AND (user_id = auth.uid())) OR (user_id IS NULL)))"
    if len(before) != len(after) or data.count(before) != 1:
        fail("The policy to regroup was not found exactly once in the synthetic archive.")
    return data.replace(before, after)


def swap_clause(data):
    def edit(definition):
        if definition.count(b" USING (") != 1 or b"WITH CHECK" in definition:
            fail("The policy to change does not hold exactly one USING condition and no WITH CHECK.")
        return definition.replace(b" USING (", b" WITH CHECK (")
    return rewrite(data, POLICY, edit)


def outside(data):
    return rewrite(data, FOREIGN_KEY, lambda definition: definition + OUTSIDE)


def builtin(data):
    return rewrite(data, FOREIGN_KEY, lambda definition: definition + BUILTIN)


PGCRYPTO_OWNER = ["o", "extension", ["pgcrypto"], [], "postgres"]


def owner(data):
    reading = json.loads(data)
    if ["pgcrypto", "postgres"] not in reading["extensions"] or PGCRYPTO_OWNER not in reading["shared_dependencies"]:
        fail("The ownership reading does not hold pgcrypto owned by postgres.")
    reading["extensions"] = [[name, "supabase_admin" if name == "pgcrypto" else who] for name, who in reading["extensions"]]
    # supabase_admin is pinned (the bootstrap superuser), so PostgreSQL would keep no owner row for it.
    reading["shared_dependencies"].remove(PGCRYPTO_OWNER)
    return json.dumps(reading).encode()


def dependency(data):
    reading = json.loads(data)
    if PGCRYPTO_OWNER not in reading["shared_dependencies"]:
        fail("The ownership reading does not record pgcrypto's owner among its shared dependencies.")
    reading["shared_dependencies"].remove(PGCRYPTO_OWNER)
    return json.dumps(reading).encode()


EDITS = {"regroup": ("agentflow-schema.dump", regroup), "swap-clause": ("agentflow-schema.dump", swap_clause),
         "outside": ("agentflow-schema.dump", outside), "builtin": ("agentflow-schema.dump", builtin),
         "owner": ("extension-ownership.json", owner), "dependency": ("extension-ownership.json", dependency)}

if len(sys.argv) != 3 or sys.argv[2] not in EDITS:
    fail(__doc__)
bundle = Path(sys.argv[1])
name, change = EDITS[sys.argv[2]]
target = bundle / name
target.write_bytes(change(target.read_bytes()))
sums = bundle / "SHA256SUMS"
lines = []
for line in sums.read_text().splitlines():
    _, name = line.split("  ", 1)
    lines.append(f"{hashlib.sha256((bundle / name).read_bytes()).hexdigest()}  {name}")
sums.write_text("\n".join(lines) + "\n")
