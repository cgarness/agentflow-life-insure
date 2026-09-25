#!/usr/bin/env bash
# TEST-ONLY offline regression tests for e2e/team-open-local/isolation.sh (implementation_plan.md §11).
#
# Runs the REAL script, and in the egress cases the script's REAL in-container probe wrapper, against
# generated stubs. PATH inside every run holds only the stubs plus an allowlist of core utilities, so neither
# the outer script nor the inner wrapper can reach real Docker, iptables, the Supabase CLI or the network.
#   - the `timeout` stub NEVER executes its arguments (so bash /dev/tcp is never attempted);
#   - any unexpected stub invocation exits 97 and is reported.
# These are MOCKED behaviour checks of the script's logic. They are not a real-infrastructure test.
#
# Usage: bash isolation.test.sh [path/to/isolation.sh]   (default: ../isolation.sh)
# Exit status: 0 if every case matches its expectation, 1 otherwise, 2 if the sandbox cannot be built.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$(cd "$(dirname "${1:-$HERE/../isolation.sh}")" && pwd)/$(basename "${1:-$HERE/../isolation.sh}")
[ -f "$SCRIPT" ] || { echo "BLOCKED: no script at $SCRIPT"; exit 2; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
BIN=$T/bin; INNER_NO_TIMEOUT=$T/bin-no-timeout; WS=$T/ws; ST=$T/state
mkdir -p "$BIN" "$INNER_NO_TIMEOUT" "$WS/supabase" "$ST"

# --- sandbox: allowlisted real utilities only ----------------------------------------------------------
for u in bash sh grep head cat dirname tr sed mv sort cut node env; do
  real=$(command -v "$u") || { echo "BLOCKED: required utility '$u' not installed"; exit 2; }
  ln -s "$real" "$BIN/$u"
  [ "$u" = timeout ] || ln -s "$real" "$INNER_NO_TIMEOUT/$u"
done

# --- stubs -------------------------------------------------------------------------------------------
cat > "$BIN/timeout" <<'EOF'
#!/bin/bash
# STUB: never executes "$@". Emits the configured stderr and exit code only.
echo "timeout $*" >> "$STUB_LOG"
[ -n "${TIMEOUT_ERR:-}" ] && printf '%b' "$TIMEOUT_ERR" >&2
exit "${TIMEOUT_RC:?TIMEOUT_RC not set}"
EOF

cat > "$BIN/docker" <<'EOF'
#!/bin/bash
echo "docker $1 $2" >> "$STUB_LOG"
unexpected() { echo "stub: unexpected docker invocation: $*" >&2; exit 97; }
case "$1" in
  inspect) [ "${DOCKER_RUNNING:-true}" = true ] && echo true || echo false ;;
  ps) printf 'stub-db\t0.0.0.0:54322->5432/tcp\n' ;;
  exec)
    if [ "$2" = "-i" ]; then cat >/dev/null; echo "DB-side assertions: OK (stub)"; exit 0; fi
    [ "$#" -eq 5 ] && [ "$3" = sh ] && [ "$4" = -c ] || unexpected "$@"
    inner() { PATH="${INNER_PATH:?}" sh -c "$5"; }
    case "${EXEC_MODE:-run}" in
      run)             inner "$@"; exit $? ;;
      die_after_start) echo PROBE_STARTED; exit "${EXEC_RC:?}" ;;
      start_only)      echo PROBE_STARTED; exit 0 ;;
      truncate)        out=$(inner "$@"); printf '%s\n' "$out" | head -n1; exit 0 ;;
      mangle)          out=$(inner "$@"); printf '%s\n' "$out" | sed 's/rc=\([0-9]*\)/rc=x\1/'; exit 0 ;;
      extra)           inner "$@"; echo "PROBE_RESULT rc=124 err="; exit 0 ;;
      daemon_error)    echo "Error response from daemon: container is not running" >&2; exit 126 ;;
      *) unexpected "$@" ;;
    esac ;;
  *) unexpected "$@" ;;
esac
EOF

cat > "$BIN/iptables" <<'EOF'
#!/bin/bash
# STUB firewall: per-chain state files; exact-line deletion; configurable read failures and insertions.
echo "iptables $*" >> "$STUB_LOG"
if [ "$1" = "-D" ]; then
  ch=$2; shift 2; line="-A $ch $*"
  grep -qxF -- "$line" "$STATE/$ch" || { echo "iptables: Bad rule (stub)" >&2; exit 1; }
  grep -vxF -- "$line" "$STATE/$ch" > "$STATE/$ch.tmp"; mv "$STATE/$ch.tmp" "$STATE/$ch"; exit 0
