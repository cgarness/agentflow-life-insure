#!/usr/bin/env bash
# Prepare current and legacy app assets for a same-origin browser cutover.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${1:?temporary build directory required}
[[ -d $out && ! -e $out/legacy-src && ! -e $out/candidate-dist ]]
base=7914faefc750aaf38d3659a71d9a01b3298f9107
anon=$(node -pe 'require(process.env.AUTOMATIONS_LOCAL_SETTINGS).ANON_KEY')
mkdir "$out/legacy-src"
git archive "$base" | tar -x -C "$out/legacy-src"
ln -s "$PWD/node_modules" "$out/legacy-src/node_modules"
build() {
  local repo=$1 dest=$2
  (cd "$repo" && env -i PATH="$PATH" NO_PROXY='*' VITE_SUPABASE_URL=http://127.0.0.1:54340 VITE_SUPABASE_ANON_KEY="$anon" \
    node_modules/.bin/vite build --config e2e/team-open-local/vite.local.config.ts --outDir "$dest")
}
build "$out/legacy-src" "$out/legacy-dist" >"$out/legacy.log" 2>&1 &
legacy_pid=$!
build "$PWD" "$out/candidate-dist" >"$out/candidate.log" 2>&1 &
candidate_pid=$!
status=0
wait "$legacy_pid" || { tail -n 20 "$out/legacy.log" >&2; status=1; }
wait "$candidate_pid" || { tail -n 20 "$out/candidate.log" >&2; status=1; }
exit "$status"
