#!/usr/bin/env python3
"""Apply reviewed pinned deltas on the isolated release branch; no network or production operations."""
from __future__ import annotations
import hashlib
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MAIN='e04eb16dc6fc70734f85868ab5235186d0ce4813'
TASK_BASE='5d37e5f98dc16b08d11359b1506153aac014b25a'
TASK='efa815144f893fafa43960f177a67ec90f92e4e1'
B1_BASE='d675a4b11d6f05f1cdf39414d274439358d1b877'
B1='02b8ba5c91def63ebfe7670c33a4981dc452037b'
B1_RECORD='c7e1fb24cc1526b224293725c5a3bc4e6aa06042'
PLAN='docs/plans/2026-10-02-recent-outbound-final/implementation_plan.md'
B1_PLAN='docs/plans/2026-09-30-agent-voicemail-callback-repair/implementation_plan.md'
STAGES='src/lib/__tests__/inboundStages.test.ts'
MIGRATION='supabase/migrations/20260927052736_inbound_recent_outbound_routing.sql'

def git(*args, data=None):
    return subprocess.run(['git',*args],cwd=ROOT,input=data,check=True,stdout=subprocess.PIPE).stdout

def read(ref,path): return git('show',f'{ref}:{path}')
def paths(base,head): return git('diff','--name-only',base,head).decode().splitlines()
def apply(base,head,names): git('apply','--3way','--index','-',data=git('diff','--binary',base,head,'--',*names))

