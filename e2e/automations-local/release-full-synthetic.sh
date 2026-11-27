#!/usr/bin/env bash
# release-full end to end without production. A synthetic source (105 of production's 122 earlier migrations, the first
# release and the first-text sender; see the README) supplies the bundle its operator would make and the receipts read
# separately afterwards. Each way a run could be measured against the wrong thing is refused (twelve before anything is
# restored; four archives and two extension readings edited after they were taken while or after their copy is
# restored), and then the full run passes. Each step builds and removes its own disposable cluster. Run from a checkout
# with Docker, Node, Python 3.11 or newer, openssl and curl. The stand-in and the restore both run on production's image
# (LOCAL_POSTGRES_IMAGE selects another), and the stand-in takes production's path, without pg_graphql;
# AUTOMATIONS_SYNTHETIC_PG_GRAPHQL=keep rehearses an archive that holds it.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export LOCAL_POSTGRES_IMAGE=${LOCAL_POSTGRES_IMAGE:-supabase/postgres:17.6.1.063}
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
refused 'a receipt in the old format' 'format 3' "$bundle" "$v1"

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

# The bundle's own reading, reformatted, is still the bundle's own reading.
reformatted=$(variant reformatted)
python3 -c 'import json,sys; json.dump(json.load(open(sys.argv[1])), open(sys.argv[2], "w"), indent=2)' \
  "$bundle/source-fingerprint.json" "$reformatted/schema-fingerprint.json"
refused "the bundle's own reading, reformatted, offered as the receipt" 'not an independent reading' "$bundle" "$reformatted"

# A receipt read through the same connection as the bundle's readings is not from another channel.
same_channel=$(variant same-channel)
edit "$same_channel/schema-fingerprint.json" "d['client'] = json.load(open('$bundle/source-fingerprint.json'))['client']"
refused 'a receipt read through the same connection as the bundle' 'through the same connection' "$bundle" "$same_channel"

# Nor is one read through any other connection than the receipt channel, the operator's own psql included.
own_login=$(variant own-login)
edit "$own_login/canonical.json" "d['client']['application_name'] = 'psql'"
refused "a receipt read through the operator's own login" "not the Management API's own connection" "$bundle" "$own_login"

# Archives edited after their readings were taken, with their checksums taken again: the receipt and the bundle's
# readings agree, but the restored database does not, so the run stops before anything is applied.
cp -a "$bundle" "$work/regrouped"
python3 e2e/automations-local/edit-archive.py "$work/regrouped" regroup
refused 'an archive whose policy was regrouped after it was read' 'differs from the expected schema in: policies' "$work/regrouped" "$receipts"
cp -a "$bundle" "$work/swapped"
python3 e2e/automations-local/edit-archive.py "$work/swapped" swap-clause
refused "an archive whose policy condition was moved from USING to WITH CHECK" 'differs from the expected schema in: policies' "$work/swapped" "$receipts"
cp -a "$bundle" "$work/outside"
python3 e2e/automations-local/edit-archive.py "$work/outside" outside
refused "an archive that adds a cast between built-in types and a pg_catalog function and disables a table's foreign-key triggers" \
  'differs from the expected schema in: casts, catalog_objects, triggers' "$work/outside" "$receipts"
cp -a "$bundle" "$work/builtin"
python3 e2e/automations-local/edit-archive.py "$work/builtin" builtin
refused 'an archive that changes built-in functions and text search and adds a pg_catalog collation' \
  'differs from the expected schema in: builtins, catalog_objects' "$work/builtin" "$receipts"
# The source's extensions belong to postgres, as production's do: the restore reproduces that from the bundle's own
# ownership reading, which cannot make a copy pass. Changed after it was read, it leaves the copy unlike the receipt.
cp -a "$bundle" "$work/owner"
python3 e2e/automations-local/edit-archive.py "$work/owner" owner
refused "an extension ownership reading changed after it was read" 'differs from the expected schema in: extensions' \
  "$work/owner" "$receipts"
# The shared dependencies the step writes are checked against the source's own reading of them, which no fingerprint
# family reads: changed after it was read, the step itself refuses the copy.
cp -a "$bundle" "$work/dependency"
python3 e2e/automations-local/edit-archive.py "$work/dependency" dependency
refused "an extension ownership reading whose shared dependencies changed after it was read" \
  "shared dependencies on roles differ from the source reading" "$work/dependency" "$receipts"

bash e2e/automations-local/run.sh release-full "$bundle" "$receipts"
echo 'PASS release-full synthetic: eighteen refusals, then the restored database, its installation base and the rollback rehearsal target matched the independent receipt, and every migration and rollback target matched the database it was copied from.'
