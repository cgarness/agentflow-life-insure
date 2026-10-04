"""Verbatim disposable fixtures shared by embedded and native PostgreSQL runners."""
from pathlib import Path
import json,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
def read(p): return (ROOT/p).read_text()
base=read('supabase/migrations/20260806000000_baseline_production_schema.sql')
def block(source,header,end='\n$$;'):
 a=source.index(header);return source[a:source.index(end,a)+len(end)]
def table(n): return block(base,f'CREATE TABLE IF NOT EXISTS "public"."{n}" (','\n);')
def migration(suffix):
 paths=list((ROOT/'supabase/migrations').glob('*_'+suffix+'.sql'))
 assert len(paths)==1,suffix
 return paths[0].read_text()
def historical_fixtures():
 m=json.loads(read('docs/plans/2026-10-04-leaderboard-accuracy/reconciliation-manifest.json'))
 def q(v):return 'NULL' if v is None else "'"+str(v).replace("'","''")+"'"
 org=m['organization_id'];sql=f"INSERT INTO organizations(id,name) VALUES({q(org)},'Synthetic repair agency');\n"
 for uid in sorted({x['seller'] for x in m['policies']}):
  sql+=f"INSERT INTO profiles(id,organization_id,first_name,last_name,role,status) VALUES({q(uid)},{q(org)},'Synthetic','Seller','Agent','Active');\n"
 for c in m['policies']:
  values=[c['id'],org,c['seller'],'Synthetic','Policy',c['policy_type'],c['carrier'],c['premium'],c['sold_date'],c['created_at'],(c['wins'][0]['key'].split(':')[1] if c['wins'] else None)]
  sql+='INSERT INTO clients(id,organization_id,assigned_agent_id,first_name,last_name,policy_type,carrier,premium,sold_date,created_at,lead_id) VALUES('+','.join(q(x) for x in values)+');\n'
  for w in c['wins'] or []:
   values=[w['id'],org,c['id'],w['agent_id'],w['key'],w['premium'],str(w['snapshot']).lower(),w['created_at'],c['policy_type']]
   sql+='INSERT INTO wins(id,organization_id,contact_id,agent_id,idempotency_key,premium_amount,premium_snapshot,created_at,policy_type) VALUES('+','.join(q(x) for x in values)+');\n'
 return sql

def repair_steps():
 repair=read('supabase/ops/reporting-accuracy/pending/20261004062328_reviewed_missing_policy_sales.sql').replace('\nBEGIN;\n','\n').replace('\nCOMMIT;\n','\n')
 reverse=read('supabase/ops/reporting-accuracy/pending/reverse_reviewed_missing_policy_sales.sql').replace('\nBEGIN;\n','\n').replace('\nCOMMIT;\n','\n')
 c="'71137434-036b-4b3f-8e0a-c6e290b096ba'"
 org="'a0000000-0000-0000-0000-000000000001'"
 link=read('supabase/ops/reporting-accuracy/pending/20261004062851_reviewed_legacy_policy_links.sql').replace('\nBEGIN;\n','\n').replace('\nCOMMIT;\n','\n')
 return [('unambiguous legacy links',link),('legacy link retry',link),('repair source drift and all-or-nothing rollback',f"UPDATE clients SET premium=41.65 WHERE id={c}; SELECT test_reject($script${repair}$script$,'P0001'); SELECT test_assert((SELECT count(*)=6 FROM wins WHERE organization_id={org}),'failed second target rolls back first'); UPDATE clients SET premium=41.64 WHERE id={c};"),
  ('exact reviewed repair',repair),('repair replay',repair),('repair postimage checks',f"SELECT test_assert((SELECT count(*)=8 FROM wins WHERE organization_id={org}),'eight policies eight sale events'); SELECT test_assert((SELECT sum(private.performance_monthly(w.premium_snapshot,w.premium_amount,c.premium)*12)=9373.92 FROM wins w LEFT JOIN clients c ON c.id=w.contact_id WHERE w.organization_id={org}),'annual premium 9373.92'); SELECT test_assert((SELECT count(*)=2 AND sum(premium_amount)*12=1201.08 AND bool_and(celebrated AND event_time_source='client_creation_proxy') FROM wins WHERE idempotency_key LIKE 'repair:manual-client:%'),'exact delta/provenance/celebration');"),
  ('repair period attribution',f"SELECT test_assert((SELECT count(*)=4 AND sum(private.performance_sale_monthly(w,c.premium)*12)=3205.32 FROM wins w LEFT JOIN clients c ON c.id=w.contact_id WHERE w.organization_id={org} AND w.created_at>='2026-09-01T07:00:00Z' AND w.created_at<'2026-10-01T07:00:00Z'),'September repair totals'); SELECT test_assert((SELECT count(*)=0 FROM wins WHERE organization_id={org} AND created_at>='2026-10-01T07:00:00Z' AND created_at<'2026-10-04T04:56:52.764028Z'),'October unchanged');"),('repair guarded reversal',reverse),('repair reversal replay',reverse),('repair cannot silently rerun after reversal',f"SELECT test_reject($script${repair}$script$,'P0001'); SELECT test_assert((SELECT count(*)=6 FROM wins WHERE organization_id={org}),'original events retained');")]


