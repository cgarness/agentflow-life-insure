import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {openSyntheticDatabase} from './engine.mjs';
const read=p=>readFileSync(p,'utf8'),doc='docs/plans/2026-11-04-dialer-reliability/';
const patches=JSON.parse(read(doc+'count-reader-predicates.json'));
const candidate=name=>{const before=read(doc+name+'.before.sql'),[old,next]=patches[name];return before.replace(old,next);};
const sql=read('supabase/migrations/20261104234307_dialer_admitted_call_counts.sql');
for(const name of Object.keys(patches))assert.ok(sql.includes(candidate(name)),name+' preserves all other source');
const db=await openSyntheticDatabase();
try{
 const steps=JSON.parse(execFileSync('python3',['scripts/reporting_fixture.py','policy','--json'],{encoding:'utf8',maxBuffer:12*1024*1024}));
 for(const [name,body] of steps){if(name==='unambiguous legacy links')break;await db.exec('BEGIN;\n'+body.replace(/^\\.*$/gm,'')+'\nCOMMIT;');}
 await db.exec('ALTER TABLE public.calls ADD COLUMN dialer_admission_required boolean NOT NULL DEFAULT false;ALTER TABLE public.calls ADD COLUMN dialer_provider_admitted boolean;');
 for(const name of ['performance_rows','get_performance_details','get_profile_book_stats'])await db.exec(candidate(name));
 await db.exec(`INSERT INTO public.profiles(id,organization_id,first_name,last_name,role,status) VALUES(test_id(990011),test_id(1),'Synthetic','Counter','Agent','Active');
 INSERT INTO public.calls(id,organization_id,agent_id,direction,status,created_at,dialer_admission_required,dialer_provider_admitted) VALUES
 (test_id(990101),test_id(1),test_id(990011),'outbound','failed',now()-interval '30 seconds',false,NULL),
 (test_id(990102),test_id(1),test_id(990011),'outbound','failed',now()-interval '30 seconds',true,false),
 (test_id(990103),test_id(1),test_id(990011),'outbound','failed',now()-interval '30 seconds',true,true);`);
 const result=await db.query("SELECT calls_made FROM private.performance_rows(ARRAY[test_id(1)],now()-interval '1 day',now()+interval '1 day',current_date-1,current_date+1,ARRAY[test_id(990011)])");
 assert.equal(Number(result.rows[0].calls_made),2);
 const profileDeps=read('supabase/migrations/20260919183544_profile_book_and_team_stats_rpcs.sql');
 for(const fn of ['profile_parse_currency','profile_parse_iso_date']) {
   const start=profileDeps.indexOf('CREATE OR REPLACE FUNCTION private.'+fn+'(');
   await db.exec(profileDeps.slice(start,profileDeps.indexOf('\n$$;',start)+4));
 }
 const base=read('supabase/migrations/20260806000000_baseline_production_schema.sql');
 const normalStart=base.indexOf('CREATE OR REPLACE FUNCTION "public"."normalize_us_state"');
 await db.exec(base.slice(normalStart,base.indexOf('\n$$;',normalStart)+4));
 await db.exec('CREATE TABLE IF NOT EXISTS public.agent_state_licenses(agent_id uuid,organization_id uuid,state text);');
 await db.exec(`SELECT test_actor(990011);SET ROLE authenticated;`);
 const detail=await db.query("SELECT public.get_performance_details('calls_today','day') as result");
 assert.equal(detail.rows[0].result.rows.length,2);
 const profile=await db.query("SELECT achievements FROM public.get_profile_book_stats('self','UTC')");
 assert.equal(Number(profile.rows[0].achievements.most_dials_day.dials),2);
 await db.exec('RESET ROLE;');
 console.log('PASS performance aggregates/details: legacy + admitted failure count; unconfirmed excluded');
} catch(e){console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail}));process.exitCode=1;}finally{await db.close();}
const reports=await openSyntheticDatabase();
try{
 const steps=JSON.parse(execFileSync('python3',['scripts/reports_integrity_fixture.py','--json'],{encoding:'utf8',maxBuffer:12*1024*1024}));
 for(const [name,body] of steps){if(name==='Reports v2 integrity assertions'){await reports.exec('ALTER TABLE public.calls ADD COLUMN dialer_admission_required boolean NOT NULL DEFAULT false;ALTER TABLE public.calls ADD COLUMN dialer_provider_admitted boolean;');await reports.exec(candidate('report_call_facts'));await reports.exec('BEGIN;'+body+'COMMIT;');break;}await reports.exec('BEGIN;\n'+body+'\nCOMMIT;');}
 // Explicit sample flags exercise real source rows, preserving inbound/legacy visibility rules.
 const ids=await reports.query("SELECT id,organization_id FROM public.calls WHERE direction='outbound' LIMIT 1");
 const sample=ids.rows[0];assert.ok(sample);
 await reports.query('UPDATE public.calls SET dialer_admission_required=true,dialer_provider_admitted=false WHERE id=$1',[sample.id]);
 const no=await reports.query("SELECT count(*)::int n FROM private.report_call_facts($1,'2000-01-01','2100-01-01',NULL) WHERE call_id=$2",[sample.organization_id,sample.id]);
 assert.equal(no.rows[0].n,0);
 await reports.query('UPDATE public.calls SET dialer_provider_admitted=true WHERE id=$1',[sample.id]);
 const yes=await reports.query("SELECT count(*)::int n FROM private.report_call_facts($1,'2000-01-01','2100-01-01',NULL) WHERE call_id=$2",[sample.organization_id,sample.id]);
 assert.equal(yes.rows[0].n,1);
 console.log('PASS Reports v2 regressions + unconfirmed/admitted inclusion');
}catch(e){console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail}));process.exitCode=1;}finally{await reports.close();}

// Recovery verification uses the complete historical fixture, then the new reviewed reader/pin.
const recovery=await openSyntheticDatabase();
try {
 const steps=JSON.parse(execFileSync('python3',['scripts/reports_integrity_fixture.py','--json'],{encoding:'utf8',maxBuffer:12*1024*1024}));
 for(const [name,body] of steps)await recovery.exec('BEGIN;'+body+'COMMIT;');
 await recovery.exec('ALTER TABLE public.calls ADD COLUMN dialer_admission_required boolean NOT NULL DEFAULT false;ALTER TABLE public.calls ADD COLUMN dialer_provider_admitted boolean;');
 await recovery.exec(candidate('report_call_facts'));
 await recovery.exec(read('supabase/ops/reports_disable.sql'));
 await recovery.exec(read('supabase/ops/reports_integrity_enable.sql'));
 await recovery.exec('SELECT rt.assert_sealed(true);');
 console.log('PASS versioned Reports recovery accepts only the new reviewed body and restores v2 grants');
}catch(e){console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail}));process.exitCode=1;}finally{await recovery.close();}
