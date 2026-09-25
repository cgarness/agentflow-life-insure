#!/usr/bin/env bash
# TEST-ONLY isolation controls and locality proofs for the LOCAL verification (implementation_plan.md §10).
#   isolation.sh apply  <ws>  — server-side isolation rules for the local stack's Docker network
#   isolation.sh verify <ws>  — locality assertions (keys, endpoints, rules, DB-side HTTP/cron, container egress)
#   isolation.sh remove <ws>  — remove ONLY the rules this script added (exact comment tag)
# Every check FAILS CLOSED: a check that cannot run is reported as FAIL, never as OK.
# Hardened after the recorded 2026-09-24 run (see evidence/INDEX.md): the recorded run used the earlier
# version of this script, whose output is transcribed in evidence/SESSION_RECORDS.md R3.
# 2026-09-24 (America/Los_Angeles) failure-handling fix (implementation_plan.md §11): checked chain reads
# (count_tagged) and a validated egress-probe envelope. Offline tests: tests/isolation.test.sh.
set -euo pipefail
MODE=${1:?mode}; WS=${2:?workspace}
NET=supabase_network_agentflow-localverify
DB=supabase_db_agentflow-localverify
TAG=agentflow-localverify
PROD_REF=jncvvsvckxhqgqvkppmj
fail() { echo "FAIL: $*" >&2; exit 1; }
TAG_RE="--comment \"?${TAG}\"? -j DROP"

# Reads each chain separately. A read that exits non-zero FAILS, even if it printed (partial or plausible)
# output. Only successfully captured output is counted or displayed. Sets TAGGED and TAGGED_LINES.
count_tagged() {
  TAGGED=0; TAGGED_LINES=""
  local chain out c m
  for chain in DOCKER-USER INPUT; do
    if ! out=$(LC_ALL=C iptables -S "$chain" 2>&1); then
      fail "cannot read iptables chain $chain (read failed; any partial output ignored)"
    fi
    c=$(printf '%s\n' "$out" | grep -cE -- "$TAG_RE") || [ "$?" -eq 1 ] || fail "cannot count tagged rules in $chain"
    case "$c" in ''|*[!0-9]*) fail "invalid tagged-rule count for $chain: '$c'" ;; esac
    TAGGED=$((TAGGED + c))
    if [ "$c" -gt 0 ]; then
      m=$(printf '%s\n' "$out" | grep -E -- "$TAG_RE") || fail "cannot list tagged rules in $chain"
      TAGGED_LINES="${TAGGED_LINES}${m}"$'\n'
    fi
  done
}

# Egress probe, run inside the DB container. It only REPORTS: the raw inner exit code plus a sanitised,
# single-line error text in a fixed envelope. All classification happens on the host (verify). Any failure
# while producing the envelope exits non-zero, so it can never be read as a network result.
PROBE_SCRIPT='export LC_ALL=C
for t in bash timeout tr cut; do command -v "$t" >/dev/null 2>&1 || { echo "PROBE_TOOLING_MISSING $t"; exit 98; }; done
echo PROBE_STARTED || exit 96
err=$(timeout 5 bash -c "</dev/tcp/1.1.1.1/443" 2>&1)
prc=$?
clean=$(printf "%s" "$err" | tr -c "[:alnum:] .:/_-" " " | cut -c1-160) || exit 96
printf "PROBE_RESULT rc=%s err=%s\n" "$prc" "$clean" || exit 96
echo PROBE_END || exit 96'
REASONS='Connection refused|Network is unreachable|No route to host|Connection timed out'

bridge() {
  local id
  id=$(docker network inspect -f '{{.Id}}' "$NET" 2>/dev/null) || fail "docker network $NET not found"
  [ -n "$id" ] || fail "docker network $NET has no id"
  local br="br-${id:0:12}"
  [ -e "/sys/class/net/$br" ] || fail "bridge interface $br does not exist"
  echo "$br"
}