def reconciliation_steps():
 # Reuse the actual receipt schema; this policy fixture has no booking writer.
 receipt=block(migration('booking_disposition_receipts'),'CREATE TABLE private.booking_receipts(','\n);')
 query=read('supabase/ops/reporting-accuracy/reconcile.sql').rstrip().removesuffix(';').replace('$1',"test_id(1)").replace('$2','now()')
 check="SET TRANSACTION READ ONLY; DO $check$ DECLARE result jsonb; BEGIN SELECT reconciliation INTO result FROM ("+query+"\n) q; IF result->'bounds'->>'org' <> test_id(1)::text OR jsonb_array_length(result->'raw_period_totals')<>3 OR result->'applied_duplicate_mappings'<>'[]'::jsonb OR result->'booking_receipts_missing_rows'<>'[]'::jsonb THEN RAISE EXCEPTION 'Read-only reconciliation contract failed'; END IF; END $check$;"
 return [('reconciliation receipt schema',receipt),('read-only reconciliation query',check)]

def steps(mode):
 if mode=='booking':
  harness=read('supabase/tests/dialer_dnc_harness.sql').replace('CREATE TABLE public.appointments(id uuid DEFAULT gen_random_uuid(),contact_id uuid,organization_id uuid);',table('appointments')+'\nALTER TABLE appointments ADD PRIMARY KEY(id);\n'+table('recruits'))
  return [('original DNC harness',harness),('original DNC integrity',migration('dialer_disposition_dnc_integrity')),('DNC fixtures',read('supabase/tests/dialer_dnc_fixtures.sql')),('pre-upgrade committed disposition',read('supabase/tests/booking_upgrade_fixture.sql')),
   ('booking integrity',migration('booking_disposition_receipts')),('duration provenance',migration('call_attempt_duration_provenance')),
   ('external booking identities',migration('external_booking_identity_guard')),('booking duration regressions',read('supabase/tests/booking_duration_integrity.sql'))]
 reports=read('supabase/migrations/20260929152553_reports_secure_scoped_rpcs.sql')
 return [('verified original fixture',subprocess.check_output(['python3',str(ROOT/'scripts/policy_sale_fixture.py')],text=True)),
  ('previous sales',migration('leaderboard_sale_recording')),('original sale regressions',read('supabase/tests/policy_sale_recording.sql')),
  ('unchanged report helpers','CREATE TABLE public.company_settings(organization_id uuid PRIMARY KEY,timezone text);'+table('role_permissions')+block(reports,'CREATE FUNCTION private.report_agency_time_zone(')+block(reports,'CREATE FUNCTION private.report_permission_flags(')),
  ('historical repair synthetic fixtures',historical_fixtures()),('legacy feed synthetic fixture',"INSERT INTO clients(id,organization_id,assigned_agent_id,first_name,last_name,premium) VALUES(test_id(20090),test_id(1),test_id(12),'Synthetic','Legacy',75); INSERT INTO wins(id,organization_id,contact_id,agent_id,premium_amount,premium_snapshot,created_at) VALUES(test_id(20091),test_id(1),test_id(20090),test_id(12),0,false,now());"),('identity upgrade',migration('policy_identity_sale_integrity')),('identity regressions',read('supabase/tests/policy_identity_integrity.sql')),
  ('original group',table('agency_group_members')+block(base,'CREATE OR REPLACE FUNCTION "public"."get_agency_group_leaderboard"(')+'\nGRANT EXECUTE ON FUNCTION public.get_agency_group_leaderboard(uuid,text) TO anon,authenticated,service_role;'),
  ('previous group repair',migration('group_leaderboard_repair_membership_setter_credit')),('performance contract',migration('performance_reporting_contract')),('scoped summaries',migration('performance_scoped_summaries')),
  ('duration provenance',migration('call_attempt_duration_provenance')),('reader indexes',migration('performance_reader_indexes')),
  ('original dialer reader',table('dispositions')+table('dialer_sessions')+block(base,'CREATE OR REPLACE FUNCTION "public"."get_trusted_today_dialer_stats"(')+"\nREVOKE ALL ON FUNCTION public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.get_trusted_today_dialer_stats(uuid,timestamptz,timestamptz) TO anon,authenticated,service_role;"),
  ('canonical dialer reader',migration('trusted_dialer_canonical_counts')),('performance regressions',read('supabase/tests/performance_reporting_contract.sql'))]+repair_steps()+reconciliation_steps()
if __name__=='__main__':
 mode=sys.argv[1]
 if '--json' in sys.argv:print(json.dumps(steps(mode)))
 else:
  for label,sql in steps(mode):print('-- '+label+'\nBEGIN;\n'+sql+'\nCOMMIT;')
