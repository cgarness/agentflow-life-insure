// Run from the repository root, inside run-local.sh. No external database URL is accepted.
import postgres from 'postgres';import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const task=process.argv[2]??'database';
if(!['database','edge','browser','performance'].includes(task))throw Error('Unknown isolated task');
const url='postgres://postgres@127.0.0.1:55473/sticky_candidate';
const admin=postgres(url.replace('/sticky_candidate','/postgres'),{max:1,onnotice:()=>{}});
await admin.unsafe('drop database if exists sticky_candidate with (force)');await admin.unsafe('drop role if exists agentflow_affinity_scope');await admin.unsafe('create database sticky_candidate template sticky_baseline');await admin.end();
const db=postgres(url,{max:1,onnotice:()=>{}});
try{for(const file of (await fs.readdir('supabase/migrations')).filter(x=>x.includes('sticky_contact_numbers')).sort())await db.unsafe('BEGIN;'+await fs.readFile('supabase/migrations/'+file,'utf8')+'\nCOMMIT;');}finally{await db.end();}
const script=task==='edge'||task==='browser'?'edge-tests.mjs':task==='performance'?'performance.mjs':'database-tests.mjs';
const result=spawnSync(process.execPath,['scripts/sticky-numbers/'+script],{stdio:'inherit',env:{...process.env,STICKY_TEST_URL:url,STICKY_RESULTS:'../evidence/database-tests.json',STICKY_BROWSER:task==='browser'?'1':'0'}});
process.exitCode=result.status??1;
