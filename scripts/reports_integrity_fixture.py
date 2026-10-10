"""Production-source dependencies for disposable Reports v2 verification; no network access."""
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[1]
def read(p):return (ROOT/p).read_text()
def block(path,header):
 s=read(path);a=s.index(header);return s[a:s.index('\n$$;',a)+4]
def clean(s):return re.sub(r'^\\.*\n','',s,flags=re.M)
def migration(suffix,folder='supabase/migrations'):
 # Version prefixes are renamed to the recorded production version after apply; the suffix stays unique.
 paths=sorted((ROOT/folder).glob('*_'+suffix+'.sql'));assert len(paths)==1,suffix;return paths[0].read_text()
def quote(s):return "$candidate$"+s+"$candidate$"
def refused(sql,message):return "SELECT rt.expect_sql_failure("+quote(sql)+","+quote(message)+");"
def payload_sql():
 def bundle(scope):
  pairs=[]
  for key,name in [('scope','scope'),('summary','call_summary'),('volume','call_volume'),('dispositions','disposition_breakdown'),('campaigns','campaign_performance'),('leadSources','lead_source_performance')]:
   args=f"'{scope}'" if name=='scope' else f"'2026-10-01','2026-10-01',NULL,'{scope}'"
   query=f'SELECT public.get_report_{name}_v2({args})'
   pairs.append("'"+key+"',rt.call(rt.iv(2),rt.iv(1),"+quote(query)+")")
  return 'jsonb_build_object('+','.join(pairs)+')'
 # Keep the original agency payload intact. The additional scopes are separate real RPC
 # responses for the same synthetic actor, never agency data with substituted metadata.
 scopes=','.join("'"+scope+"',"+bundle(scope) for scope in ['personal','team'])
 return "SELECT "+bundle('agency')+" || jsonb_build_object('scopes',jsonb_build_object("+scopes+"));"
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
 first=read('supabase/migrations/20261006043731_reports_integrity_readers.sql')
 second=read('supabase/migrations/20261006043738_reports_scopes_and_policy_premium.sql')
 disable=read('supabase/ops/reports_disable.sql')
 # The applied 20261006 release enable (historical pins) proves the shipped recovery path; the current ops
 # enable carries the corrected overlap reader pin and is proven by the correction release steps below.
 enable=read('supabase/migrations/20261006044003_reports_integrity_release_enable.sql')
 corrected_enable=read('supabase/ops/reports_integrity_enable.sql')
 release_disable=migration('reports_overlap_release_disable')
 release_enable=migration('reports_overlap_release_enable')
 correction=migration('reports_integrity_quality_overlap_seconds')
 correction_rollback=migration('reports_integrity_quality_overlap_seconds.rollback','supabase/migrations/rollback')
 assert release_disable==disable and release_enable==corrected_enable,'overlap release migrations must equal the reviewed ops sources'
 quality="(SELECT md5(prosrc) FROM pg_proc WHERE oid='private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[])'::regprocedure)"
 yield 'migration order refusal',refused(second,'Reports shared-reader drift or order')
 yield 'shared-reader authorization drift refusal',refused('ALTER FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) SECURITY INVOKER;'+first,'Reports preimage or authorization drift')
 yield 'access authorization drift refusal',refused('ALTER FUNCTION private.report_access(uuid) SECURITY INVOKER;'+second,'Reports preimage or authorization drift')
 yield 'disabled deployment preserves the seal',refused(disable+first+second+"SELECT rt.assert_sealed(false);DO $proof$ BEGIN RAISE EXCEPTION 'disabled-deployment proof rollback'; END $proof$;",'disabled-deployment proof rollback')
 yield '20261006043731_reports_integrity_readers',first
 yield '20261006043738_reports_scopes_and_policy_premium',second
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
 yield 'overlap correction fixture and payload preimage',read('supabase/tests/reports_integrity_overlap_fixture.sql')
 yield 'overlap correction refuses an enabled Reports surface',refused(correction,'Reports overlap correction: Reports must be disabled first')+"SELECT rt.assert_sealed(true);"
 yield 'overlap correction refuses reader drift',refused('ALTER FUNCTION private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[]) SECURITY DEFINER;'+release_disable+correction,'Reports overlap correction: preimage or authorization drift')
 yield 'overlap correction refuses reader ACL drift',refused('GRANT EXECUTE ON FUNCTION private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[]) TO service_role;'+release_disable+correction,'Reports overlap correction: preimage or authorization drift')
 yield 'overlap correction refuses session-reader drift',refused('ALTER FUNCTION private.report_session_seconds(uuid,timestamptz,timestamptz,uuid[]) SECURITY INVOKER;'+release_disable+correction,'Reports overlap correction: preimage or authorization drift')
 yield 'corrected enable refuses the uncorrected reader',refused(release_disable+corrected_enable,'Reports integrity enable: unverified body')+"SELECT rt.assert_sealed(true);"
 yield 'overlap release disables Reports only',release_disable+"SELECT rt.assert_sealed(false);"
 yield 'overlap correction in the disabled window',correction+"SELECT rt.assert_sealed(false);SELECT rt.eq('corrected reader',"+quality+",'c1355d551fba0cc2217150f5531d1b31');"
 yield 'overlap correction replay refuses',refused(correction,'Reports overlap correction: refusing replay')
 yield 'historical enable refuses the corrected reader',refused(enable,'Reports integrity enable: unverified body')+"SELECT rt.assert_sealed(false);"
 yield 'corrected enable rejects reader drift',refused('ALTER FUNCTION private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[]) SET search_path=public;'+corrected_enable,'Reports integrity enable: unverified body')+"SELECT rt.assert_sealed(false);"
 yield 'corrected enable rejects inherited legacy grants',refused('CREATE ROLE reports_overlap_inherited_client NOLOGIN; GRANT reports_overlap_inherited_client TO authenticated; GRANT EXECUTE ON FUNCTION public.rpc_report_call_summary(uuid,timestamptz,timestamptz,uuid) TO reports_overlap_inherited_client;'+corrected_enable,'Reports integrity enable: effective privilege mismatch')+"SELECT rt.assert_sealed(false);"
 yield 'corrected enable restores only verified v2',release_enable+"SELECT rt.assert_sealed(true);SELECT rt.overlap_compare();SELECT rt.eq('correction source unchanged',rt.source_fingerprint(),(SELECT fingerprint FROM rt.integrity_preimage));"
 yield 'overlap correction assertions and controls',read('supabase/tests/reports_integrity_overlap.sql')
 yield 'overlap rollback refuses an enabled Reports surface',refused(correction_rollback,'Reports overlap rollback: Reports must be disabled first')+"SELECT rt.assert_sealed(true);"
 yield 'overlap rollback refuses reader drift',refused('ALTER FUNCTION private.report_integrity_quality(uuid,timestamptz,timestamptz,uuid[]) SECURITY DEFINER;'+release_disable+correction_rollback,'Reports overlap rollback: preimage or authorization drift')+"SELECT rt.assert_sealed(true);"
 yield 'overlap rollback restores the exact preimage only while disabled',refused(release_disable+correction_rollback+"SELECT rt.eq('restored preimage',"+quality+",'d330c5bea75fb160a0f55e72ed2fe191');SELECT rt.expect_sql_failure($inner$"+correction_rollback+"$inner$,'Reports overlap rollback: refusing replay');SELECT rt.expect_sql_failure($inner$"+corrected_enable+"$inner$,'Reports integrity enable: unverified body');SELECT rt.assert_sealed(false);"+enable+"SELECT rt.assert_sealed(true);SELECT rt.overlap_compare(true);DO $proof$ BEGIN RAISE EXCEPTION 'overlap rollback proof rollback'; END $proof$;",'overlap rollback proof rollback')
 yield 'corrected reader retained after the rollback proof',"SELECT rt.eq('corrected reader retained',"+quality+",'c1355d551fba0cc2217150f5531d1b31');SELECT rt.assert_sealed(true);SELECT rt.eq('final source unchanged',rt.source_fingerprint(),(SELECT fingerprint FROM rt.integrity_preimage));"
if __name__=='__main__':
 data=list(steps())
 if '--payload-sql' in sys.argv:print(payload_sql())
 elif '--json' in sys.argv:print(json.dumps(data))
 else:
  for label,sql in data:print('\\echo '+label+'\nBEGIN;\n'+sql+'\nCOMMIT;\n')