fi
[ "$1" = "-S" ] && [ "$#" -eq 2 ] || { echo "stub: unexpected iptables invocation: $*" >&2; exit 97; }
ch=$2; key=${ch//-/_}
n=$(( $(cat "$STATE/$ch.reads" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STATE/$ch.reads"
ins=INSERT_AT_READ_$key
if [ "${!ins:-0}" = "$n" ]; then echo "-A $ch -m comment --comment agentflow-localverify -j DROP" >> "$STATE/$ch"; fi
lim=FAIL_AFTER_$key; mode=FAIL_OUTPUT_$key
if [ "$n" -gt "${!lim:-999}" ]; then
  case "${!mode:-policy}" in
    policy) echo "-P $ch ACCEPT" ;;            # partial output
    full)   cat "$STATE/$ch" ;;                 # plausible, complete-looking output
    none)   ;;
  esac
  echo "iptables: read failure (stub)" >&2; exit 1
fi
cat "$STATE/$ch"
EOF

cat > "$BIN/npx" <<'EOF'
#!/bin/bash
[ "$1 $2" = "supabase status" ] || { echo "stub: unexpected npx invocation: $*" >&2; exit 97; }
echo '{"API_URL":"http://127.0.0.1:54321","DB_URL":"postgresql://postgres:x@127.0.0.1:54322/postgres"}'
EOF
chmod +x "$BIN/timeout" "$BIN/docker" "$BIN/iptables" "$BIN/npx"
for s in docker iptables npx; do ln -s "$BIN/$s" "$INNER_NO_TIMEOUT/$s"; done

# --- sandbox integrity: stubs resolve, real network/infra tools are unreachable ------------------------
chk=$(env -i PATH="$BIN" "$BIN/bash" -c 'for c in docker iptables npx timeout; do command -v $c; done; for c in curl wget supabase ip6tables nc; do command -v $c && echo LEAK; done' 2>&1)
if printf '%s\n' "$chk" | grep -q LEAK || [ "$(printf '%s\n' "$chk" | grep -c "^$BIN/")" -ne 4 ]; then
  echo "BLOCKED: sandbox integrity check failed:"; echo "$chk"; exit 2
fi

# --- synthetic workspace (no real credentials: a locally generated demo-issuer token) ------------------
J=$(node -e 'const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");console.log(b({alg:"HS256"})+"."+b({iss:"supabase-demo",role:"anon"})+".stub")')
echo 'project_id = "agentflow-localverify"' > "$WS/supabase/config.toml"
printf '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"%s","SERVICE_ROLE_KEY":"%s"}\n' "$J" "$J" > "$WS/lv.env.json"

TAGGED_D1='-A DOCKER-USER -i br-stub ! -o br-stub -m conntrack --ctstate NEW -m comment --comment agentflow-localverify -j DROP'
TAGGED_D2='-A DOCKER-USER -o br-stub ! -i br-stub -m conntrack --ctstate NEW -m comment --comment agentflow-localverify -j DROP'
TAGGED_I1='-A INPUT -i br-stub -m conntrack --ctstate NEW -m comment --comment agentflow-localverify -j DROP'
TAGGED_I2='-A INPUT ! -i lo -p tcp -m multiport --dports 54321,54322 -m comment --comment agentflow-localverify -j DROP'
UNREL_D=$'-A DOCKER-USER -j RETURN\n-A DOCKER-USER -m comment --comment agentflow-localverify-other -j DROP'
UNREL_I=$'-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT\n-A INPUT -m comment --comment "agentflow-localverify-keep" -j DROP'
seed() {
  rm -f "$ST"/*
  printf '%s\n' "-P DOCKER-USER ACCEPT" "$TAGGED_D1" "$UNREL_D" "$TAGGED_D2" > "$ST/DOCKER-USER"
  printf '%s\n' "-P INPUT ACCEPT" "$TAGGED_I1" "$UNREL_I" "$TAGGED_I2" > "$ST/INPUT"
}
unrelated_preserved() {
  local want; for want in "-P DOCKER-USER ACCEPT" "-A DOCKER-USER -j RETURN" "-A DOCKER-USER -m comment --comment agentflow-localverify-other -j DROP"; do
    grep -qxF -- "$want" "$ST/DOCKER-USER" || return 1; done
  for want in "-P INPUT ACCEPT" "-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT" '-A INPUT -m comment --comment "agentflow-localverify-keep" -j DROP'; do
    grep -qxF -- "$want" "$ST/INPUT" || return 1; done
}

PASS=0; FAILN=0; declare -A CAT_PASS CAT_FAIL
# run_case <category> <id> <mode> <expect: ok|fail> <required substring> [VAR=value ...]
run_case() {
  local cat=$1 id=$2 mode=$3 expect=$4 needle=$5; shift 5
  seed; : > "$T/stub.log"
  local a; for a in "$@"; do [ "$a" = SEED_DROP=1 ] && grep -vxF -- "$TAGGED_I2" "$ST/INPUT" > "$ST/x" && mv "$ST/x" "$ST/INPUT"; done
  local out rc=0
  out=$(env -i PATH="$BIN" HOME="$T" STATE="$ST" STUB_LOG="$T/stub.log" INNER_PATH="$BIN" "$@" \
        "$BIN/bash" "$SCRIPT" "$mode" "$WS" 2>&1) || rc=$?
  local why=""
  if printf '%s' "$out" | grep -q "stub: unexpected"; then why="unexpected stub invocation"; fi
  if [ "$expect" = ok ]; then [ "$rc" -eq 0 ] || why="${why:+$why; }expected exit 0, got $rc"
  else [ "$rc" -ne 0 ] || why="${why:+$why; }expected non-zero exit, got 0"; fi
  printf '%s' "$out" | grep -qF -- "$needle" || why="${why:+$why; }missing output: $needle"
  if [ "$mode" = remove ] && [ "$expect" = fail ] && printf '%s' "$out" | grep -q "0 remain"; then
    why="${why:+$why; }printed successful cleanup on a failure path"; fi
  if [ "$mode" = verify ] && [ "$expect" = fail ] && printf '%s' "$out" | grep -qE "egress (probe OK|blocked: OK)"; then
    why="${why:+$why; }printed an egress success on a failure path"; fi
  if [ "$mode" = remove ] && ! unrelated_preserved; then why="${why:+$why; }unrelated rules not preserved"; fi
  # an accepted probe result must come from the real wrapper having invoked the (stubbed) timeout
  if [ "$mode" = verify ] && [ "$expect" = ok ] && ! grep -qF 'timeout 5 bash -c </dev/tcp/1.1.1.1/443' "$T/stub.log"; then
    why="${why:+$why; }probe wrapper did not invoke the timeout stub as expected"; fi
  if [ -z "$why" ]; then
    PASS=$((PASS+1)); CAT_PASS[$cat]=$(( ${CAT_PASS[$cat]:-0} + 1 )); echo "ok      [$cat] $id"
  else
    FAILN=$((FAILN+1)); CAT_FAIL[$cat]=$(( ${CAT_FAIL[$cat]:-0} + 1 )); echo "NOT OK  [$cat] $id :: $why"
    printf '%s\n' "$out" | tail -n 2 | sed 's/^/          | /'
  fi
}
REFUSED='bash: connect: Connection refused\nbash: line 1: /dev/tcp/1.1.1.1/443: Connection refused\n'
UNREACH='bash: connect: Network is unreachable\nbash: line 1: /dev/tcp/1.1.1.1/443: Network is unreachable\n'

echo "# script under test: $SCRIPT"
echo "# --- ORIGINAL: the reviewed regression cases (137/143 after PROBE_STARTED; failed final chain reads) ---"
run_case ORIGINAL "probe: docker exec exits 137 after PROBE_STARTED"   verify fail "did not complete" EXEC_MODE=die_after_start EXEC_RC=137
run_case ORIGINAL "probe: docker exec exits 143 after PROBE_STARTED"   verify fail "did not complete" EXEC_MODE=die_after_start EXEC_RC=143
run_case ORIGINAL "remove: final DOCKER-USER read fails (partial)"      remove fail "cannot read iptables chain DOCKER-USER" FAIL_AFTER_DOCKER_USER=3
run_case ORIGINAL "remove: final INPUT read fails (partial)"            remove fail "cannot read iptables chain INPUT" FAIL_AFTER_INPUT=3
run_case ORIGINAL "remove: both final reads fail (partial)"            remove fail "cannot read iptables chain" FAIL_AFTER_DOCKER_USER=3 FAIL_AFTER_INPUT=3
echo "# --- SAME-DEFECT: variants of the same two defects confirmed while planning (§11) ---"
run_case SAME-DEFECT "remove: final read fails after plausible output"    remove fail "cannot read iptables chain" FAIL_AFTER_INPUT=3 FAIL_OUTPUT_INPUT=full
run_case SAME-DEFECT "remove: final read fails with no output"            remove fail "cannot read iptables chain" FAIL_AFTER_DOCKER_USER=3 FAIL_OUTPUT_DOCKER_USER=none
run_case SAME-DEFECT "verify: both chain reads fail after full output"    verify fail "cannot read iptables chain" FAIL_AFTER_DOCKER_USER=0 FAIL_AFTER_INPUT=0 FAIL_OUTPUT_DOCKER_USER=full FAIL_OUTPUT_INPUT=full TIMEOUT_RC=124
run_case SAME-DEFECT "verify: one chain read fails (partial)"             verify fail "cannot read iptables chain INPUT" FAIL_AFTER_INPUT=0 TIMEOUT_RC=124
run_case SAME-DEFECT "probe: rc=1 with no recognised network error"      verify fail "unrecognised probe failure" TIMEOUT_RC=1

echo "# --- new result-protocol cases ---"
run_case PROTOCOL "probe: connection succeeds -> isolation failure"      verify fail "EGRESS OPEN" TIMEOUT_RC=0
run_case PROTOCOL "probe: timeout 124 -> OK, one destination only"       verify ok   "One destination only" TIMEOUT_RC=124
run_case PROTOCOL "probe: connection refused -> OK"                      verify ok   "(Connection refused)" TIMEOUT_RC=1 TIMEOUT_ERR="$REFUSED"
run_case PROTOCOL "probe: network unreachable -> OK"                     verify ok   "(Network is unreachable)" TIMEOUT_RC=1 TIMEOUT_ERR="$UNREACH"
run_case PROTOCOL "probe: rc=1 unrecognised error text"                  verify fail "unrecognised probe failure" TIMEOUT_RC=1 TIMEOUT_ERR='bash: line 1: /dev/tcp/1.1.1.1/443: Invalid argument\n'
run_case PROTOCOL "probe: rc=1 contradictory reasons"                    verify fail "contradictory probe result" TIMEOUT_RC=1 TIMEOUT_ERR='bash: connect: Connection refused\nbash: line 1: /dev/tcp/1.1.1.1/443: Network is unreachable\n'
run_case PROTOCOL "probe: timeout 124 with error text (contradictory)"   verify fail "contradictory probe result" TIMEOUT_RC=124 TIMEOUT_ERR='bash: connect: Connection refused\n'
run_case PROTOCOL "probe: inner probe killed (rc=137)"                   verify fail "unexpected probe exit (rc=137)" TIMEOUT_RC=137
run_case PROTOCOL "probe: inner probe terminated (rc=143)"               verify fail "unexpected probe exit (rc=143)" TIMEOUT_RC=143
run_case PROTOCOL "probe: missing completion (truncated output)"         verify fail "missing, incomplete or malformed" EXEC_MODE=truncate TIMEOUT_RC=124
run_case PROTOCOL "probe: start marker only, exit 0"                     verify fail "missing, incomplete or malformed" EXEC_MODE=start_only
run_case PROTOCOL "probe: malformed result line"                         verify fail "result line malformed" EXEC_MODE=mangle TIMEOUT_RC=124
run_case PROTOCOL "probe: extra result line"                             verify fail "missing, incomplete or malformed" EXEC_MODE=extra TIMEOUT_RC=1 TIMEOUT_ERR="$REFUSED"
run_case PROTOCOL "probe: docker daemon error (exit 126)"                verify fail "did not complete" EXEC_MODE=daemon_error
run_case PROTOCOL "probe: inner tooling missing (no timeout)"            verify fail "PROBE_TOOLING_MISSING timeout" INNER_PATH="$INNER_NO_TIMEOUT" TIMEOUT_RC=124
run_case PROTOCOL "verify: container not running"                        verify fail "is not running" DOCKER_RUNNING=false TIMEOUT_RC=124

echo "# --- baseline cleanup/count behaviour (expected on both versions) ---"
run_case BASELINE "remove: successful cleanup, unrelated rules kept"      remove ok   "(0 remain)"
run_case BASELINE "remove: tagged rule inserted before final recount"     remove fail "1 tagged rules remain" INSERT_AT_READ_INPUT=4
run_case BASELINE "remove: deletion-loop read fails"                      remove fail "" FAIL_AFTER_DOCKER_USER=1
run_case BASELINE "verify: only 3 tagged rules present"                   verify fail "expected 4 tagged rules, found 3" TIMEOUT_RC=124 SEED_DROP=1

echo "# summary: $PASS passed, $FAILN failed"
for c in ORIGINAL SAME-DEFECT PROTOCOL BASELINE; do echo "#   $c: ${CAT_PASS[$c]:-0} passed, ${CAT_FAIL[$c]:-0} failed"; done
[ "$FAILN" -eq 0 ]
