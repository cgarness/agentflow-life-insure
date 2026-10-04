// Disposable PostgreSQL only. No production URL accepted.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),root=process.env.PGLITE_PACKAGE;
if(!root) throw new Error('PGLITE_PACKAGE required');
const {PGlite}=require(root),{ltree}=require(root+'/dist/contrib/ltree.cjs');
const db=new PGlite({extensions:{ltree}});
const mode=process.argv[2]??'policy';
try {
 for(const [label,sql] of JSON.parse(execFileSync('python3',['scripts/reporting_fixture.py',mode,'--json'],{encoding:'utf8'}))) {
  await db.exec('BEGIN;\n'+sql+'\nCOMMIT;'); console.log('PASS',label);
 }
 console.log('LIMIT: multi-session contention requires native PostgreSQL.');
}catch(e){console.error(JSON.stringify({message:e.message,where:e.where,detail:e.detail}));process.exitCode=1;}finally{await db.close()}
