#!/usr/bin/env bash
# Synthetic native PostgreSQL only. HARNESS_ROOT is the frozen Reports fixture checkout.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
: "${HARNESS_ROOT:?Set HARNESS_ROOT to the frozen Reports harness checkout}"
: "${PGURL:?Set PGURL to a disposable loopback PostgreSQL URL without a database path}"
export PGURL
python3 - <<'PY'
import os, urllib.parse
u = urllib.parse.urlsplit(os.environ['PGURL'])
assert u.scheme in ('postgres', 'postgresql') and u.hostname in ('localhost', '127.0.0.1', '::1')
assert u.port and u.path in ('', '/') and not u.query and not u.fragment, 'loopback database only'
PY
base="${PGURL%/}"
test "$(psql "$base/postgres" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('supabase_admin','authenticator','supabase_auth_admin')")" = 0
work="$(mktemp -d)"
db="reports_d_null_$$"
cleanup() { dropdb --if-exists --maintenance-db="$base/postgres" "$db" >/dev/null 2>&1; rm -rf "$work"; }
trap cleanup EXIT
cp -a "$HARNESS_ROOT/." "$work/"
for path in supabase/migrations/20261105120031_policy_sale_call_link_capture.sql supabase/migrations/20261105120042_policy_appointment_attributions.sql supabase/tests/policy_appointment_attributions.sql; do
  cp "$repo/$path" "$work/$path"
done
cd "$work"
cp supabase/migrations/20261105120042_policy_appointment_attributions.sql "$work/fixed.sql"
for mode in fixed original-contact original-authority; do
  python3 - "$mode" <<'PY'
from pathlib import Path
import sys
s = Path('fixed.sql').read_text()
if sys.argv[1] == 'original-contact':
    old = 'IF (o.contact_id IN (p_win.contact_id, coalesce(p_lead_id, p_win.contact_id))) IS NOT TRUE THEN'
    new = 'IF o.contact_id IS NULL OR o.contact_id NOT IN (p_win.contact_id, coalesce(p_lead_id, p_win.contact_id)) THEN'
elif sys.argv[1] == 'original-authority':
    old = "IF (v_head.declaration = 'none' AND v_head.supersedes_attribution_id IS NULL AND p_declaration = 'appointment'\n            AND p_source IN ('outcome_entry', 'policy_entry')\n            AND a.uid IN (w.agent_id, private.appointment_assignee_at_start(t.occurrence_id))) IS NOT TRUE THEN"
    new = old.replace('IF (', 'IF NOT (', 1).replace(') IS NOT TRUE THEN', ') THEN')
else:
    old = new = None
if old:
    assert s.count(old) == 1
    s = s.replace(old, new)
Path('supabase/migrations/20261105120042_policy_appointment_attributions.sql').write_text(s)
PY
  createdb --maintenance-db="$base/postgres" "$db"
  REPORTS_V3_PERF=0 python3 scripts/reports_v3_fixture.py --until 'policy appointment attribution regressions' > "$work/fixture.sql"
  if psql "$base/$db" -X -q -v ON_ERROR_STOP=1 -f "$work/fixture.sql" > "$work/$mode.log" 2>&1; then
    if [[ "$mode" != fixed ]]; then cat "$work/$mode.log"; echo "FAIL: original $mode passed"; exit 1; fi
    grep 'PASS D-NULL-' "$work/$mode.log"
    echo 'PASS corrected migration: canonical attribution suite and authenticated NULL regressions'
  else
    case "$mode" in
      original-contact) expected='D-NULL-IDENTITY missing buyer is rejected FAIL:' ;;
      original-authority) expected='D-NULL-AUTHORITY missing start assignee rejects non-seller FAIL:' ;;
      *) tail -35 "$work/$mode.log"; exit 1 ;;
    esac
    if ! grep -F "$expected" "$work/$mode.log"; then tail -35 "$work/$mode.log"; exit 1; fi
    echo "PASS negative control: $mode independently reproduces its regression"
  fi
  dropdb --maintenance-db="$base/postgres" "$db"
done
