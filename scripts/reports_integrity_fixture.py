"""Production-source dependencies for disposable Reports v2 verification; no network access."""
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[1]
def read(p):return (ROOT/p).read_text()
def block(path,header):
 s=read(path);a=s.index(header);return s[a:s.index('\n$$;',a)+4]
def clean(s):return re.sub(r'^\\.*\n','',s,flags=re.M)
def quote(s):return "$candidate$"+s+"$candidate$"
def refused(sql,message):return "SELECT rt.expect_sql_failure("+quote(sql)+","+quote(message)+");"
def payload_sql():
 pairs=[]
 for key,name in [('scope','scope'),('summary','call_summary'),('volume','call_volume'),('dispositions','disposition_breakdown'),('campaigns','campaign_performance'),('leadSources','lead_source_performance')]:
  args="'agency'" if name=='scope' else "'2026-10-01','2026-10-01',NULL,'agency'"
  query=f'SELECT public.get_report_{name}_v2({args})'
  pairs.append("'"+key+"',rt.call(rt.iv(2),rt.iv(1),"+quote(query)+")")
 return 'SELECT jsonb_build_object('+','.join(pairs)+');'
def steps():
 base='supabase/migrations/20260806000000_baseline_production_schema.sql'
 actor='supabase/migrations/20260811200920_campaign_leads_membership_uniqueness_and_attachment_core.sql'
 down='supabase/migrations/20260919183544_profile_book_and_team_stats_rpcs.sql'
 deps=[block(base,'CREATE OR REPLACE FUNCTION "public"."get_org_id"()'),block(actor,'CREATE OR REPLACE FUNCTION private.campaign_actor()'),block(down,'CREATE OR REPLACE FUNCTION private.resolve_downline_ids('),block(down,'CREATE OR REPLACE FUNCTION private.profile_parse_iso_date(')]
 for n in ['call_summary','call_volume_timeseries','campaign_performance','disposition_breakdown']:
  deps+=[block(base,'CREATE OR REPLACE FUNCTION "public"."rpc_report_'+n+'"('),f'REVOKE ALL ON FUNCTION public.rpc_report_{n}(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.rpc_report_{n}(uuid,timestamptz,timestamptz,uuid) TO anon,authenticated,service_role;']
 deps+=['REVOKE ALL ON FUNCTION private.campaign_actor(), private.resolve_downline_ids(uuid,uuid),private.profile_parse_iso_date(text) FROM PUBLIC,anon,authenticated,service_role;']
 yield 'harness',read('supabase/tests/reports_harness.sql')
 yield 'verbatim authorization dependencies','\n'.join(deps)
 for n in ['20260929152553_reports_secure_scoped_rpcs','20261002160849_reports_policies_sold_normalized_source']:
  yield n,read('supabase/migrations/'+n+'.sql')
 yield 'original fixtures',clean(read('supabase/tests/reports_fixtures.sql'))
 for name in ['reports_rpc','reports_policy_facts','reports_campaign_visibility']:
  yield name,clean(read('supabase/tests/'+name+'.sql'))
 yield 'current reporting schema dependencies',read('supabase/tests/reports_integrity_dependencies.sql')
 yield 'integrity control helpers and source fingerprint',read('supabase/tests/reports_integrity_controls.sql')
 first=read('supabase/migrations/20261005183955_reports_integrity_readers.sql')
 second=read('supabase/migrations/20261005184012_reports_scopes_and_policy_premium.sql')
 disable=read('supabase/ops/reports_disable.sql')
 enable=read('supabase/ops/reports_integrity_enable.sql')
 yield 'migration order refusal',refused(second,'Reports shared-reader drift or order')
 yield 'shared-reader authorization drift refusal',refused('ALTER FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) SECURITY INVOKER;'+first,'Reports preimage or authorization drift')
 yield 'access authorization drift refusal',refused('ALTER FUNCTION private.report_access(uuid) SECURITY INVOKER;'+second,'Reports preimage or authorization drift')
 yield 'disabled deployment preserves the seal',refused(disable+first+second+"SELECT rt.assert_sealed(false);DO $proof$ BEGIN RAISE EXCEPTION 'disabled-deployment proof rollback'; END $proof$;",'disabled-deployment proof rollback')
 yield '20261005183955_reports_integrity_readers',first
 yield '20261005184012_reports_scopes_and_policy_premium',second
 yield 'read-only migrations preserve every fixture source row',"SELECT rt.eq('source immutability',rt.source_fingerprint(),(SELECT fingerprint FROM rt.integrity_preimage));"
 yield 'both migration replays refuse',refused(first,'refusing replay')+refused(second,'refusing replay')
 yield 'Reports v2 integrity assertions',read('supabase/tests/reports_integrity.sql')
 yield 'six assertion negative controls',read('supabase/tests/reports_integrity_negative.sql')
 yield 'recovery source fingerprint',"UPDATE rt.integrity_preimage SET fingerprint=rt.source_fingerprint();"
 yield 'disable seals both public versions',disable+"SELECT rt.assert_sealed(false);"
 yield 'old enable refuses changed readers',refused(read('supabase/ops/reports_enable.sql'),'not the verified normalized-policy implementation')+"SELECT rt.assert_sealed(false);"
 yield 'new enable rejects body drift',refused('ALTER FUNCTION private.report_access_v2(text,uuid) SECURITY INVOKER;'+enable,'Reports integrity enable: unverified body')+"SELECT rt.assert_sealed(false);"
 yield 'new enable rejects inherited legacy grants',refused('CREATE ROLE reports_inherited_client NOLOGIN; GRANT reports_inherited_client TO authenticated; GRANT EXECUTE ON FUNCTION public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid) TO reports_inherited_client;'+enable,'Reports integrity enable: effective privilege mismatch')+"SELECT rt.assert_sealed(false);"
 yield 'version-aware enable restores only verified v2',enable+"SELECT rt.assert_sealed(true);SELECT rt.eq('recovery result',rt.isummary()->'totals'->>'calls_made','5');SELECT rt.eq('recovery source unchanged',rt.source_fingerprint(),(SELECT fingerprint FROM rt.integrity_preimage));"
 yield 'synthetic volume and existing-index verification',read('supabase/tests/reports_integrity_performance.sql')
if __name__=='__main__':
 data=list(steps())
 if '--payload-sql' in sys.argv:print(payload_sql())
 elif '--json' in sys.argv:print(json.dumps(data))
 else:
  for label,sql in data:print('\\echo '+label+'\nBEGIN;\n'+sql+'\nCOMMIT;\n')
