// Disposable embedded or native loopback PostgreSQL; never a linked database.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {openSyntheticDatabase} from './engine.mjs';
import {verifyDispatchContention} from './concurrency.mjs';
const db=await openSyntheticDatabase();
const read=p=>readFileSync(p,'utf8');
const plain=s=>s.replace(/^\\.*$/gm,'').replace(/^SELECT (.*) AS converted \\gset$/gm, "SELECT set_config('test.converted', ($1)::text, true);").replaceAll(":'converted'", "current_setting('test.converted')");
const extract=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const baseline=read('supabase/migrations/20260806000000_baseline_production_schema.sql');
try {
 await db.exec(plain(read('supabase/tests/dialer_dnc_harness.sql')));
 await db.exec(read('supabase/migrations/20261003043122_dialer_disposition_dnc_integrity.sql'));
 await db.exec(plain(read('supabase/tests/dialer_dnc_fixtures.sql')));
 await db.exec(extract(baseline,'CREATE TABLE IF NOT EXISTS "public"."dialer_sessions"','ALTER TABLE "public"."dialer_sessions"'));
 await db.exec(extract(baseline,'CREATE OR REPLACE FUNCTION "private"."close_stale_dialer_sessions"','ALTER FUNCTION "private"."close_stale_dialer_sessions"'));
 const auth=read('supabase/migrations/20260811201250_import_campaign_creation_and_retry.sql');
 await db.exec(extract(auth,'CREATE OR REPLACE FUNCTION public.can_dial_campaign','COMMENT ON FUNCTION public.can_dial_campaign'));
 // Unrelated reporting tables are synthetic dependencies, not replacement implementations.
 await db.exec(`CREATE TABLE private.performance_duplicate_rows(organization_id uuid,kind text,duplicate_id uuid);
 CREATE TABLE public.wins(id uuid,agent_id uuid,organization_id uuid,campaign_id uuid,created_at timestamptz,sold_date date);
 ALTER TABLE public.dispositions ADD COLUMN IF NOT EXISTS counts_as_contacted boolean DEFAULT false;`);
 const sale=read('supabase/migrations/20261017043142_performance_sold_date_basis.sql');
 await db.exec(extract(sale,'CREATE FUNCTION private.dialer_sale_day_check','-- Calls and appointments keep their instant window'));
 const metadata=JSON.parse(read('docs/plans/2026-11-04-dialer-reliability/live-function-metadata.json'));
 await db.exec('SET check_function_bodies=off;');
 for(const row of metadata) {
   const name=row.signature.split('(')[0].split('.').at(-1);
   await db.exec(read(`docs/plans/2026-11-04-dialer-reliability/${name}.before.sql`));
   await db.exec(`REVOKE ALL ON FUNCTION ${row.signature} FROM PUBLIC, anon, authenticated, service_role;`);
   for(const role of ['anon','authenticated','service_role'])if(row.acl.includes(role+'=X/'))await db.exec(`GRANT EXECUTE ON FUNCTION ${row.signature} TO ${role};`);
 }
 await db.exec('SET check_function_bodies=on;');
 await db.exec('ALTER FUNCTION public.start_dialer_session(uuid) SECURITY INVOKER;');
 await assert.rejects(db.exec(read('supabase/migrations/20261105051018_dialer_reliability.sql')),/preimage drift/);
 await db.exec('ROLLBACK; ALTER FUNCTION public.start_dialer_session(uuid) SECURITY DEFINER;');
 const beforeColumns=await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='calls' AND column_name='dialer_provider_admitted'");
 assert.equal(beforeColumns.rows[0].n,0,'drift refusal happens before additive DDL');
 await db.exec(read('supabase/migrations/20261105051018_dialer_reliability.sql'));
 // Each reporting reader is executed against its complete dependency fixture in counts.mjs.
 await db.exec('SET check_function_bodies=off;');
 await db.exec('GRANT EXECUTE ON FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) TO authenticated;');
 await assert.rejects(db.exec(read('supabase/migrations/20261105051037_dialer_admitted_call_counts.sql')),/preimage drift/);
 await db.exec('ROLLBACK; REVOKE EXECUTE ON FUNCTION private.report_call_facts(uuid,timestamptz,timestamptz,uuid[]) FROM authenticated;');
 await db.exec(read('supabase/migrations/20261105051037_dialer_admitted_call_counts.sql'));
 await db.exec('SET check_function_bodies=on;');
 for(const row of metadata) {
   const current=await db.query('SELECT proacl::text acl,prosecdef security_definer,provolatile volatility,proconfig config FROM pg_proc WHERE oid=$1::regprocedure',[row.signature]);
   assert.deepEqual(current.rows[0],{acl:row.acl,security_definer:row.security_definer,volatility:row.volatility,config:row.config});
 }
 console.log('PASS both actual migrations apply; eight existing function ACLs, security modes and search paths unchanged');
 for(const suite of ['dialer_disposition_dnc','dialer_dnc_security','dialer_dnc_matrix']) {
   await db.exec(plain(read(`supabase/tests/${suite}.sql`)));
   console.log('PASS existing '+suite);
 }
 await db.exec(plain(read('supabase/tests/dialer_reliability.sql')));
 const row=await db.query(`select count(*)::int as n from pg_trigger where tgname='calls_zz_sync_provider_admission'`);
 assert.equal(row.rows[0].n,1);
 console.log('PASS dispatch failure, signed admission precedence, forged flags, legacy counts, tenancy, session mode');
 if(db.nativeUrl) await verifyDispatchContention(db.nativeUrl);
 else console.log('LIMIT: this embedded engine does not establish multi-session contention timing.');
 for(const name of ['20261105051018_dialer_reliability','20261105051037_dialer_admitted_call_counts']) {
   await assert.rejects(db.exec(read(`supabase/migrations/${name}.sql`)),/preimage drift/);
   await db.exec('ROLLBACK;');
 }
 await db.exec('SET check_function_bodies=off;');
 await db.exec('ALTER FUNCTION public.start_dialer_session(uuid) SECURITY INVOKER;');
 await assert.rejects(db.exec(read('docs/plans/2026-11-04-dialer-reliability/rollback.sql')),/rollback drift/);
 await db.exec('ROLLBACK; ALTER FUNCTION public.start_dialer_session(uuid) SECURITY DEFINER;');
 await db.exec(read('docs/plans/2026-11-04-dialer-reliability/rollback.sql'));
 for(const row of metadata) {
   const restored=await db.query('SELECT md5(prosrc) body_md5,proacl::text acl FROM pg_proc WHERE oid=$1::regprocedure',[row.signature]);
   assert.deepEqual(restored.rows[0],{body_md5:row.body_md5,acl:row.acl});
 }
 await assert.rejects(db.exec(read('docs/plans/2026-11-04-dialer-reliability/rollback.sql')),/rollback drift/);
 await db.exec('ROLLBACK;');
 console.log('PASS replay refusal, exact function rollback/ACL preservation, rollback replay refusal');
} catch(e) { console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail}));process.exitCode=1; }
finally { await db.close(); }
