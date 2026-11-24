#!/usr/bin/env bash
# Rehearse an Automations V2 installation that stops after each of its seven files, inside run.sh's disposable cluster.
# Each file commits on its own. For every stopping point this checks that the CRM's own saves still work, that a file
# which fails part way leaves nothing behind, that a file applied twice changes nothing, and both ways out:
#   resume:   apply the remaining files, reach exactly the clean installation, then run the guarded full rollback and
#             reach exactly the clean rollback;
#   back out: run rollback/20261124100600_automation_v2_stopped_install.rollback.sql and get the first-release functions
#             back byte for byte, with every added observer inert, while the full rollback refuses the partial state.
#             The probe then reports the back-out with no next file, and installing the next file anyway is refused.
# After the full rollback the probe reports rolled_back, and every V2 file refuses to install again.
# Usage: install-stops.sh BASE_DATABASE   (a database nobody is connected to, holding the state V2 is installed onto)
set -euo pipefail
cd "$(dirname "$0")/../.."
db=${AUTOMATIONS_DB_CONTAINER:?disposable database container required}
: "${PGPASSWORD:?disposable postgres password required}"
[[ "$(docker inspect -f '{{index .Config.Labels "agentflow-test"}}' "$db")" == automations ]]
net=$(docker inspect -f '{{range $name, $config := .NetworkSettings.Networks}}{{$name}}{{end}}' "$db")
[[ "$(docker network inspect -f '{{.Internal}}' "$net")" == true ]]
base=${1:?base database required}
out=${AUTOMATION_UI_EVIDENCE:-/tmp/automation-ui-evidence}
mkdir -p "$out"
pg=(docker exec -i -e PGPASSWORD "$db")
files=(supabase/migrations/2026112410{00,01,02,03,04,05,06}00_automation_v2_*.sql)
[[ ${#files[@]} == 7 ]] && for file in "${files[@]}"; do [[ -f $file ]]; done
dest=$(docker exec "$db" mktemp -d /tmp/automation-install.XXXXXX)
docker exec "$db" mkdir -p "$dest/migrations/rollback" "$dest/tests" "$dest/ops"
for file in "${files[@]}"; do docker cp -q "$file" "$db:$dest/migrations/"; done
for file in supabase/migrations/rollback/20261124100600_automation_v2.rollback.sql \
    supabase/migrations/rollback/20261124100600_automation_v2_stopped_install.rollback.sql; do
  docker cp -q "$file" "$db:$dest/migrations/rollback/"
done
docker cp -q supabase/tests/automation_install_stop.sql "$db:$dest/tests/"
docker cp -q supabase/ops/automation_v2_install_state.sql "$db:$dest/ops/"
docker cp -q e2e/automations-local/install-catalog.sql "$db:$dest/"
names=(); for file in "${files[@]}"; do names+=("$(basename "$file")"); done
psql_on() { "${pg[@]}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$1" "${@:2}"; }
copy() { "${pg[@]}" createdb -U supabase_admin -O postgres -T "$1" "$2"; }
apply() { psql_on "$1" -f "$dest/migrations/$2" >/dev/null; }
catalog() { psql_on "$1" -f "$dest/install-catalog.sql"; }
state() { psql_on "$1" -At -f "$dest/ops/automation_v2_install_state.sql" | grep '^{'; }
first_release() {
  # The seventeen first-release functions V2 replaces, as digests, in a fixed order.
  psql_on "$1" -At -c "select string_agg(sig||'='||md5(pg_get_functiondef(to_regprocedure(sig))),' ' order by sig)
    from unnest(array['private.automation_block_fields(text,jsonb)','private.automation_trigger(jsonb)',
      'private.automation_editable_graph(jsonb)','private.automation_channel_issue(uuid,uuid,jsonb)',
      'private.automation_graph_issues(uuid,text,jsonb)','public.save_automation_draft(uuid,text,jsonb,bigint,bigint)',
      'public.publish_automation(uuid,bigint,bigint,jsonb)','public.automation_overlap(uuid)',
      'public.automation_session_transition(bigint,uuid)','private.automation_capture_event()',
      'private.automation_admit_event(private.automation_events,uuid)','public.automation_process_events(integer)',
      'public.automation_claim_work(integer)','public.automation_finish_node(uuid,uuid,text,text)',
      'public.automation_activity(bigint,uuid,uuid,uuid,text,timestamp with time zone,uuid)','public.automation_stop_run(uuid,bigint)',
      'public.automation_authorize_handoff(uuid,uuid,text)']) sig"
}
inert_observers() {
  # Every V2 observer that exists says it does nothing.
  psql_on "$1" -At -c "select coalesce(bool_and(position('Automations V2 was rolled back' in pg_get_functiondef(p.oid))>0),true)
    from pg_proc p where p.oid in (select to_regprocedure(s) from unnest(array['private.automation_capture_disposition()',
      'private.automation_capture_sale()','private.automation_capture_appointment_slot()',
      'private.automation_capture_appointment_outcome()','private.automation_capture_appointment_reopened()',
      'private.automation_capture_missed_inbound()','private.automation_observe_answered_call()',
      'private.automation_capture_issuance()']) s where to_regprocedure(s) is not null)"
}
crm_saves() {
  # The CRM's own saves in this state. Any observer warning fails the check.
  local log
  log=$(psql_on "$1" -f "$dest/tests/automation_install_stop.sql" 2>&1) || { echo "$log" >&2; return 1; }
  grep -q 'PASS core CRM saves' <<<"$log"
  if grep -E 'WARNING: +Automation .*(requires investigation|delayed)' <<<"$log" >&2; then return 1; fi
}
same() { # same CATALOG_A CATALOG_B WHAT
  if [[ "$1" != "$2" ]]; then
    echo "Catalog differs: $3" >&2
    diff <(printf '%s\n' "$1") <(printf '%s\n' "$2") | head -20 >&2
    exit 1
  fi
}
run_id=$$
summary=()

# The two reference points every path must land on exactly.
[[ $(state "$base") == *'"state": "not_installed"'* ]]
copy "$base" "clean_install_$run_id"
for name in "${names[@]}"; do apply "clean_install_$run_id" "$name"; done
[[ $(state "clean_install_$run_id") == *'"installed": 7'* && $(state "clean_install_$run_id") == *'"state": "installed"'* ]]
crm_saves "clean_install_$run_id"
full=$(catalog "clean_install_$run_id")
copy "clean_install_$run_id" "clean_rollback_$run_id"
psql_on "clean_rollback_$run_id" -1 -f "$dest/migrations/rollback/20261124100600_automation_v2.rollback.sql" >/dev/null 2>&1
rolled=$(catalog "clean_rollback_$run_id")
base_functions=$(first_release "$base")
[[ $(first_release "clean_rollback_$run_id") == "$base_functions" ]]
# After the full rollback the probe says so and offers no next file, and no V2 file installs again.
after=$(state "clean_rollback_$run_id")
[[ $after == *'"state": "rolled_back"'* && $after == *'"next": null'* ]]
for name in "${names[0]}" "${names[6]}"; do
  if apply "clean_rollback_$run_id" "$name" 2>/dev/null; then echo "$name installed over the full rollback" >&2; exit 1; fi
done
same "$(catalog "clean_rollback_$run_id")" "$rolled" "a refused install over the full rollback changed the catalog"
echo "Reference: a clean installation of all seven files and its guarded rollback, which restores the 17 first-release functions."

for k in 0 1 2 3 4 5 6; do
  stop="stop_${k}_$run_id"
  copy "$base" "$stop"
  for ((i = 0; i < k; i++)); do apply "$stop" "${names[$i]}"; done
  [[ $(state "$stop") == *"\"installed\": $k"* && $(state "$stop") == *'"prefix": true'* ]]
  crm_saves "$stop"
  stopped=$(catalog "$stop")
  next=${names[$k]}
  ((k == 0)) || [[ $(state "$stop") == *'"state": "stopped"'* && $(state "$stop") == *"\"next\": \"$next\""* ]]

  # The next file fails at its very end: none of it stays.
  copy "$stop" "fail_${k}_$run_id"
  docker exec "$db" sh -c "sed 's/^COMMIT;\$/DO \$x\$ BEGIN RAISE EXCEPTION '\''rehearsed stop'\''; END \$x\$;\nCOMMIT;/' '$dest/migrations/$next' > '$dest/migrations/fail-$next'"
  docker exec "$db" grep -q 'rehearsed stop' "$dest/migrations/fail-$next"
  if apply "fail_${k}_$run_id" "fail-$next" 2>/dev/null; then echo "The failing copy of $next applied" >&2; exit 1; fi
  same "$(catalog "fail_${k}_$run_id")" "$stopped" "a failure inside $next left part of it behind"

  # The last file applied, applied again by mistake: nothing changes, whether it is refused or repeats itself.
  if ((k > 0)); then
    copy "$stop" "again_${k}_$run_id"
    apply "again_${k}_$run_id" "${names[$((k - 1))]}" 2>/dev/null && again=repeated || again=refused
    same "$(catalog "again_${k}_$run_id")" "$stopped" "applying ${names[$((k - 1))]} twice changed the catalog"
  else again=none; fi

  # Resume: the remaining files reach exactly the clean installation, and the full rollback exactly the clean rollback.
  copy "$stop" "resume_${k}_$run_id"
  for ((i = k; i < 7; i++)); do apply "resume_${k}_$run_id" "${names[$i]}"; done
  same "$(catalog "resume_${k}_$run_id")" "$full" "resuming after $k files"
  crm_saves "resume_${k}_$run_id"
  psql_on "resume_${k}_$run_id" -1 -f "$dest/migrations/rollback/20261124100600_automation_v2.rollback.sql" >/dev/null 2>&1
  same "$(catalog "resume_${k}_$run_id")" "$rolled" "the full rollback after resuming from $k files"

  # Back out: the full rollback refuses a partial state; the stopped-install back-out restores the first release.
  if ((k > 0)); then
    copy "$stop" "back_${k}_$run_id"
    if psql_on "back_${k}_$run_id" -1 -f "$dest/migrations/rollback/20261124100600_automation_v2.rollback.sql" >/dev/null 2>&1; then
      echo "The full rollback accepted a partial installation of $k files" >&2; exit 1
    fi
    same "$(catalog "back_${k}_$run_id")" "$stopped" "the refused full rollback changed the catalog"
    notice=$(psql_on "back_${k}_$run_id" -1 -f "$dest/migrations/rollback/20261124100600_automation_v2_stopped_install.rollback.sql" 2>&1)
    grep -q "back-out: $k of seven files were installed" <<<"$notice"
    [[ $(first_release "back_${k}_$run_id") == "$base_functions" ]]
    [[ $(inert_observers "back_${k}_$run_id") == t ]]
    crm_saves "back_${k}_$run_id"
    # A second back-out is refused as drift and changes nothing.
    backed=$(catalog "back_${k}_$run_id")
    if psql_on "back_${k}_$run_id" -1 -f "$dest/migrations/rollback/20261124100600_automation_v2_stopped_install.rollback.sql" >/dev/null 2>&1; then
      echo "A second back-out after $k files was accepted" >&2; exit 1
    fi
    same "$(catalog "back_${k}_$run_id")" "$backed" "a refused second back-out changed the catalog"
    # The probe reports the back-out and offers no next file. Installing the next file anyway is refused.
    after=$(state "back_${k}_$run_id")
    [[ $after == *'"state": "backed_out"'* && $after == *'"next": null'* ]]
    if apply "back_${k}_$run_id" "$next" 2>/dev/null; then echo "$next installed over a back-out after $k files" >&2; exit 1; fi
    same "$(catalog "back_${k}_$run_id")" "$backed" "a refused install over a back-out changed the catalog"
    backout=restored
  else backout=nothing-installed; fi
  echo "PASS stopped after $k of 7 ($next next): CRM saves work; a failure inside $next left nothing; re-applying the last file $again and changed nothing; resuming reached the clean installation and its rollback; backing out: $backout."
  summary+=("{\"installed\":$k,\"next\":\"$next\",\"crm_saves\":\"pass\",\"failed_next_file_left_nothing\":true,\"reapply_last\":\"$again\",\"resume\":\"matches clean install and rollback\",\"back_out\":\"$backout\",\"after_back_out\":\"$([[ $backout == restored ]] && echo 'probe backed_out, next file refused' || echo none)\"}")
done

# Every file installed: the back-out sends the operator to the full rollback.
if refused=$(psql_on "clean_install_$run_id" -1 -f "$dest/migrations/rollback/20261124100600_automation_v2_stopped_install.rollback.sql" 2>&1); then
  echo 'The stopped-install back-out accepted a complete installation' >&2; exit 1
fi
grep -q 'all seven files are installed, use 20261124100600_automation_v2.rollback.sql' <<<"$refused"
same "$(catalog "clean_install_$run_id")" "$full" "the refused back-out changed a complete installation"
printf '{"result":"pass","base":"%s","after_full_rollback":"probe rolled_back, files refused","stops":[%s]}\n' "$base" "$(IFS=,; echo "${summary[*]}")" > "$out/automations-v2-install-stops.json"
echo 'PASS installation stops: after each of 0-6 files, resuming reaches the clean installation and its rollback, and backing out restores the first release; after a back-out or the full rollback the probe says so and no V2 file installs again.'
