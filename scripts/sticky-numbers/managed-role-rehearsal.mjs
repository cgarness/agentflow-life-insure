import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const postgres=createRequire(process.cwd()+'/package.json')('postgres');
const hash=x=>createHash('sha256').update(x).digest('hex');
// Disposable native PostgreSQL 17 only. Run from the candidate repository root:
// node scripts/sticky-numbers/managed-role-rehearsal.mjs /absolute/scratch/rehearsal
// Prerequisites: a loopback-only cluster on port 55473 initialized with bootstrap
// superuser sandbox_super (not postgres); postgres must be a separate login role.
// Build sticky_baseline with the existing baseline.mjs first while postgres is a
// temporary local superuser. The baseline must match the captured production catalog.
// The scratch input directory must contain frozen/release/{install.sql,readback.sql,
// expected-postimages.json,guard_only.sql}, the original foundation under
// frozen/supabase/migrations/, and reproduce/release-rehearsal.mjs. The frozen files
// are read only. This script demotes the synthetic postgres role, drops/recreates only
// sticky_candidate, and writes revised artifacts/evidence under that scratch directory.
// No connection URL, hostname, port, role or database can be supplied by the caller.
assert.equal(process.argv.length,3,'One absolute local scratch directory is required');
assert.ok(path.isAbsolute(process.argv[2]),'Scratch directory must be an absolute local path');
const root=path.resolve(process.argv[2]);
await fs.mkdir(root+'/evidence',{recursive:true});
const report={checked_at:new Date().toISOString(),status:'running'};
const before=postgres('postgres://sandbox_super@127.0.0.1:55473/postgres',{max:1,onnotice:()=>{}});
const bootstrap=(await before`SELECT current_user,session_user,oid,rolsuper FROM pg_roles WHERE rolname=current_user`)[0];
assert.equal(bootstrap.current_user,'sandbox_super');assert.equal(bootstrap.session_user,'sandbox_super');assert.equal(Number(bootstrap.oid),10);assert.equal(bootstrap.rolsuper,true);
const managed=(await before`SELECT oid FROM pg_roles WHERE rolname='postgres'`)[0];assert.ok(managed);assert.notEqual(Number(managed.oid),10,'postgres must not be the cluster bootstrap superuser');
await before.unsafe('GRANT authenticated,anon,service_role TO postgres WITH ADMIN OPTION; ALTER ROLE postgres NOSUPERUSER CREATEROLE CREATEDB INHERIT BYPASSRLS;');
await before.end();
const admin=postgres('postgres://sandbox_super@127.0.0.1:55473/postgres',{max:1,onnotice:()=>{}});
const connection='postgres://postgres@127.0.0.1:55473/sticky_candidate';
const old=await fs.readFile(root+'/frozen/release/install.sql','utf8');
assert.equal(hash(old),'8fc2e2f9822829e55496570d0c1ade708a969e3937e4de73f153ad0bbcf35bfc');
const name='20261114003115_sticky_contact_numbers_foundation.sql';
const prior=await fs.readFile(root+'/frozen/supabase/migrations/'+name,'utf8');
assert.equal(hash(prior),'3ab479c4553d5d0087a1ee0acd4e2baada84b5255726aeb6db3eda6f107e7d39');
const corrected=await fs.readFile('supabase/migrations/'+name,'utf8');
assert.equal(hash(corrected),'3730a454e79acd793324ba1cc08e3a8a0d05f270b5b0af399f9842675937ed4c');
assert.equal(old.split(prior).length-1,2,'Execution and exact recorded source must both change');
const revised=old.replaceAll(prior,()=>corrected);
assert.equal(hash(revised),'1d2d1a4d0a7872f6bc1e5c37e940fd37e8f4758c1ced56cda8df24017a9175b9');
await fs.mkdir(root+'/revised/release',{recursive:true});
await fs.mkdir(root+'/revised/supabase/migrations',{recursive:true});
await fs.writeFile(root+'/revised/release/install.sql',revised);
for(const file of ['readback.sql','expected-postimages.json','guard_only.sql'])await fs.copyFile(root+'/frozen/release/'+file,root+'/revised/release/'+file);
await fs.mkdir(root+'/revised/reproduce',{recursive:true});
await fs.copyFile(root+'/reproduce/release-rehearsal.mjs',root+'/revised/reproduce/release-rehearsal.mjs');
const files=(await fs.readdir('supabase/migrations')).filter(x=>x.includes('sticky_contact_numbers')&&x.endsWith('.sql')).sort();
const manifest={migrations:[]};
for(const file of files){const bytes=await fs.readFile('supabase/migrations/'+file);await fs.writeFile(root+'/revised/supabase/migrations/'+file,bytes);manifest.migrations.push({path:'supabase/migrations/'+file,version:file.slice(0,14),name:file.slice(15,-4),bytes:bytes.length,sha256:hash(bytes)});}
manifest.release_files=[{path:'release/install.sql',bytes:Buffer.byteLength(revised),sha256:hash(revised)}];
await fs.writeFile(root+'/revised/release-manifest.provisional.json',JSON.stringify(manifest,null,2)+'\n');
const notices=[];
async function fresh(){await admin.unsafe('DROP DATABASE IF EXISTS sticky_candidate WITH (force)');await admin.unsafe('DROP ROLE IF EXISTS agentflow_affinity_scope');await admin.unsafe('CREATE DATABASE sticky_candidate OWNER postgres TEMPLATE sticky_baseline');const db=postgres(connection,{max:1,onnotice:n=>notices.push(n)});await db.unsafe('CREATE SCHEMA IF NOT EXISTS supabase_migrations;CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text);');return db;}
let db;
try{
 db=await fresh();
 report.runtime=(await db`select version(),current_user,session_user,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolinherit from pg_roles where rolname=current_user`)[0];
 assert.equal(report.runtime.rolsuper,false);assert.equal(report.runtime.rolcreaterole,true);assert.equal(report.runtime.rolbypassrls,true);
 await assert.rejects(db.unsafe(old),e=>{report.original_failure={code:e.code,message:e.message};return e.code==='42501'&&e.message.includes('must be able to SET ROLE');});
 await db.unsafe('ROLLBACK');
 const absence=(await db`select (select count(*)::int from pg_roles where rolname='agentflow_affinity_scope') as roles,(select count(*)::int from pg_tables where schemaname='private' and tablename like 'contact_number_%') as tables,(select count(*)::int from supabase_migrations.schema_migrations) as history`)[0];
 assert.deepEqual({...absence},{roles:0,tables:0,history:0});report.original_transaction_rollback=absence;
 await db.unsafe(revised);
 const readback=(await fs.readFile(root+'/revised/release/readback.sql','utf8')).split(';').filter(x=>x.trim());
 const expected=JSON.parse(await fs.readFile(root+'/revised/release/expected-postimages.json','utf8'));
 for(const [i,key] of ['functions','tables','roles'].entries()){const actual=JSON.parse(JSON.stringify(await db.unsafe(readback[i])));assert.deepEqual(actual,expected[key],key+' postimage drift');report[key+'_matched']=actual.length;}
 report.memberships=await db`select member::regrole::text as member,roleid::regrole::text as granted_role,grantor::regrole::text as grantor,admin_option,inherit_option,set_option from pg_auth_members where roleid='agentflow_affinity_scope'::regrole or member='agentflow_affinity_scope'::regrole order by roleid,member,grantor`;
 report.access=(await db`select pg_has_role('postgres','agentflow_affinity_scope','USAGE') as postgres_inherit,pg_has_role('postgres','agentflow_affinity_scope','SET') as postgres_set,has_schema_privilege('agentflow_affinity_scope','private','CREATE') as scope_create,has_function_privilege('postgres','private.affinity_contact_scope(uuid,uuid,text,text)','EXECUTE') as postgres_helper`)[0];
 assert.deepEqual({...report.access},{postgres_inherit:true,postgres_set:true,scope_create:false,postgres_helper:true});
 report.client_access=await db`select r.role,pg_has_role(r.role,'agentflow_affinity_scope','MEMBER') as member,pg_has_role(r.role,'agentflow_affinity_scope','SET') as can_set,has_schema_privilege(r.role,'private','CREATE') as schema_create,has_function_privilege(r.role,'private.affinity_contact_scope(uuid,uuid,text,text)','EXECUTE') as helper_execute from (values('anon'),('authenticated'),('service_role')) r(role)`;
 for(const r of report.client_access){assert.equal(r.member,false);assert.equal(r.can_set,false);assert.equal(r.schema_create,false);assert.equal(r.helper_execute,false);}
 report.history=await db`select version,name,cardinality(statements)::int as statement_count,encode(sha256(convert_to(statements[1],'UTF8')),'hex') as source_sha256 from supabase_migrations.schema_migrations order by version`;
 for(const [i,row] of report.history.entries()){assert.equal(row.source_sha256,manifest.migrations[i].sha256);assert.equal(row.statement_count,1);}
 assert.equal(report.history.length,5);
 report.initial_rows=(await db`select (select count(*)::int from private.contact_number_settings) settings,(select count(*)::int from private.contact_number_enforcement) enforcement,(select count(*)::int from private.contact_number_affinities) affinities,(select count(*)::int from private.contact_number_events) events`)[0];
 assert.deepEqual({...report.initial_rows},{settings:0,enforcement:0,affinities:0,events:0});
 report.installer={sha256:hash(revised),bytes:Buffer.byteLength(revised)};
 report.corrected_foundation=manifest.migrations[0];
 report.acl_warning_count=notices.filter(n=>n.message?.includes('no privileges could be')).length;assert.equal(report.acl_warning_count,0);
 await db.end();db=undefined;
 const result=spawnSync(process.execPath,['scripts/sticky-numbers/database-tests.mjs'],{encoding:'utf8',env:{...process.env,STICKY_TEST_URL:connection,STICKY_RESULTS:root+'/evidence/managed-database-tests.json',STICKY_TEST_GROUP:''}});
 await fs.writeFile(root+'/evidence/managed-database-tests.log',result.stdout+result.stderr);
 const checks=JSON.parse(await fs.readFile(root+'/evidence/managed-database-tests.json','utf8'));
 report.database_tests={exit_code:result.status,passed:checks.filter(x=>x.status==='passed').length,total:checks.length,failed:checks.filter(x=>x.status!=='passed')};
 assert.equal(result.status,0,'Managed postgres functional suite failed');assert.equal(checks.length,66);assert.equal(report.database_tests.passed,66);
 const atomic=spawnSync(process.execPath,[root+'/revised/reproduce/release-rehearsal.mjs'],{encoding:'utf8',env:{...process.env,STICKY_TEST_URL:connection,STICKY_RELEASE_EVIDENCE_DIR:root+'/evidence',STICKY_RELEASE_RUN_DATABASE_TESTS:'0'}});
 await fs.writeFile(root+'/evidence/managed-atomic-rehearsal.log',atomic.stdout+atomic.stderr);
 const releaseChecks=JSON.parse(await fs.readFile(root+'/evidence/release-rehearsal.json','utf8'));
 report.atomic_rehearsal={exit_code:atomic.status,passed:releaseChecks.filter(x=>x.passed).length,total:releaseChecks.length};
 assert.equal(atomic.status,0);assert.equal(releaseChecks.length,7);assert.equal(report.atomic_rehearsal.passed,7);
 report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,code:error.code,where:error.where};throw error;}
finally{if(db)await db.end();await admin.end();await fs.writeFile(root+'/evidence/managed-role-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