case "$MODE" in
apply)
  # These rules are IPv4 only. Refuse on an IPv6-capable kernel rather than leave [::] listeners open.
  [ -d /proc/sys/net/ipv6 ] && fail "kernel has IPv6: add ip6tables equivalents before using this script"
  BR=$(bridge)
  # Containers on the stack network may talk to each other only. NEW flows leaving the bridge
  # (internet or other networks) are dropped in FORWARD; NEW flows from the bridge into host
  # services (INPUT) are dropped too. Loopback published ports (docker-proxy) are unaffected.
  iptables -I DOCKER-USER 1 -i "$BR" ! -o "$BR" -m conntrack --ctstate NEW -m comment --comment "$TAG" -j DROP
  iptables -I INPUT 1 -i "$BR" -m conntrack --ctstate NEW -m comment --comment "$TAG" -j DROP
  # Ingress: the CLI publishes 54321 (API gateway) and 54322 (DB) on 0.0.0.0 via docker-proxy
  # (INPUT path) and DNAT (FORWARD path). Only loopback clients may reach them.
  iptables -I INPUT 1 ! -i lo -p tcp -m multiport --dports 54321,54322 -m comment --comment "$TAG" -j DROP
  iptables -I DOCKER-USER 1 -o "$BR" ! -i "$BR" -m conntrack --ctstate NEW -m comment --comment "$TAG" -j DROP
  count_tagged
  [ "$TAGGED" -eq 4 ] || fail "expected 4 tagged rules, found $TAGGED"
  printf '%s' "$TAGGED_LINES"
  ;;
remove)
  for chain in DOCKER-USER INPUT; do
    while true; do
      # capture first (no SIGPIPE from an early-exiting grep); a failed read stops removal explicitly
      rules=$(LC_ALL=C iptables -S "$chain") || fail "cannot read iptables chain $chain during removal"
      rule=$(printf '%s\n' "$rules" | grep -E -- "--comment \"?$TAG\"? -j DROP" | head -n1 || true)
      [ -n "$rule" ] || break
      eval "iptables ${rule/-A/-D}"
    done
  done
  count_tagged                              # every required chain read must succeed
  [ "$TAGGED" -eq 0 ] || fail "$TAGGED tagged rules remain"
  echo "removed $TAG rules (0 remain)"
  ;;
