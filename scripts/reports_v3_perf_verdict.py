#!/usr/bin/env python3
"""Reports v3 performance verdicts (Batch 7, Phase E): validate runs of scripts/run_reports_v3_perf_acceptance.sh.

  check DIR                      one acceptance run: PASS only if it is acceptance-eligible and every check holds
  negative-control DIR           the negative-control run failed exactly as planted (and its gate controls bit)
  aggregate [--sha SHA] DIR...   at least two independent acceptance runs of the same commit; all must pass (no
                                 best-of selection); prints every run's p95 per combination and writes aggregate.json

DIR is a run's evidence directory (the one holding verdicts.json, environment.json, seal.txt and manifest.json).
Exit status 0 means the claim holds; anything else means it does not. Nothing here measures anything.
"""
import hashlib
import json
import os
import sys

FIXTURE = {'calls': 500000, 'clients': 5000, 'policy_objects': 10000, 'sale_events': 10000, 'buyers': 5000,
           'appointments': 10000}
CONTROLS = {'passing synthetic plan', 'p95 over target', 'missing measured sample', 'measured timeout', 'warm-up timeout',
            'first-after-restart timeout', 'missing combination', 'missing warm-up', 'missing restart round',
            'unexpected reader error', 'acceptance eligibility'}
COMBINATIONS = 147
MIN_SAMPLES = 20


def load(run_dir, name):
    path = os.path.join(run_dir, name)
    with open(path, encoding='utf-8') as fh:
        return json.load(fh) if name.endswith('.json') else fh.read()


def manifest_ok(run_dir, problems):
    try:
        manifest = load(run_dir, 'manifest.json')
    except (OSError, ValueError) as exc:
        problems.append(f'manifest unreadable: {exc}')
        return None
    for name, digest in manifest.get('files', {}).items():
        try:
            actual = hashlib.sha256(open(os.path.join(run_dir, name), 'rb').read()).hexdigest()
        except OSError:
            problems.append(f'manifest lists a missing file: {name}')
            continue
        if actual != digest:
            problems.append(f'evidence file changed after the run: {name}')
    return manifest


def check_acceptance(run_dir):
    problems = []
    manifest = manifest_ok(run_dir, problems)
    try:
        v = load(run_dir, 'verdicts.json')
        env = load(run_dir, 'environment.json')
        seal = load(run_dir, 'seal.txt')
    except (OSError, ValueError) as exc:
        return [f'evidence unreadable: {exc}'], None, None
    if manifest is not None and manifest.get('exit_code') != 0:
        problems.append(f"the run exited {manifest.get('exit_code')} at stage {manifest.get('last_stage')}")
    if v.get('mode') != 'acceptance':
        problems.append(f"mode is {v.get('mode')}, not acceptance (diagnostic and report-only runs never satisfy acceptance)")
    if v.get('acceptance_eligible') is not True:
        problems.append('the run is not acceptance-eligible')
    if v.get('enforce') is not True:
        problems.append('the gate was not enforced')
    if v.get('verdict') != 'PASS':
        problems.append(f"verdict {v.get('verdict')}")
    if v.get('seal') != 'verified' or 'seal verified' not in seal:
        problems.append('the seal was not verified after the run')
    server = v.get('server', {})
    if server.get('server_version_num') != 170006:
        problems.append(f"server_version_num {server.get('server_version_num')}, not 170006 (PostgreSQL 17.6)")
    fixture = v.get('fixture', {})
    for key, want in FIXTURE.items():
        if fixture.get(key) != want:
            problems.append(f'fixture {key} = {fixture.get(key)}, required {want}')
    params = v.get('parameters', {})
    samples = params.get('samples') or 0
    if samples < MIN_SAMPLES:
        problems.append(f'{samples} measured samples per combination, at least {MIN_SAMPLES} required')
    if params.get('restart_round') != 'first-after-restart':
        problems.append('no first-after-restart round')
    if params.get('injected_delay_ms') is not None:
        problems.append('a delay was injected: this is not an acceptance run')
    combos = v.get('combinations') or []
    if len(combos) != COMBINATIONS or params.get('planned_combinations') != COMBINATIONS:
        problems.append(f'{len(combos)} combinations reported, {COMBINATIONS} required')
    for c in combos:
        label = f"{c.get('reader')}/{c.get('combo')}"
        if c.get('verdict') != 'PASS':
            problems.append(f"{label}: {c.get('reason')}")
        if c.get('samples') != samples:
            problems.append(f"{label}: {c.get('samples')} samples")
        if not (c.get('warmup_completed') and c.get('restart_completed')) or c.get('timeouts'):
            problems.append(f'{label}: a timeout (warm-up, restart round or measured)')
    if set((v.get('controls') or {}).keys()) != CONTROLS:
        problems.append('the gate controls did not all run')
    if env.get('working_tree_dirty'):
        problems.append('the tested working tree had uncommitted changes')
    return problems, v, env


