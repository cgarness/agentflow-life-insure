// Both engines are disposable. Never accepts a linked/hosted application database.
import {createRequire} from 'node:module';
import postgres from 'postgres';
const require=createRequire(import.meta.url);
let sequence=0;
export async function openSyntheticDatabase() {
  if(process.env.PGURL && process.env.PGLITE_PACKAGE) throw new Error('Choose one test engine');
  if(!process.env.PGURL) {
    if(!process.env.PGLITE_PACKAGE) throw new Error('Set PGLITE_PACKAGE or disposable loopback PGURL');
    const {PGlite}=require(process.env.PGLITE_PACKAGE);
    const {ltree}=require(process.env.PGLITE_PACKAGE+'/dist/contrib/ltree.cjs');
    return new PGlite({extensions:{ltree}});
  }
  const root=new URL(process.env.PGURL);
  if(!['postgres:','postgresql:'].includes(root.protocol) || !['127.0.0.1','localhost'].includes(root.hostname)
      || !['','/'].includes(root.pathname) || root.search || root.hash)
    throw new Error('REFUSING: disposable loopback cluster URL without database required');
  const adminUrl=new URL(root);adminUrl.pathname='/postgres';
  const admin=postgres(adminUrl.toString(),{max:1});
  let sql, name;
  try {
    const [platform]=await admin`select count(*)::int n from pg_roles where rolname in ('supabase_admin','authenticator','supabase_auth_admin')`;
    if(platform.n) throw new Error('REFUSING: hosted platform roles present');
    name=`dialer_reliability_${process.pid}_${++sequence}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url=new URL(root);url.pathname='/'+name;
    sql=postgres(url.toString(),{max:1,prepare:false,onnotice:()=>{}});
    return {
      nativeUrl:url.toString(),
      exec:query=>sql.unsafe(query),
      query:async(query,params=[])=>({rows:await sql.unsafe(query,params)}),
      close:async()=>{try{await sql.end();await admin.unsafe(`DROP DATABASE ${name}`);}finally{await admin.end();}},
    };
  } catch(error) {
    if(sql) await sql.end();
    if(name) await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();throw error;
  }
}
