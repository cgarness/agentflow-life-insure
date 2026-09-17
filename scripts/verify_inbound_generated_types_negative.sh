#!/usr/bin/env bash
# =====================================================================================================
# Negative controls for the generated-types verification (disposable LOCAL postgres only).
# =====================================================================================================
# A green type check is only worth something if a WRONG types.ts turns it red. This proves that, for the
# contracts M8 adds, by perturbing a COPY of src/integrations/supabase/types.ts and requiring failure:
#   1. the new RPC is OMITTED entirely                         -> must FAIL
#   2. the new RPC's Args type is CHANGED                      -> must FAIL
#   3. the new RPC's Returns shape is CHANGED                  -> must FAIL
#   4. a field is DROPPED from the new RPC's Returns           -> must FAIL
#   5. the unmodified repository file                          -> must PASS
# The real types.ts is never written to.
set -euo pipefail
PGURL="${PGURL:?set PGURL to a LOCAL postgres}"
case "$PGURL" in *127.0.0.1*|*localhost*) ;; *) echo "REFUSING: PGURL must be localhost"; exit 2 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REAL="$ROOT/src/integrations/supabase/types.ts"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

expect() {                 # $1 = label, $2 = expected outcome (pass|fail), $3 = types file
  local label="$1" want="$2" file="$3" got
  if PGURL="$PGURL" TYPES_FILE="$file" "$ROOT/scripts/verify_inbound_generated_types.sh" > "$WORK/out.log" 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$want" ]; then
    echo "NEGATIVE CONTROL FAILED: $label expected $want, got $got"; tail -15 "$WORK/out.log"; exit 1
  fi
  echo "   OK: $label -> $got (as required)"
}

# 1. omitted entirely
python3 - "$REAL" "$WORK/omitted.ts" <<'PY'
import io, sys, re
s = io.open(sys.argv[1], encoding="utf-8").read()
block = re.search(r"      voicemails_cleanup_actionable_batch: \{.*?\n      \}\n", s, re.S)
assert block, "could not locate the entry to omit"
io.open(sys.argv[2], "w", encoding="utf-8").write(s.replace(block.group(0), "", 1))
PY
expect "new RPC omitted" fail "$WORK/omitted.ts"

# 2. Args changed (number -> string)
python3 - "$REAL" "$WORK/args.ts" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding="utf-8").read()
old = "      voicemails_cleanup_blocked_summary: {\n        Args: { p_scan_limit?: number }"
new = "      voicemails_cleanup_blocked_summary: {\n        Args: { p_scan_limit?: string }"
assert old in s, "could not locate the Args to change"
io.open(sys.argv[2], "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
expect "new RPC Args changed" fail "$WORK/args.ts"

# 3. Returns type changed (boolean -> string)
python3 - "$REAL" "$WORK/returns.ts" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding="utf-8").read()
old = "          scan_capped: boolean\n"
new = "          scan_capped: string\n"
assert old in s, "could not locate the Returns field to change"
io.open(sys.argv[2], "w", encoding="utf-8").write(s.replace(old, new, 1))
PY
expect "new RPC Returns type changed" fail "$WORK/returns.ts"

# 4. a Returns field dropped
python3 - "$REAL" "$WORK/dropped.ts" <<'PY'
import io, sys
s = io.open(sys.argv[1], encoding="utf-8").read()
old = "          blocked_orgs: number\n"
assert old in s, "could not locate the Returns field to drop"
io.open(sys.argv[2], "w", encoding="utf-8").write(s.replace(old, "", 1))
PY
expect "new RPC Returns field dropped" fail "$WORK/dropped.ts"

# 5. the real file must still pass
expect "unmodified repository types" pass "$REAL"

echo "GENERATED-TYPES NEGATIVE CONTROLS GREEN (omission and three contract changes are all rejected)"
