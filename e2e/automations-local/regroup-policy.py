#!/usr/bin/env python3
"""release-full-synthetic.sh only: regroup one row-level security policy inside a synthetic schema-only archive and take
its checksums again, the way an archive edited after its readings would look. The policy keeps its length, so the
archive stays valid, but it now lets every agency read other agencies' default layouts. Usage: regroup-policy.py BUNDLE"""
import hashlib
import sys
from pathlib import Path

bundle = Path(sys.argv[1])
dump = bundle / "agentflow-schema.dump"
data = dump.read_bytes()
before = b"(((organization_id = public.get_org_id()) AND ((user_id = auth.uid()) OR (user_id IS NULL))))"
after = b"((((organization_id = public.get_org_id()) AND (user_id = auth.uid())) OR (user_id IS NULL)))"
if len(before) != len(after) or data.count(before) != 1:
    sys.exit("The policy to regroup was not found exactly once in the synthetic archive.")
dump.write_bytes(data.replace(before, after))
sums = bundle / "SHA256SUMS"
lines = []
for line in sums.read_text().splitlines():
    _, name = line.split("  ", 1)
    lines.append(f"{hashlib.sha256((bundle / name).read_bytes()).hexdigest()}  {name}")
sums.write_text("\n".join(lines) + "\n")
