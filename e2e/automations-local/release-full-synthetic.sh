#!/usr/bin/env bash
# release-full end to end without production. A synthetic source (production's migrations up to today) supplies the
# bundle its operator would make and the receipts read separately afterwards. Each way a run could be measured against
# the wrong thing is refused before anything is restored, and then the full run passes. Each step builds and removes
# its own disposable cluster. Run from a checkout with Docker, Node, Python 3.11 or newer, openssl and curl.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export LOCAL_POSTGRES_IMAGE=${LOCAL_POSTGRES_IMAGE:-supabase/postgres:17.6.1.085}
export AUTOMATIONS_SOURCE_PROJECT=synthetic-release-full
bash e2e/automations-local/run.sh synthetic-source "$work/source"
bundle=$work/source/bundle
receipts=$work/source/receipts
refused() { # refused WHAT EXPECTED_MESSAGE ARCHIVE RECEIPTS
  local log
  if log=$(bash e2e/automations-local/run.sh release-full "$3" "$4" 2>&1); then echo "release-full accepted $1" >&2; exit 1; fi
  grep -qF -- "$2" <<<"$log" || { echo "release-full refused $1 for another reason:" >&2; tail -8 <<<"$log" >&2; exit 1; }
  echo "PASS refused $1"
}
variant() { cp -a "$receipts" "$work/$1"; echo "$work/$1"; }
edit() { # edit FILE PYTHON_EXPRESSION_ON_d
  python3 - "$1" "$2" <<'PY'
import datetime, json, sys
path, expression = sys.argv[1], sys.argv[2]
d = json.load(open(path))
exec(expression)
json.dump(d, open(path, 'w'))
PY
}

cp -a "$receipts" "$bundle/receipts"
refused 'receipts kept inside the bundle' 'outside the archive' "$bundle" "$bundle/receipts"
rm -rf -- "$bundle/receipts"

own=$(variant own)
cp "$bundle/source-fingerprint.json" "$own/schema-fingerprint.json"
refused "the bundle's own reading offered as the receipt" 'not an independent reading' "$bundle" "$own"

v1=$(variant format-one)
edit "$v1/schema-fingerprint.json" 'd = d["families"]'
refused 'a receipt in the old format' 'format 2' "$bundle" "$v1"

stale=$(variant stale)
edit "$stale/schema-fingerprint.json" 'd["captured_at"] = (datetime.datetime.fromisoformat(d["captured_at"].replace("Z", "+00:00")) - datetime.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")'
refused 'a receipt read three hours before the dump' 'within two hours of the dump' "$bundle" "$stale"

settings=$(variant settings)
cp "$work/source/variants/other-settings.json" "$settings/schema-fingerprint.json"
refused 'a receipt read with another search_path' 'does not match the independent schema receipt in:' "$bundle" "$settings"
grep -q '"kind": "session"' "$work/source/variants/other-settings.json"

drift=$(variant drift)
edit "$drift/schema-fingerprint.json" 'next(f for f in d["families"] if f["kind"] == "functions")["sha256"] = "0" * 64'
refused 'a source that changed after the dump' 'in: functions' "$bundle" "$drift"

old_canonical=$(variant canonical)
edit "$old_canonical/canonical.json" 'd.pop("captured_at")'
refused 'a canonical receipt without its capture time' 'canonical receipt must hold' "$bundle" "$old_canonical"

missing=$(variant missing)
rm -- "$missing/auth.json"
refused 'a missing Auth receipt' 'Missing regular file: auth.json' "$bundle" "$missing"

cp -a "$bundle" "$work/tampered"
echo '-- changed after the checksums were taken' >>"$work/tampered/roles.sql"
refused 'a bundle file changed after its checksums' 'Bundle checksum mismatch' "$work/tampered" "$receipts"

bash e2e/automations-local/run.sh release-full "$bundle" "$receipts"
echo 'PASS release-full synthetic: nine refusals, then the restored database, its installation base and every migration and rollback target matched the independent receipt.'
