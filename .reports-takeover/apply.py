from pathlib import Path
import base64, gzip, hashlib, os, shutil, subprocess
parts=['patch-0.b64','patch-1.b64','patch-2-clean.b64','patch-3.b64','patch-4.b64']
expected=['e0cf11104e6a3577229a037f22acf62e39d56efbb6e406b18481a339db2f0745','55bf7918a62bdfa7b20ed0ee69e6fff4afe8d78d27b73bae3a9b9188f02cd90c','76f1c31087d81a8667b720a1f1404b633014b4b772c3345f0631098828f7b020','b6c5f847496d7755d4f260f1510a1978af2038106dcb0f42051efba6707e45c8','79b7d6238d100d776961fca4c93e740b79b1034608417ece3d830560d128001f']
texts=[]
for name,digest in zip(parts,expected):
    text=''.join((Path('.reports-takeover')/name).read_text().split())
    if name=='patch-4.b64':
        # Restore the one omitted transfer character; the original exact checksum is still mandatory.
        assert text.count('smX/eZM38syZ5p81')==1
        text=text.replace('smX/eZM38syZ5p81','smX/eZM38syZr5p81')
    assert hashlib.sha256(text.encode()).hexdigest()==digest, 'Corrupt staged part: '+name
    texts.append(text)
patch=gzip.decompress(base64.b64decode(''.join(texts),validate=True))
assert hashlib.sha256(patch).hexdigest()=='45666a104405a57925fd93b1196f3134406fa75c5ac22d4f3cf63666b3a57823'
p=Path(os.environ['RUNNER_TEMP'])/'reports-review.patch'; p.write_bytes(patch)
allowed=set('''
.github/workflows/reports-backend.yml
.github/workflows/reports-frontend.yml
AGENT_RULES.md
WORK_LOG.md
implementation_plan.md
scripts/run_reports_rpc_tests.sh
scripts/verify_reports_frontend.py
src/components/reports/CampaignPerformance.tsx
src/components/reports/DispositionDeepDive.tsx
src/lib/__tests__/reportsFixtures.ts
src/lib/__tests__/reportsPolicySource.test.ts
src/lib/reports-policy-text.ts
src/lib/reports-schemas.ts
src/pages/__tests__/reportsPage.test.tsx
supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql
supabase/migrations/rollback/20260930120000_reports_policies_sold_normalized_source.rollback.sql
supabase/ops/reports_enable.sql
supabase/tests/reports_campaign_visibility.sql
supabase/tests/reports_fixtures.sql
supabase/tests/reports_harness.sql
supabase/tests/reports_policy_facts.sql
supabase/tests/reports_rpc.sql
'''.split())
paths=set(x.split('\t')[2] for x in subprocess.check_output(['git','apply','--numstat',str(p)],text=True).splitlines())
assert paths==allowed, ('Unexpected patch scope',paths^allowed)
old_log=Path('WORK_LOG.md').read_bytes()
original=Path('supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql').read_bytes()
subprocess.run(['git','apply','--unidiff-zero','--check',str(p)],check=True)
subprocess.run(['git','apply','--unidiff-zero',str(p)],check=True)
assert Path('WORK_LOG.md').read_bytes().endswith(old_log), 'Work Log history changed'
assert Path('supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql').read_bytes()==original
assert hashlib.sha256(Path('supabase/migrations/20260930120000_reports_policies_sold_normalized_source.sql').read_bytes()).hexdigest()=='15355717f39fe2cb6b33386334d785f672e167ea5774866322b262dcd9d551d5'
subprocess.run(['bash','-n','scripts/run_reports_rpc_tests.sh'],check=True)
subprocess.run(['python3','-m','py_compile','scripts/verify_reports_frontend.py'],check=True)
subprocess.run(['git','diff','--check'],check=True)
shutil.rmtree('.reports-takeover')
Path('.github/workflows/reports-takeover.yml').unlink()
subprocess.run(['git','add','--',*sorted(allowed),'.reports-takeover','.github/workflows/reports-takeover.yml'],check=True)
subprocess.run(['git','config','user.name','AgentFlow Reports repair'],check=True)
subprocess.run(['git','config','user.email','noreply@openai.com'],check=True)
subprocess.run(['git','commit','-m','Fix Reports campaign privacy and fail-closed fixture setup'],check=True)
branch='codex/reports-policy-final-fixes-20261002'
remote=subprocess.check_output(['git','ls-remote','origin','refs/heads/'+branch],text=True).split()[0]
assert remote==os.environ['EXPECTED_HEAD'], 'Branch advanced; refusing publication'
subprocess.run(['git','push','origin','HEAD:refs/heads/'+branch],check=True)
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
print('REPAIR_HEAD='+head,flush=True)
with (Path(os.environ['RUNNER_TEMP'])/'reports-stage'/'repaired-source.tar').open('wb') as out:
    subprocess.run(['git','archive','--format=tar','HEAD'],stdout=out,check=True)
