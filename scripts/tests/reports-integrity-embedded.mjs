// Embedded PostgreSQL SQL/role semantics only; not a native/concurrency claim.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
if(!process.env.PGLITE_PACKAGE)throw new Error('PGLITE_PACKAGE required');
const {PGlite}=require(process.env.PGLITE_PACKAGE);
const db=new PGlite();
try {
 for(const [name,sql] of JSON.parse(execFileSync('python3',['scripts/reports_integrity_fixture.py','--json'],{encoding:'utf8',maxBuffer:8*1024*1024}))) {
  await db.exec('BEGIN;\n'+sql+'\nCOMMIT;', {onNotice: notice => { if(notice.message?.includes('Scale summary') || notice.message?.includes('Selective window plan')) console.log('NOTICE',notice.message); }}); console.log('PASS',name);
 }
 if(process.env.REPORTS_SQL_PAYLOADS) {
  const sql=execFileSync('python3',['scripts/reports_integrity_fixture.py','--payload-sql'],{encoding:'utf8'});
  const result=await db.query(sql);
  writeFileSync(process.env.REPORTS_SQL_PAYLOADS,JSON.stringify(Object.values(result.rows[0])[0]));
  console.log('PASS synthetic SQL payloads exported for runtime schema verification');
 }
 console.log('LIMIT: native PostgreSQL, hosted API and browser checks remain separate.');
}catch(e){console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail}));process.exitCode=1;}finally{await db.close()}
