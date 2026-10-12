#!/bin/bash
# Reproduce the pinned-clock Reports CSV comparison: base and candidate fixture servers, one at a time on strict
# loopback ports, each served root proven from the transformed entry's /@fs/ imports, then a raw byte comparison.
#   BASE_TREE=/path/to/detached/e11c8bea/worktree CAND_TREE=/path/to/candidate OUT=/path/to/output \
#   PAYLOADS=/path/to/reports-payloads.json PLAYWRIGHT_MODULE=/path/to/node_modules/playwright bash run-capture.sh
# Both trees need node_modules (the base worktree may symlink the candidate's). Stop only the PIDs started here.
set -u
: "${BASE_TREE:?}" "${CAND_TREE:?}" "${OUT:?}" "${PAYLOADS:?}" "${PLAYWRIGHT_MODULE:?}"
HERE=$(cd "$(dirname "$0")" && pwd); mkdir -p "$OUT"; LOG=$OUT/servers.txt; : > "$LOG"
echo "candidate_head=$(git -C "$CAND_TREE" rev-parse HEAD) base_head=$(git -C "$BASE_TREE" rev-parse HEAD) payloads_sha256=$(sha256sum "$PAYLOADS" | cut -d' ' -f1)" | tee -a "$LOG"
for t in base cand; do
  tree=$([ $t = base ] && echo "$BASE_TREE" || echo "$CAND_TREE"); port=$([ $t = base ] && echo 4181 || echo 4182)
  ( cd "$tree" && REPORTS_SQL_PAYLOADS=$PAYLOADS exec node node_modules/vite/bin/vite.js --config scripts/tests/reports-visual/vite.config.ts --port $port --strictPort > "$OUT/vite-$t.log" 2>&1 ) &
  PID=$!
  for i in $(seq 1 60); do grep -q "Local:" "$OUT/vite-$t.log" && break; sleep 0.5; done
  ROOT=$(curl -fsS http://127.0.0.1:$port/entry.tsx | grep -o '/@fs/[^"]*/src/[^"]*' | head -1 | sed -E 's|^/@fs||; s|/src/.*$||')
  echo "$t pid=$PID port=$port served_root=$ROOT head=$(git -C "$ROOT" rev-parse HEAD)" | tee -a "$LOG"
  rm -rf "$OUT/csv-$t"
  PLAYWRIGHT_MODULE=$PLAYWRIGHT_MODULE REPORTS_CAPTURE_URL=http://127.0.0.1:$port REPORTS_CAPTURE_OUTPUT=$OUT/csv-$t \
    node "$HERE/csv-capture.mjs" > "$OUT/csv-$t.out" 2>&1; echo "csv-$t exit=$? $(tail -1 "$OUT/csv-$t.out")" | tee -a "$LOG"
  kill $PID; sleep 1; [ -e /proc/$PID ] && echo "WARN $PID still running" | tee -a "$LOG"
done
node "$HERE/compare-csv-captures.mjs" "$OUT/csv-base" "$OUT/csv-cand" > "$OUT/csv-compare.out" 2>&1; echo "csv-compare exit=$?" | tee -a "$LOG"
tail -1 "$OUT/csv-compare.out" | tee -a "$LOG"
