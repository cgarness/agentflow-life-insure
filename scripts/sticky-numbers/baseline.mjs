import postgres from 'postgres';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const url='postgres://postgres@127.0.0.1:55473/postgres';
assert.equal(new URL(url).hostname,'127.0.0.1');
const admin=postgres(url,{max:1,onnotice:()=>{}});
const name='sticky_baseline';
await admin.unsafe(`drop database if exists ${name} with (force)`);
await admin.unsafe(`drop role if exists agentflow_comp_operator,agentflow_policy_commission_writer`);
await admin.unsafe(`create database ${name} encoding 'UTF8' template template0`);
for(const role of ['anon','authenticated','service_role','supabase_auth_admin']) {
 if(!(await admin`select 1 from pg_roles where rolname=${role}`).length) await admin.unsafe(`create role ${role} nologin ${role==='service_role'?'bypassrls':''}`);
}
const target=new URL(url);target.pathname='/'+name;
const db=postgres(target.toString(),{max:1,onnotice:()=>{}});
// Reviewed production-only data/activation operations cannot be replayed as a synthetic seed.
const operations=new Set(['20261008024220_cg_financial_number_event_reconcile.sql','20261008033044_cg_financial_sms_recovery.sql','20261008035004_cg_financial_sms_activate.sql','20261019005810_uv_hosted_pilot_organizations.sql','20261019013824_uv_agency_profile_activation.sql','20261024045812_hierarchy_path_repair.sql']);
const log=[];
try {
 await db.unsafe(await fs.readFile(new URL('platform-bootstrap.sql',import.meta.url),'utf8'));
 const files=(await fs.readdir(path.join(root,'supabase/migrations'))).filter(x=>x.endsWith('.sql')&&!x.includes('sticky_contact_numbers')).sort();
 for(const file of files){
  if(operations.has(file)){
   if(file==='20261019013824_uv_agency_profile_activation.sql') {
    const source=await fs.readFile(path.join(root,'supabase/migrations',file),'utf8');
    const call=source.match(/PERFORM cron[.]schedule[\s\S]*?\$job\$\);/)[0].replace('PERFORM','SELECT');
    await db.unsafe(call);log.push({file,status:'inert-schedule-metadata-only',call});
   } else log.push({file,status:'excluded-production-operation'});
   continue;
  }
  if(['20261105120020_policy_sale_premium_corrections.sql','20261105120030_policy_sale_call_links.sql','20261105120040_appointment_type_categories.sql'].includes(file)) {
   await db.unsafe(await fs.readFile(path.join(root,'supabase/ops/reports_v3_disable.sql'),'utf8'));
   log.push({file:'supabase/ops/reports_v3_disable.sql',before:file,status:'release-sequence'});
  }
  let sql=await fs.readFile(path.join(root,'supabase/migrations',file),'utf8');
  const disabled=[];
  sql=sql.replace(/CREATE EXTENSION IF NOT EXISTS "?(pg_cron|pg_net|supabase_vault)"?[^;]*;/gi,(s)=>{disabled.push(s);return '-- Platform network/scheduler extension intentionally absent in isolated harness.';});
  try{if(/CREATE (UNIQUE )?INDEX CONCURRENTLY/i.test(sql)){await db.unsafe('RESET ALL');for(const statement of sql.replace(/--[^\n]*/g,'').split(';').filter(x=>x.trim())) await db.unsafe(statement);}else await db.unsafe('RESET ALL;BEGIN;'+sql+'\nCOMMIT;'); log.push({file,status:'applied',disabled});console.log('APPLIED',file);}
  catch(e){await db.unsafe('rollback');log.push({file,status:'failed',message:e.message,where:e.where,detail:e.detail,position:e.position});await fs.writeFile(new URL('failed.sql',import.meta.url),sql);throw e;}
 }
 // Complete as-applied captures are included in the recovery evidence; never execute these against production.
 const captures=JSON.parse(await fs.readFile(new URL('../../../evidence/live/baseline-extra-applied.json',import.meta.url),'utf8'));
 for(const capture of captures){await db.unsafe('RESET ALL');await db.unsafe(capture.statements.join('\n'));log.push({file:capture.version,status:'applied-readonly-capture',md5:capture.statements_md5});}
 const comparison={functions:[],tables:[],platform:await db`select extname,extversion from pg_extension order by extname`};
 for(const kind of ['functions','tables','extra-tables']){
  const query=await fs.readFile(new URL(`../../../evidence/catalog-${kind}-query.sql`,import.meta.url),'utf8');const actual=await db.unsafe(query);
  const expected=JSON.parse(await fs.readFile(new URL(`../../../evidence/live/${kind==='extra-tables'?kind:'telephony-'+kind}.json`,import.meta.url),'utf8'));
  await fs.writeFile(new URL(`../../../evidence/local-${kind}.json`,import.meta.url),JSON.stringify(actual,null,2));
  const key=kind==='functions'?'signature':'relname';
  for(const e of expected){const a=actual.find(x=>x[key]===e[key]&&x.schema===e.schema);comparison[kind==='functions'?'functions':'tables'].push({schema:e.schema,name:e[key],diff:a?Object.keys(e).filter(k=>JSON.stringify(e[k])!==JSON.stringify(a[k])):['missing']});}
 }
 await fs.writeFile(new URL('../../../evidence/baseline-comparison.json',import.meta.url),JSON.stringify(comparison,null,2));
 assert.equal([...comparison.functions,...comparison.tables].filter(x=>x.diff.length).length,0,'Native baseline differs from captured production catalog');
 console.log('CATALOG MATCH',comparison.functions.length,'functions',comparison.tables.length,'tables');

}catch(e){console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail,position:e.position}));process.exitCode=1;}
finally{await fs.writeFile(new URL('../../../evidence/baseline-replay.json',import.meta.url),JSON.stringify(log,null,2));await db.end();await admin.end();}
