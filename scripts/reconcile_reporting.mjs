// Explicit read-only transaction; never applies migrations or changes customer data.
import postgres from 'postgres';
import {readFileSync} from 'node:fs';
const org=process.argv[2],asof=process.argv[3];
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org??'')||!asof||!Number.isFinite(Date.parse(asof)))throw new Error('Usage: REPORTING_READ_ONLY_DATABASE_URL=... node scripts/reconcile_reporting.mjs <org UUID> <frozen ISO as-of>');
if(!process.env.REPORTING_READ_ONLY_DATABASE_URL)throw new Error('Read-only database connection required');
const sql=postgres(process.env.REPORTING_READ_ONLY_DATABASE_URL,{max:1,connection:{default_transaction_read_only:'on',statement_timeout:25000,application_name:'reporting-read-only-reconciliation'}});
try{
 const [row]=await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY',async tx=>{
  await tx.unsafe("SET LOCAL TIME ZONE 'UTC'");
  return tx.unsafe(readFileSync(new URL('../supabase/ops/reporting-accuracy/reconcile.sql',import.meta.url),'utf8'),[org,new Date(asof).toISOString()]);
 });
 console.log(JSON.stringify(row.reconciliation,null,2));
}finally{await sql.end({timeout:2});}
