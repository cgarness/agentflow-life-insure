// Isolated PostgreSQL engine; never connects to a remote database.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const modulePath = process.env.A2P_PGLITE_MODULE;
if (!modulePath) throw new Error("Set A2P_PGLITE_MODULE to the installed @electric-sql/pglite module path.");
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
try {
  await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create table organizations(id uuid primary key);
 create table profiles(id uuid primary key, organization_id uuid, status text,role text,email text,email_notifications_enabled boolean default true);
 create table phone_numbers(id uuid primary key,organization_id uuid);
 create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,organization_id uuid,type text,title text,body text,action_url text,action_label text,event_key text);
 create unique index notifications_event_key on notifications(user_id,event_key) where event_key is not null;
 grant select on profiles to authenticated;
 grant all on all tables in schema public to service_role;
 `);
  await db.exec(await readFile("supabase/migrations/20261003174429_a2p_registration_workflow.sql", "utf8"));
  await db.exec(await readFile("supabase/tests/a2p_registration.sql", "utf8"));
  console.log("A2P migration, RLS, stale sync, ordered events, notification idempotency: PASS");
} finally {
  await db.close();
}
