"""Protected Gate G runner; importing this module performs no live operation."""
import hashlib
import json
import os
import re
import google_sheets_pilot_release as pilot

ROOT = pilot.ROOT
PLAN = pilot.PLAN
STAGES = ('check', 'activate', 'verify', 'stop-monitoring')


def dispatch_gate(d):
    stage = os.environ.get('STAGE')
    d.require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'main only')
    d.require(stage in STAGES and os.environ.get('CONFIRM') == stage, 'exact stage confirmation')
    sha = os.environ.get('REVIEWED_SHA', '')
    d.require(bool(re.fullmatch('[0-9a-f]{40}', sha)) and sha == os.environ.get('GITHUB_SHA')
              and d.command(['git', 'rev-parse', 'HEAD']) == sha, 'exact reviewed commit')
    return stage


def run_stage(d, stage, env):
    if stage == 'stop-monitoring':
        pilot.run_stage(d, stage, env)
        return
    d.readbacks(env)
    inventory = pilot.credentials(d, env)
    d.require(inventory.get(d.KILL_SWITCH) == hashlib.sha256(b'true').hexdigest(), 'processing enabled')
    live = d.inventory()
    for name, digest in json.loads((PLAN / 'gate-e-edge-baseline.json').read_text()).items():
        item = live.get(name, {})
        d.require(item.get('status') == 'ACTIVE' and item.get('verify_jwt') is False
                  and item.get('ezbr_sha256') == digest, name + ' unchanged')
    pilot.cron(d, env, True)
    pilot.history(d, env, True)
    pilot.originals(d, env)
    mode = 'on' if stage == 'verify' else 'pilot'
    d.require(d.sql("select concat_ws('|',mode,max_concurrent_jobs,renew_before_s,renew_overlap_s,late_grace_s) from private.google_sheets_push_config", env)
              == mode + '|4|10800|900|3600', 'mode and unchanged limits')
    if stage in ('check', 'activate'):
        d.require(d.sql((ROOT / 'supabase/ops/google_sheets_rollout_preflight.sql').read_text(), env) == 't', 'fixed rollout preflight')
    if stage == 'activate':
        d.require(os.environ.get('RELEASE_DECISION') == 'accept-natural-cycle-and-quota-deferral', 'explicit release exceptions accepted')
        d.require(os.environ.get('DISCLOSURES_LIVE') == 'verified', 'operator verified production disclosures')
        d.apply(env, ROOT / 'supabase/ops/google_sheets_rollout_enable.sql')
        d.require(d.sql("select mode from private.google_sheets_push_config", env) == 'on', 'general availability on')
        pilot.originals(d, env)
    if stage == 'verify':
        d.require(d.sql("""select not exists (
          select 1 from public.google_sheets_sources s join public.google_sheets_connections c on c.id=s.connection_id
          where s.state='enabled' and s.health in ('ok','error') and c.status='connected' and c.has_refresh_token
          and s.user_id=c.user_id and s.organization_id=c.organization_id
          and private.google_sheets_owner_eligible(s.user_id,s.organization_id)
          and not exists(select 1 from private.google_sheets_watch_channels w where w.connection_id=c.id
            and w.spreadsheet_id=s.spreadsheet_id and w.auth_generation=c.auth_generation
            and w.state='active' and w.activated_at is not null and w.expires_at>now()))""", env) == 't', 'all eligible sources covered')
        d.require(d.sql('select count(*) from private.google_sheets_watch_targets where requested_seq>processed_seq', env) == '0', 'queue settled')


def main():
    d = pilot.load_helpers()
    try:
        stage = dispatch_gate(d)
        pilot.files_gate(d)
        for path, digest in json.loads((PLAN / 'gate-g-checksums.json').read_text()).items():
            d.require(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, 'checksum ' + path)
        env = d.connection_env()
        d.identity(env)
        run_stage(d, stage, env)
    except BaseException:
        print('STOP: inspect production independently; no automatic retry or secret-bearing error output.', flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