verify)
  echo "== keys and URLs in $WS/lv.env.json (must be loopback + local demo issuer)"
  [ -f "$WS/lv.env.json" ] || fail "missing $WS/lv.env.json"
  node -e '
    const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(e.API_URL)) { console.error("FAIL: API_URL " + e.API_URL); process.exit(1); }
    for (const k of ["ANON_KEY", "SERVICE_ROLE_KEY"]) {
      const iss = JSON.parse(Buffer.from(e[k].split(".")[1], "base64url").toString()).iss;
      if (iss !== "supabase-demo") { console.error("FAIL: " + k + " issuer " + iss); process.exit(1); }
    }
    console.log("API_URL " + e.API_URL + "; ANON_KEY and SERVICE_ROLE_KEY issuer supabase-demo: OK");
  ' "$WS/lv.env.json"
  echo "== supabase status URLs (every *_URL must be 127.0.0.1)"
  (cd "$(dirname "$0")/../.." && npx supabase status --workdir "$WS" -o json 2>/dev/null) | node -e '
    const s = JSON.parse(require("fs").readFileSync(0, "utf8")); let bad = 0;
    for (const [k, v] of Object.entries(s)) if (k.endsWith("URL")) {
      const ok = /^(https?|postgresql|wss?):\/\/([^@]*@)?127\.0\.0\.1[:/]/.test(v); if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} ${k} = ${v.replace(/\/\/[^@]*@/, "//<user>@")}`);
    }
    process.exit(bad ? 1 : 0);
  ' || fail "non-loopback status URL"
  echo "== ingress/egress rules present (published ports reachable from loopback only)"
  count_tagged
  [ "$TAGGED" -eq 4 ] || fail "expected 4 tagged rules, found $TAGGED"
  echo "4 tagged rules: OK"; docker ps --filter "network=$NET" --format '{{.Names}}\t{{.Ports}}'
  echo "== production ref absent from workspace config.toml and lv.env.json"
  for f in "$WS/supabase/config.toml" "$WS/lv.env.json"; do
    [ -f "$f" ] || fail "missing $f"
    grc=0; grep -q -- "$PROD_REF" "$f" || grc=$?
    [ "$grc" -eq 1 ] || fail "production ref found in $f, or $f unreadable (grep rc=$grc)"
  done
  echo "absent: OK (the copied migration files mention the ref in comments only; they are not config)"
  echo "== DB-side outbound HTTP + schedulers (asserted: empty config URLs, no HTTP-calling cron job, empty queue)"
  [ "$(docker inspect -f '{{.State.Running}}' "$DB" 2>/dev/null)" = "true" ] || fail "container $DB is not running"
  docker exec -i "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 <<'SQL' || fail "DB assertions failed or could not run"
select 'cron.job rows='||count(*) from cron.job;
select 'net.http_request_queue rows='||count(*) from net.http_request_queue;
select 'net._http_response rows='||count(*) from net._http_response;
select 'workflow config url='||coalesce(nullif((select supabase_url from private.workflow_engine_config limit 1),''),'<empty>');
select 'twilio provisioning url='||coalesce(nullif((select supabase_url from private.twilio_provisioning_config limit 1),''),'<empty>');
DO $$
BEGIN
  IF (SELECT count(*) FROM net.http_request_queue) > 0 THEN RAISE EXCEPTION 'net.http_request_queue is not empty'; END IF;
  IF coalesce((SELECT supabase_url FROM private.workflow_engine_config LIMIT 1), '') <> '' THEN
    RAISE EXCEPTION 'workflow_engine_config.supabase_url is set'; END IF;
  IF coalesce((SELECT supabase_url FROM private.twilio_provisioning_config LIMIT 1), '') <> '' THEN
    RAISE EXCEPTION 'twilio_provisioning_config.supabase_url is set'; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ~* 'net\.http|http_(post|get)') THEN
    RAISE EXCEPTION 'a cron job calls HTTP directly'; END IF;
END $$;
select 'DB-side assertions: OK';
SQL
  echo "== container egress probe (one destination: 1.1.1.1:443; validated result envelope)"
  rc=0
  out=$(docker exec "$DB" sh -c "$PROBE_SCRIPT" 2>&1) || rc=$?
  diag=$(printf '%s' "$out" | LC_ALL=C tr -c '[:alnum:] .:/_=-' ' ' | cut -c1-240)
  # docker exec failure (interrupted, killed, tooling) is never a network result
  [ "$rc" -eq 0 ] || fail "egress probe did not complete (docker exec rc=$rc: interrupted, killed or tooling failure); output: $diag"
  mapfile -t lines <<< "$out"
  if [ "${#lines[@]}" -ne 3 ] || [ "${lines[0]}" != "PROBE_STARTED" ] || [ "${lines[2]}" != "PROBE_END" ]; then
    fail "egress probe result missing, incomplete or malformed; output: $diag"
  fi
  re='^PROBE_RESULT rc=([0-9]{1,3}) err=([[:alnum:] .:/_-]*)$'
  [[ ${lines[1]} =~ $re ]] || fail "egress probe result line malformed; output: $diag"
  prc=${BASH_REMATCH[1]}; perr=${BASH_REMATCH[2]}
  perr=${perr%"${perr##*[! ]}"}            # trim trailing spaces
  case "$prc" in
    0) fail "EGRESS OPEN: the DB container connected to 1.1.1.1:443" ;;
    124)
      [ -z "$perr" ] || fail "contradictory probe result: timeout (rc=124) with error text: $perr"
      reason="no connection within 5 s (timeout)" ;;
    1)
      conn_re="^(bash: (line [0-9]+: )?(connect|/dev/tcp/1[.]1[.]1[.]1/443): ($REASONS) ?)+$"
      [[ "$perr " =~ $conn_re ]] || fail "unrecognised probe failure (rc=1): $perr"
      reasons=$(printf '%s\n' "$perr" | grep -oE "$REASONS" | sort -u) || fail "cannot parse probe reason: $perr"
      [ "$(printf '%s\n' "$reasons" | grep -c .)" -eq 1 ] || fail "contradictory probe result (different reasons): $perr"
      reason="$reasons" ;;
    *) fail "unexpected probe exit (rc=$prc), not a recognised network outcome: $perr" ;;
  esac
  echo "egress probe OK: 1.1.1.1:443 not reachable from the DB container ($reason)."
  echo "  One destination only: this does not prove that all egress is blocked, or which control blocked it."
  ;;
*) fail "unknown mode $MODE" ;;
esac
