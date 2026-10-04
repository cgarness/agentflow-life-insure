// Safer fallback when this environment cannot start native PostgreSQL.
// No network/database URL: all fixtures live inside one disposable WASM runtime.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const root=process.env.PGLITE_PACKAGE;
if(!root)throw new Error('Set PGLITE_PACKAGE to an installed @electric-sql/pglite package directory');
const {PGlite}=require(root);
const {ltree}=require(`${root}/dist/contrib/ltree.cjs`);
const db=new PGlite({extensions:{ltree}});
try {
 console.log('Engine:',(await db.query('SELECT version() AS v')).rows[0].v);
 for(const [label,source] of [
  ['exact production-function fixture',execFileSync('python3',['scripts/policy_sale_fixture.py'],{encoding:'utf8'})],
  ['new migration',readFileSync('supabase/migrations/20261004000819_leaderboard_sale_recording.sql','utf8')],
  ['sale/auth/rollback regression suite',readFileSync('supabase/tests/policy_sale_recording.sql','utf8')],
 ]){
  await db.exec(`BEGIN;\n${source}\nCOMMIT;`);
  console.log('PASS',label);
 }
 console.log('LIMIT: one embedded session; independent-session contention requires the native PostgreSQL runner.');
} catch(error){
 console.error(JSON.stringify({message:error.message,where:error.where,detail:error.detail}));process.exitCode=1;
} finally {await db.close();}