def check_negative(run_dir):
    problems = []
    manifest = manifest_ok(run_dir, problems)
    try:
        v = load(run_dir, 'verdicts.json')
        seal = load(run_dir, 'seal.txt')
    except (OSError, ValueError) as exc:
        return [f'evidence unreadable: {exc}']
    if manifest is None or manifest.get('exit_code') == 0:
        problems.append('the negative-control run did not fail')
    elif manifest.get('last_stage') != 'finish':
        problems.append(f"the run failed at stage {manifest.get('last_stage')}, not at the gate")
    if v.get('mode') != 'negative-control' or v.get('acceptance_eligible') is not False:
        problems.append('not a negative-control run')
    if v.get('verdict') != 'FAIL':
        problems.append('the negative-control verdict is not FAIL')
    misses = sorted(f"{c['reader']}/{c['combo']}:{c['reason']}" for c in v.get('combinations') or [] if c.get('verdict') != 'PASS')
    want = sorted(f'scope/{s}:p95 over target' for s in ('agency', 'personal', 'team'))
    if misses != want:
        problems.append(f'unexpected misses {misses}, expected {want}')
    if set((v.get('controls') or {}).keys()) != CONTROLS:
        problems.append('the gate controls did not all run')
    if v.get('seal') != 'verified' or 'seal verified' not in seal:
        problems.append('the seal was not verified after the run')
    return problems


def main(argv):
    if len(argv) < 2 or argv[0] not in ('check', 'negative-control', 'aggregate'):
        print(__doc__)
        return 2
    command, args = argv[0], argv[1:]
    if command == 'check':
        problems, v, env = check_acceptance(args[0])
        print(('PASS' if not problems else 'FAIL') + f": acceptance run {args[0]}")
        for p in problems[:60]:
            print('  - ' + p)
        return 0 if not problems else 1
    if command == 'negative-control':
        problems = check_negative(args[0])
        print(('PASS' if not problems else 'FAIL') + ': the negative control ' + ('failed as planted' if not problems else 'did not prove detection'))
        for p in problems:
            print('  - ' + p)
        return 0 if not problems else 1
    sha = None
    if args and args[0] == '--sha':
        sha, args = args[1], args[2:]
    runs = []
    failed = False
    for d in args:
        problems, v, env = check_acceptance(d)
        runs.append((d, problems, v, env))
        failed |= bool(problems)
    if len(runs) < 2:
        print('FAIL: at least two independent acceptance runs are required')
        return 1
    commits = {(env or {}).get('tested_commit') for _, _, _, env in runs}
    if len(commits) != 1 or (sha and commits != {sha}):
        print(f'FAIL: the runs tested different commits {sorted(map(str, commits))}' + (f' (expected {sha})' if sha else ''))
        failed = True
    runners = [((env or {}).get('runner') or {}).get('RUNNER_NAME') for _, _, _, env in runs]
    table = {}
    for d, problems, v, env in runs:
        for c in (v or {}).get('combinations') or []:
            table.setdefault((c['reader'], c['combo']), []).append((c.get('p95_ms'), c.get('target_ms'), c.get('verdict')))
    print(f"{'reader':<22} {'combo':<22} " + ' '.join(f'run{i + 1:<6}' for i in range(len(runs))) + ' target  verdict')
    for (reader, combo), cells in table.items():
        verdict = 'PASS' if len(cells) == len(runs) and all(x[2] == 'PASS' for x in cells) else 'FAIL'
        print(f'{reader:<22} {combo:<22} ' + ' '.join(f'{x[0]!s:<9}' for x in cells) + f' {cells[0][1]!s:<7} {verdict}')
    for i, (d, problems, v, env) in enumerate(runs):
        print(f'run{i + 1} ({runners[i]}, {(env or {}).get("cpu_model")}): ' + ('PASS' if not problems else f'FAIL ({len(problems)} problems)'))
        for p in problems[:20]:
            print('  - ' + p)
    summary = {'kind': 'reports-v3-performance-acceptance', 'commits': sorted(map(str, commits)),
               'runs': [{'dir': d, 'runner': (env or {}).get('runner'), 'cpu_model': (env or {}).get('cpu_model'),
                         'verdict': (v or {}).get('verdict'), 'problems': problems} for d, problems, v, env in runs],
               'acceptance': 'PASS' if not failed else 'FAIL'}
    with open('aggregate.json', 'w', encoding='utf-8') as fh:
        json.dump(summary, fh, indent=2)
    print(f"performance acceptance: {summary['acceptance']} ({len(runs)} independent runs, commit {', '.join(summary['commits'])})")
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
