"""Gate E runner. Dispatch only; no credentials or live operations during import/tests.

Reuse the byte-pinned Gate D helpers without executing its main. No credential
rotation, function deployment, spreadsheet write, or general-purpose SQL input.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import textwrap
import types

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/plans/2026-10-25-google-sheets-realtime-sync"
SOURCE = "2a9ce6b6-0500-454d-8c46-48dfab8042b5"
ORG = "a0000000-0000-0000-0000-000000000001"
VERSION = "20261025120100"
NAME = "google_sheets_push_maintenance_schedule"
JOB = "google-sheets-push-maintenance-every-minute"
SCHEDULE = "supabase/migrations/pending/" + VERSION + "_" + NAME + ".sql"
STAGES = ("check", "schedule-maintenance", "record-schedule", "activate-pilot",
          "verify-active", "pause-processing", "resume-processing", "renewal-window",
          "restore-renewal-window", "stop-monitoring", "finish-rollback")


def load_helpers():
    path = ROOT / ".github/workflows/google-sheets-push-release.yml"
    manifest = json.loads((PLAN / "gate-e-checksums.json").read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest[str(path.relative_to(ROOT))]:
        raise RuntimeError("Gate D helper checksum mismatch")
    body = path.read_text().split("python3 - <<'PYCODE'\n", 1)[1].rsplit("          PYCODE", 1)[0]
    module = types.ModuleType("gate_d_helpers")
    exec(compile(textwrap.dedent(body), str(path), "exec"), module.__dict__)
    return module


def files_gate(d):
    for name, digest in json.loads((PLAN / "gate-e-checksums.json").read_text()).items():
        d.require(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, "checksum " + name)


def baseline_query():
    b = json.loads((PLAN / "gate-e-baseline.json").read_text())
    # Fixed ids, not a moving receipt/date selection; deleted originals fail too.
    clauses = []
    for row in b["leads"]:
        clauses.append(f"(select count(*)=1 and bool_and(md5(l::text)='{row['md5']}') from public.leads l where id='{row['id']}')")
    for table, key, rows in (("google_sheets_receipts", "receipt_key", b["receipts"]),
                             ("google_sheets_source_rows", "row_key", b["ledger"])):
        for row in rows:
            clauses.append(f"(select count(*)=1 and bool_and(md5(r::text)='{row['md5']}') from private.{table} r where source_id='{SOURCE}' and {key}='{row['key']}')")
    return "select " + " and ".join(clauses)


def originals(d, env):
    d.require(d.sql(baseline_query(), env) == "t", "all original lead columns, receipts and ledger rows unchanged")


def history(d, env, scheduled):
    expected = VERSION + "|348" if scheduled else "20261025120000|347"
    d.require(d.sql("select max(version)||'|'||count(*) from supabase_migrations.schema_migrations", env) == expected,
              "exact hosted migration head and row count")
    d.require(d.sql("select name||'|'||cardinality(statements)||'|'||encode(sha256(convert_to(array_to_string(statements,E'\\n;\\n'),'UTF8')),'hex') from supabase_migrations.schema_migrations where version='20261025120000'", env)
              == "google_sheets_push_sync|57|0561e767049e118b1cf53d9e51e2ec69a8eab5069bee82592e724535db5b79ff", "Gate D history unchanged")
    if scheduled:
        row = json.loads(d.sql(f"select json_build_object('name',name,'statements',statements) from supabase_migrations.schema_migrations where version='{VERSION}'", env))
        def normalize(s):
            return re.sub(r"(?m)^\s*--[^\n]*\n?", "", s).strip().rstrip(";").strip()
        d.require(row["name"] == NAME and len(row["statements"]) == 1 and
                  normalize(row["statements"][0]) == normalize((ROOT / SCHEDULE).read_text()), "exact maintenance history statement")


def cron(d, env, present):
    rows = json.loads(d.sql("select coalesce(json_agg(json_build_object('name',jobname,'schedule',schedule,'command',command,'active',active,'database',database,'username',username)), '[]') from cron.job where jobname like 'google-sheets%' or command like '%google-sheets%'", env))
    if not present:
        d.require(rows == [], "no Sheets cron (including polling)")
        return
    expected = (ROOT / SCHEDULE).read_text().split("$job$", 2)[1]
    d.require(len(rows) == 1 and rows[0] == dict(name=JOB, schedule="* * * * *", command=expected,
               active=True, database="postgres", username="postgres"), "exact guarded maintenance job; no polling")


def pristine(d, env, inventory, scheduled=False, recorded=False):
    d.require(d.sql("select count(*) from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid() and (state='idle in transaction' or xact_start < clock_timestamp()-interval '30 seconds')", env) == "0",
              "no long client transaction")
    d.require(d.sql("select count(*) from net.http_request_queue where url like '%/functions/v1/google-sheets%'", env) == "0",
              "no queued Sheets HTTP request")
    d.require(d.KILL_SWITCH not in inventory, "push Edge flag absent")
    d.require(d.sql("select concat_ws('|',mode,max_concurrent_jobs,renew_before_s,renew_overlap_s,late_grace_s) from private.google_sheets_push_config", env)
              == "off|4|10800|900|3600", "push off with reviewed defaults")
    for table in d.PUSH_TABLES:
        d.require(d.sql(f"select count(*) from private.{table}", env) == "0", table + " empty")
    cron(d, env, scheduled)
    history(d, env, recorded)
    originals(d, env)
    d.require(d.data_fingerprint(env) == "1|1|3|3|3|2|98aae47446d6778fb467f78b78023b3f", "Gate D data fingerprint")
    d.require(d.sql(f"""select count(*)=1 and bool_and(s.state='enabled' and s.health='ok' and s.phase='steady'
        and s.config_version=2 and s.organization_id='{ORG}' and c.status='connected' and c.auth_generation=1
        and c.has_refresh_token and private.google_sheets_owner_eligible(s.user_id,s.organization_id))
        from public.google_sheets_sources s join public.google_sheets_connections c on c.id=s.connection_id
        where s.id='{SOURCE}'""", env) == "t", "Pilot B identity, owner eligibility and connection")


def credentials(d, env):
    inventory = d.secret_inventory()
    d.require(d.B1_SECRETS <= set(inventory), "foundation credentials present")
    d.require(d.credential_state(env, inventory)[0] == "configured", "fresh Edge digests match verified Vault marker")
    # Platform reports SHA-256 of values, verified during Gate D configuration.
    d.require(inventory.get("GOOGLE_SHEETS_ENABLED") == hashlib.sha256(b"true").hexdigest(), "foundation Edge flag true")
    return inventory


def active(d, env, renew=10800):
    d.require(d.sql("select concat_ws('|',mode,max_concurrent_jobs,renew_before_s,renew_overlap_s,late_grace_s) from private.google_sheets_push_config", env)
              == f"pilot|4|{renew}|900|3600", "pilot mode and reviewed limits")
    d.require(d.sql(f"select count(*)=1 and bool_and(source_id='{SOURCE}' and organization_id='{ORG}') from private.google_sheets_push_pilot_sources", env) == "t",
              "exactly Pilot B allowlisted")
    cron(d, env, True)
    history(d, env, True)
    originals(d, env)


def run_stage(d, stage, env):
    # Emergency stop does not depend on a good credential marker or unchanged lead:
    # those might be the reason for rolling back.
    if stage == "stop-monitoring":
        d.apply(env, ROOT / "supabase/ops/google_sheets_push_stop_all.sql")
        d.require(d.sql("select mode from private.google_sheets_push_config", env) == "off", "admission mode off")
        print("STOP: retain maintenance until Google channel stops complete; independently verify drain.")
        return
    if stage == "finish-rollback":
        d.require(d.sql("select mode from private.google_sheets_push_config", env) == "off", "mode off before unschedule")
        d.require(d.sql("select count(*) from private.google_sheets_watch_channels where state in ('registering','active','stopping')", env) == "0",
                  "all known channels terminal before unschedule")
        d.apply(env, ROOT / "supabase/ops/google_sheets_push_unschedule.sql")
        if d.KILL_SWITCH in d.secret_inventory():
            d.management("secrets", "DELETE", [d.KILL_SWITCH])
        d.require(d.KILL_SWITCH not in d.secret_inventory(), "push Edge flag absent")
        cron(d, env, False)
        print("STOP: verify no queued work and stable markers twice, two minutes apart; leases are not drain proof.")
        return
    d.readbacks(env)
    inventory = credentials(d, env)
    live = d.inventory()
    expected = json.loads((PLAN / "gate-e-edge-baseline.json").read_text())
    for name, digest in expected.items():
        item = live.get(name, {})
        d.require(item.get("status") == "ACTIVE" and item.get("verify_jwt") is False and item.get("ezbr_sha256") == digest, name + " deployed bundle unchanged")
    if stage in ("pause-processing", "resume-processing", "renewal-window", "restore-renewal-window"):
        active(d, env, renew=82800 if stage == "restore-renewal-window" else 10800)
        if stage == "pause-processing":
            d.require(inventory.get(d.KILL_SWITCH) == hashlib.sha256(b"true").hexdigest(), "processing on before pause")
            d.management("secrets", "DELETE", [d.KILL_SWITCH])
            d.require(d.KILL_SWITCH not in d.secret_inventory(), "processing paused; authenticated notifications still queue")
        elif stage == "resume-processing":
            d.require(d.KILL_SWITCH not in inventory, "processing paused before resume")
            d.management("secrets", "POST", [{"name": d.KILL_SWITCH, "value": "true"}])
            d.require(d.secret_inventory().get(d.KILL_SWITCH) == hashlib.sha256(b"true").hexdigest(), "processing resumed")
        else:
            d.require(inventory.get(d.KILL_SWITCH) == hashlib.sha256(b"true").hexdigest(), "processing on for renewal drill")
            d.apply(env, ROOT / ("supabase/ops/google_sheets_pilot_" +
                                ("renewal_window.sql" if stage == "renewal-window" else "restore_renewal_window.sql")))
            active(d, env, renew=82800 if stage == "renewal-window" else 10800)
        return
    if stage == "verify-active":
        active(d, env)
        d.require(inventory.get(d.KILL_SWITCH) == hashlib.sha256(b"true").hexdigest(), "push Edge flag true")
        d.require(d.sql(f"""select count(*)>=1 from private.google_sheets_watch_channels w
          join public.google_sheets_sources s on s.connection_id=w.connection_id and s.spreadsheet_id=w.spreadsheet_id
          join public.google_sheets_connections c on c.id=w.connection_id
          where s.id='{SOURCE}' and w.state='active' and w.activated_at is not null and w.expires_at>now()
          and w.auth_generation=c.auth_generation""", env) == "t", "Google-confirmed unexpired Pilot B channel")
        return
    pristine(d, env, inventory, scheduled=stage in ("record-schedule", "activate-pilot"), recorded=stage == "activate-pilot")
    if stage == "check":
        return
    if stage == "schedule-maintenance":
        d.require(VERSION > "20261025120000", "maintenance version follows hosted head")
        d.apply(env, ROOT / SCHEDULE)
        cron(d, env, True)
        pristine(d, env, d.secret_inventory(), scheduled=True)
    elif stage == "record-schedule":
        d.require(d.command(["supabase", "--version"]) == "2.121.0", "pinned CLI")
        d.require("--db-url" in d.command(["supabase", "migration", "repair", "--help"]), "documented history-only repair flag")
        # Stage only this existing pending file; repair records history, never executes SQL.
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "supabase/migrations"
            folder.mkdir(parents=True)
            (folder / Path(SCHEDULE).name).write_bytes((ROOT / SCHEDULE).read_bytes())
            d.command(["supabase", "migration", "repair", VERSION, "--status", "applied", "--db-url", d.db_url(env)],
                      {k: v for k, v in os.environ.items() if not k.startswith(("PG", "SUPABASE_"))}, timeout=120, cwd=tmp)
        pristine(d, env, d.secret_inventory(), scheduled=True, recorded=True)
    elif stage == "activate-pilot":
        d.apply(env, ROOT / "supabase/ops/google_sheets_push_pilot_enable.sql")
        # Flag is last: database scope is proven before Edge processing is enabled.
        active(d, env)
        d.management("secrets", "POST", [{"name": d.KILL_SWITCH, "value": "true"}])
        after = credentials(d, env)
        d.require(after.get(d.KILL_SWITCH) == hashlib.sha256(b"true").hexdigest(), "push Edge flag true")
        d.require(all(after.get(k) == v for k, v in inventory.items()), "all existing Edge secrets unchanged")
        active(d, env)
        print("STOP: await confirmed channel and initial catch-up; no synthetic lead is authorized by this stage.")
    else:
        raise d.Stop("unknown stage")


def main():
    d = load_helpers()
    try:
        stage = os.environ.get("STAGE")
        d.require(os.environ.get("GITHUB_REF") == "refs/heads/main", "main only")
        d.require(stage in STAGES and os.environ.get("CONFIRM") == stage, "exact stage confirmation")
        sha = os.environ.get("REVIEWED_SHA", "")
        d.require(bool(re.fullmatch("[0-9a-f]{40}", sha)) and sha == os.environ.get("GITHUB_SHA")
                  and d.command(["git", "rev-parse", "HEAD"]) == sha, "exact reviewed dispatch commit")
        files_gate(d)
        env = d.connection_env()
        d.identity(env)
        run_stage(d, stage, env)
    except d.Stop as error:
        print("STOP: " + str(error) + "; no automatic retry or next stage.", flush=True)
        raise SystemExit(1)
    except BaseException:
        print("STOP: execution failed; inspect production independently. No exception body or automatic retry.", flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
