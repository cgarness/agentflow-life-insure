#!/usr/bin/env python3
"""Compare final integration to pinned main. No production access; failing baselines remain explicit."""
from __future__ import annotations
import collections, hashlib, json, os, re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ['RO_BASE_WORKTREE']).resolve()
OUT = Path(os.environ['RO_EVIDENCE']).resolve(); OUT.mkdir(parents=True, exist_ok=True)
ENV = dict(os.environ, TZ='UTC', NO_COLOR='1')
FOCUSED = ['inboundStages','inboundV2Twiml','voicemailRecordingPipeline','voicemailOwnershipRecovery','voicemailCallbackContract','edgePayloadVerification','outboundDialEvidence','twilioVoiceStatusHandler','voiceStatusConvergence']
results: dict = {}; failures: list[str] = []

def run(label, args, cwd=ROOT, timeout=600):
    print(f'RUN {label}', flush=True)
    p = subprocess.run(args,cwd=cwd,env=ENV,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    (OUT/f'{label}.txt').write_text(p.stdout)
    print(f'EXIT {label}: {p.returncode}',flush=True)
    return p.returncode,p.stdout

def clean(text): return re.sub(r'\x1b\[[0-9;]*m','',text)

def tsc_errors(text):
    return collections.Counter((m.group(1),m.group(2),m.group(3)) for m in re.finditer(r'^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$',clean(text),re.M))

def deno_errors(text):
    out=collections.Counter()
    for m in re.finditer(r'(TS\d+) \[ERROR\]: (.*?)(?=\nTS\d+ \[ERROR\]:|\nFound \d+ errors?|\Z)',clean(text),re.S):
        block=m.group(2); loc=re.search(r'(supabase/functions/[^\s:]+):\d+:\d+',block)
        if not loc: raise RuntimeError('Unparsed Deno diagnostic: '+block[:200])
        out[(loc.group(1),m.group(1),block.split('\n')[0])]+=1
    return out

def states(report,root):
    assertions=collections.Counter(); files={}
    for f in report.get('testResults',[]):
        name=str(Path(f['name']).relative_to(root)); files[name]=f['status']
        for a in f.get('assertionResults',[]): assertions[(name,a['fullName'],a['status'])]+=1
    return assertions,files

def verify():
    for label,root in [('base',BASE),('candidate',ROOT)]:
        code,text=run(f'{label}-root-tsc',['npx','--no-install','tsc','--noEmit'],root)
        results[f'{label}_root_tsc_exit']=code
        if code: failures.append(f'{label} root tsc failed')
        code,text=run(f'{label}-app-tsc',['npx','--no-install','tsc','-p','tsconfig.app.json','--noEmit'],root)
        errors=tsc_errors(text); results[f'{label}_app_tsc']={'exit':code,'diagnostics':sum(errors.values())}
        if code and not errors: failures.append(f'{label} app tsc unparsed failure')
        if label=='base': base_errors=errors
        else:
            new=errors-base_errors; results['new_app_errors']=list(new.elements())
            if new: failures.append('New application TypeScript errors')
    code,_=run('candidate-focused',['npx','--no-install','vitest','run',*[f'src/lib/__tests__/{x}.test.ts' for x in FOCUSED],'--maxWorkers=2','--minWorkers=2','--reporter=json',f'--outputFile={OUT}/focused.json'])
    if code: failures.append('Focused regression suite failed')
    x=json.loads((OUT/'focused.json').read_text()); results['focused']={k:x[k] for k in ('numTotalTests','numPassedTests','numFailedTests','numPendingTests')}
    reports={}
    for label,root in [('base',BASE),('candidate',ROOT)]:
        code,_=run(f'{label}-full-vitest',['npx','--no-install','vitest','run','--maxWorkers=2','--minWorkers=2','--reporter=json',f'--outputFile={OUT}/{label}-full.json'],root)
        r=json.loads((OUT/f'{label}-full.json').read_text()); reports[label]=r
        results[f'{label}_full']={'exit':code,**{k:r[k] for k in ('numTotalTests','numPassedTests','numFailedTests','numPendingTests')}}
        if code and not r.get('numFailedTests') and not any(f['status']=='failed' for f in r['testResults']): failures.append(f'{label} full failure outside parsed results')
    before,bfiles=states(reports['base'],BASE); after,afiles=states(reports['candidate'],ROOT)
    bid=collections.Counter(); aid=collections.Counter()
    for (f,n,s),v in before.items(): bid[(f,n)]+=v
    for (f,n,s),v in after.items(): aid[(f,n)]+=v
    removed=bid-aid
    reg=[k for k in before if k[2]=='passed' and after[k]<before[k]]
    newfail=collections.Counter({k:v for k,v in after.items() if k[2]=='failed'})-collections.Counter({k:v for k,v in before.items() if k[2]=='failed'})
    newfiles=sorted(f for f,s in afiles.items() if s=='failed' and bfiles.get(f)!='failed')
    results.update(removed_assertions=list(removed.elements()),passed_assertion_regressions=reg,new_failed_assertions=list(newfail.elements()),new_failed_files=newfiles,baseline_failed_files=sorted(f for f,s in bfiles.items() if s=='failed'))
    if removed or reg or newfail or newfiles: failures.append('Full-suite coverage/status regression')
    deno=os.environ.get('DENO_BIN'); results['deno']={}
    if not deno: failures.append('Exact Deno check unavailable')
    else:
        for fn in ('twilio-voice-status','twilio-recording-status','twilio-voice-inbound'):
            pair={}
            for label,root in [('base',BASE),('candidate',ROOT)]:
                args=[deno,'check','--no-config','--no-lock']
                if os.environ.get('RO_DENO_CACHED_ONLY')=='1': args.append('--cached-only')
                code,text=run(f'deno-{label}-{fn}',args+[f'supabase/functions/{fn}/index.ts'],root)
                errors=deno_errors(text)
                if code and not errors: failures.append(f'Unparsed/blocked Deno check {label}/{fn}')
                pair[label]={'exit':code,'diagnostics':sum(errors.values())}
                if label=='base': dbase=errors
                else:
                    pair['new_errors']=list((errors-dbase).elements())
                    if errors-dbase: failures.append(f'New Deno errors: {fn}')
            results['deno'][fn]=pair
    packages={}
    for fn in ('twilio-voice-status','twilio-recording-status','twilio-voice-inbound'):
        path=OUT/f'{fn}.payload.json'
        code,_=run(f'package-build-{fn}',['node','scripts/edge_payload.mjs','build',f'supabase/functions/{fn}','--out',str(path)])
        if code: raise RuntimeError(f'Package build failed: {fn}')
        code,_=run(f'package-verify-{fn}',['node','scripts/edge_payload.mjs','verify',f'supabase/functions/{fn}',str(path)])
        if code: failures.append(f'Package verification failed: {fn}')
        rows=json.loads(path.read_text()); manifest=''.join(hashlib.sha256(r['content'].encode()).hexdigest()+'  '+r['name']+'\n' for r in sorted(rows,key=lambda r:r['name']))
        packages[fn]={'payload_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'payload_bytes':path.stat().st_size,'manifest_sha256':hashlib.sha256(manifest.encode()).hexdigest(),'files':[{'name':r['name'],'bytes':len(r['content'].encode()),'sha256':hashlib.sha256(r['content'].encode()).hexdigest()} for r in rows]}
    results['packages']=packages
    expected={'twilio-recording-status':'5b33d169f431db89b64993c75c32dce31715e8e05ac4bf26487aab3ed30efc92','twilio-voice-inbound':'31d1cf5ab0cc87281d01c8ac8339343f50a2bc076f0e0d7365c94a85e3da45e1'}
    for fn,digest in expected.items():
        if packages[fn]['payload_sha256']!=digest: failures.append(f'Deployed B1 source drift: {fn}')
    results['failures']=failures; results['result']='no_new_regressions' if not failures else 'blocked'
    (OUT/'verification-summary.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2),flush=True)
    if failures: raise SystemExit(1)

if __name__=='__main__':
    try: verify()
    except Exception as exc:
        results.update(failures=failures+[f'{type(exc).__name__}: {exc}'],result='blocked')
        (OUT/'verification-summary.json').write_text(json.dumps(results,indent=2)+'\n')
        raise