def prepare():
    if (ROOT/MIGRATION).exists() or (ROOT/MIGRATION.replace('20260927052736', '20261002203426')).exists(): raise RuntimeError('Already integrated; refusing to reapply')
    for name in ('package.json','package-lock.json','src/contexts/TwilioContext.tsx'):
        if (ROOT/name).read_bytes()!=read(MAIN,name): raise RuntimeError('Baseline drift: '+name)
    for name,digest in {
      'supabase/ops/recent_outbound_enable_complete.sql':'6aaf5291ac9cc4bde754d37bbe79ab8df01f8764013fd78d72e962da8341a330',
      'supabase/ops/recent_outbound_disable_org.sql':'839311ac6f19ae52afc4f9e8903b74e1b121e0066b7b8ee69511990595364735',
    }.items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest: raise RuntimeError('Ops source drift: '+name)
    b1_names=[n for n in paths(B1_BASE,B1) if n not in ('WORK_LOG.md',B1_PLAN)]
    shared={'scripts/edge_payload.mjs','src/lib/__tests__/edgePayloadVerification.test.ts'}
    a_names=[n for n in paths(TASK_BASE,TASK) if n not in shared|{'WORK_LOG.md','implementation_plan.md',STAGES}]
    extra=[PLAN,B1_PLAN,'WORK_LOG.md','scripts/prepare_recent_outbound_release.py','scripts/verify_recent_outbound_release.py','scripts/run_recent_outbound_activation_tests.sh','supabase/ops/recent_outbound_enable_complete.sql','supabase/ops/recent_outbound_disable_org.sql','.github/workflows/recent-outbound-release-verify.yml']
    all_names=sorted(set(b1_names+a_names+extra))
    with (ROOT/PLAN).open('a') as f:
        f.write('\n## Exact integration file list — recorded before source edits\n\n')
        f.writelines('- `'+n+'`\n' for n in all_names)
        f.write('\nOnly the pinned source deltas, test reconciliation, one-org ops, verification infrastructure and additive records change. No production action.\n')
    apply(B1_BASE,B1,b1_names)
    for name in shared:
        if (ROOT/name).read_bytes()!=read(TASK,name): raise RuntimeError('Shared packaging conflict: '+name)
    apply(TASK_BASE,TASK,a_names)
    original=read(TASK,STAGES).decode(); marker='describe("S6 — recent-outbound owner'
    assert original.count(marker)==1
    s6=original[original.index(marker):]
    assert s6.count('mailbox=agent%3A${A2}')==2
    s6=s6.replace('mailbox=agent%3A${A2}','mailbox=agent&amp;mailbox_agent_id=${A2}')
    s6=s6.replace("today's encoding unchanged",'B1 repaired callback encoding')
    s6=s6.replace('it("an attempt with owner_source','it.each(["answered", "unanswered"] as const)("a %s attempt with owner_source',1)
    s6=s6.replace('async () => {','async (evidenceOutcome) => {',1)
    s6=s6.replace('owner_evidence_outcome: "answered"','owner_evidence_outcome: evidenceOutcome',1)
    target='    expect(r2.twiml).not.toContain("mailbox=group");'
    assert s6.count(target)==1
    s6=s6.replace(target,target+'''
    expect(r2.twiml).not.toContain("agent%3A");
    const callback = r2.twiml.match(/recordingStatusCallback="([^"]+)"/)?.[1].replace(/&amp;/g, "&");
    expect(callback).toBeTruthy();
    expect(readVoicemailCallbackQuery(new URL(callback!).searchParams)).toEqual({
      ok: true, mailbox: `agent:${A2}`, callRowId: CALL, orgId: ORG, attemptId: ATT,
    });''')
    stage=(ROOT/STAGES).read_text(); assert marker not in stage
    stage=stage.replace('import { describe, expect, it } from "vitest";','import { describe, expect, it } from "vitest";\nimport { readVoicemailCallbackQuery } from "../../../supabase/functions/twilio-recording-status/idempotency";',1)
    (ROOT/STAGES).write_text(stage.rstrip()+'\n\n'+s6.rstrip()+'\n')
    status='> **2026-10-02 status reconciliation:** B1 is deployed as recording-status v37 and inbound v46, source `02b8ba5`, verified in audit commit `c7e1fb2`. Older not-deployed statements below are historical. A natural group voicemail stored; individual-agent storage, notification and recipient playback remain unverified in the observed sample. No controlled call, test-lead reassignment or historical recording action occurred. This integration does not redeploy B1.\n\n'
    (ROOT/B1_PLAN).parent.mkdir(parents=True,exist_ok=True)
    (ROOT/B1_PLAN).write_bytes(status.encode()+read(B1_RECORD,B1_PLAN))
    for name in paths(TASK_BASE,TASK):
        if name.startswith(('supabase/functions/twilio-voice-status/','supabase/migrations/')): assert (ROOT/name).read_bytes()==read(TASK,name),name
    for name in b1_names:
        if name.startswith('supabase/functions/'): assert (ROOT/name).read_bytes()==read(B1,name),name
    assert (ROOT/'src/contexts/TwilioContext.tsx').read_bytes()==read(MAIN,'src/contexts/TwilioContext.tsx')
    entry='''## 2026-10-02 — Recent-outbound final integration — PREPARED; verification/release pending

- Chris requested direct completion in ChatGPT. This isolated branch preserves main `e04eb16d`, including Reports and appointment work.
- Reused Task A `efa8151` and deployed B1 source `02b8ba5`. No new dialer architecture, duration, signature, caller-ID or queue behavior.
- S6 tests cover answered/unanswered evidence with the repaired mailbox query/parser and correct recipient.
- Prepared one-org answered+unanswered activation and one-org disable with drift/prestate guards and idempotency. Existing global scripts remain historical, not selected for this release.
- Original Task A SQL passed on isolated PostgreSQL 17.6 in run 37034447100. Final combined-tree/activation verification is pending here.
- B1 production record `c7e1fb2`: receiver v37/inbound v46; natural group voicemail stored; agent playback unverified. Full historical B1 plan preserved with a new status note.
- No Task A migration, Edge deployment, activation, lead change, controlled call, historical recovery, PR or main merge. Exact production approval remains required.
- All previous main WORK_LOG bytes follow unchanged. See the final integration plan for file scope and verification.

'''
    p=ROOT/'WORK_LOG.md'; old=p.read_bytes(); p.write_bytes(entry.encode()+old)
    assert p.read_bytes().endswith(read(MAIN,'WORK_LOG.md'))
    with (ROOT/PLAN).open('a') as f: f.write('\n## Integration result\n\nPinned source deltas reconciled; B1 and Task A runtime files retain exact source parity. Verification and production acceptance are still pending.\n')
    git('add','--',*[n for n in all_names if (ROOT/n).exists()])
    print(git('diff','--cached','--stat').decode())

if __name__=='__main__': prepare()
