#!/usr/bin/env python3
"""Run isolated Reports verification and prove no new failures versus the exact PR base."""
from pathlib import Path
from collections import Counter
import json
import os
import re
import subprocess
import sys
from frontend_runtime_error_compare import assert_no_new_test_failures, runtime_error_signatures, selftest

root = Path(__file__).resolve().parents[1]
evidence = Path(os.environ.get('REPORTS_EVIDENCE', '/tmp/reports-frontend-evidence')).resolve()
evidence.mkdir(parents=True, exist_ok=True)
base = Path(os.environ['REPORTS_BASE_WORKTREE']).resolve()

def run(label: str, cwd: Path, args: list[str], extra_env=None) -> int:
    with (evidence / f'{label}.log').open('w') as out:
        result = subprocess.run(args, cwd=cwd, stdout=out, stderr=subprocess.STDOUT, timeout=1200,
                                check=False, env={**os.environ, **(extra_env or {})})
    print(f'{label}: exit {result.returncode}', flush=True)
    return result.returncode

if (root/'package-lock.json').read_bytes() != (base/'package-lock.json').read_bytes():
    # A dependency-changing PR needs its own exact baseline installation.
    # Keep every type/test/runtime assertion below; never compare against head's packages.
    if run('base-npm-ci', base, ['npm','ci','--no-audit','--no-fund']) != 0:
        sys.exit('Could not install exact base dependencies; comparison refused')
else:
    os.symlink(root/'node_modules', base/'node_modules', target_is_directory=True)
checks = {}
selftest()
for name, cwd in [('base', base), ('branch', root)]:
    checks[f'{name}_root_tsc'] = run(f'{name}-root-tsc', cwd, ['npx','--no-install','tsc','--noEmit'])
    checks[f'{name}_app_tsc'] = run(f'{name}-app-tsc', cwd, ['npx','--no-install','tsc','-p','tsconfig.app.json','--noEmit'])
    checks[f'{name}_vitest'] = run(f'{name}-vitest', cwd,
        ['npx','--no-install','vitest','run','--maxWorkers=2','--minWorkers=1','--reporter=json',
         f'--reporter={root}/scripts/vitest-runtime-error-reporter.mjs',f'--outputFile={evidence/name}.json'],
        {'VITEST_RUNTIME_ERROR_FILE': str(evidence/f'{name}-runtime-errors.json')})

def type_errors(name: str) -> list[str]:
    lines = (evidence/f'{name}-app-tsc.log').read_text().splitlines()
    # Source edits move diagnostic locations. Compare file/code/message and multiplicity;
    # resolved baseline errors are allowed, new or additional errors are not.
    return sorted(re.sub(r'\(\d+,\d+\): (error TS)', r'(line,col): \1',
                         x.replace(str(base),'<ROOT>').replace(str(root),'<ROOT>'))
                  for x in lines if 'error TS' in x)
assert not (Counter(type_errors('branch')) - Counter(type_errors('base'))), 'New TypeScript diagnostic against base'
assert checks['base_root_tsc'] == checks['branch_root_tsc'], 'Root typecheck regression'

def failures(path: Path, cwd: Path):
    j=json.loads(path.read_text())
    suites=[]; tests=[]
    for suite in j['testResults']:
        name=suite['name'].removeprefix(str(cwd)+'/')
        if suite['status']=='failed': suites.append(name)
        for test in suite.get('assertionResults',[]):
            if test['status']=='failed': tests.append((name,test['fullName']))
    return j, (sorted(suites),sorted(tests))
bj,bfail=failures(evidence/'base.json',base)
hj,hfail=failures(evidence/'branch.json',root)
assert_no_new_test_failures(bfail, hfail)
assert hj.get('numFailedTests') <= bj.get('numFailedTests'), 'New failed test'
# JSON reporter versions do not all expose unhandled errors. Inspect both the field and
# Vitest's explicit runtime-error summary; never turn an omitted field into a false zero.
def runtime_errors(j, name):
    log=(evidence/f'{name}-vitest.log').read_text()
    log=re.sub(r'\x1b\[[0-9;]*m','',log)
    matches=re.findall(r'(?:caught|encountered)\s+(\d+)\s+unhandled error',log,re.I)
    if 'unhandledErrors' in j:
        count=len(j['unhandledErrors'])
        if matches: assert count==int(matches[-1]), 'Runtime error reporters disagree'
        return count
    return int(matches[-1]) if matches else None
runtime_evidence = {name: json.loads((evidence/f'{name}-runtime-errors.json').read_text())
                    for name in ('base', 'branch')}
runtime_signatures = {name: runtime_error_signatures(value, (base, root))
                      for name, value in runtime_evidence.items()}
for name, result in (('base', bj), ('branch', hj)):
    reported = runtime_errors(result, name)
    if reported is not None:
        assert reported == sum(runtime_signatures[name].values()), 'Runtime error reporters disagree'
assert not (runtime_signatures['branch'] - runtime_signatures['base']), 'New unhandled runtime error'
assert checks['base_vitest'] in (0, 1) and checks['branch_vitest'] in (0, checks['base_vitest']), 'Vitest process regression or abnormal exit'
report_tests=sorted(str(p.relative_to(root)) for p in (root/'src').rglob('*.test.*')
                    if any(t in p.name.lower() for t in ['reports','reportstat','normalizedpolicy']))
checks['reports_vitest']=run('reports-vitest',root,['npx','--no-install','vitest','run','--maxWorkers=2','--minWorkers=1',*report_tests])
assert checks['reports_vitest']==0, 'Reports/Profile normalization tests must pass'
changed=subprocess.check_output(['git','diff','--name-only',os.environ['REPORTS_BASE_SHA'],'HEAD'],cwd=root,text=True).splitlines()
typescript=[p for p in changed if p.endswith(('.ts','.tsx')) and (root/p).is_file()]
# With no changed TypeScript, a bare eslint call would lint the whole repository (pre-existing errors on main).
checks['eslint']=run('eslint',root,['npx','--no-install','eslint',*typescript]) if typescript else 0
checks['build']=run('build',root,['npm','run','build'])
assert checks['eslint']==0 and checks['build']==0, 'Lint or build failed'
summary={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
         'base_sha':os.environ['REPORTS_BASE_SHA'],'checks':checks,
         'base_passed':bj.get('numPassedTests'),'branch_passed':hj.get('numPassedTests'),
         'preexisting_failed_tests':hj.get('numFailedTests'),'preexisting_failed_files':hfail[0],
         'app_type_errors':len(type_errors('branch')),
         'reported_unhandled_errors':sum(runtime_signatures['branch'].values())}
(evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
