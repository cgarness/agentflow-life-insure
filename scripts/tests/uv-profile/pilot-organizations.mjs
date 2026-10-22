/** Offline-only rehearsal of the exact approved organization setup. No remote database path. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const fixture = JSON.parse(await readFile(new URL('./fixtures/pilot-organization-functions.json', import.meta.url), 'utf8'));
const migrations = new URL('../../../supabase/migrations/', import.meta.url);
const names = (await readdir(migrations)).filter(n => n.endsWith('_uv_hosted_pilot_organizations.sql'));
assert.equal(names.length, 1);
const sql = await readFile(new URL(names[0], migrations), 'utf8');
const orgA = 'f382cd5c-48e8-4911-b915-353493e0fbc7';
const before = '11111111-1111-4111-8111-111111111111';
const tableDDL = `
CREATE SCHEMA private; CREATE SCHEMA net;
CREATE TABLE organizations(id uuid PRIMARY KEY, name text NOT NULL, slug text UNIQUE, status text DEFAULT 'active',
 twilio_subaccount_sid text, twilio_subaccount_auth_token_vault_key text, twilio_subaccount_status text DEFAULT 'pending', twilio_provisioned_at timestamptz);
CREATE TABLE appointment_types(organization_id uuid REFERENCES organizations(id), name text, color text, duration_minutes int, sort_order int, is_default boolean, is_locked boolean, is_active boolean);
CREATE TABLE lead_sources(organization_id uuid REFERENCES organizations(id), name text, color text, active boolean, sort_order int);
CREATE TABLE pipeline_stages(organization_id uuid REFERENCES organizations(id), pipeline_type text, name text, color text, sort_order int, is_default boolean, is_positive boolean, convert_to_client boolean);
CREATE TABLE private.twilio_provisioning_config(id int, supabase_url text, service_role_key text);
INSERT INTO private.twilio_provisioning_config VALUES(1,'https://synthetic.invalid','synthetic-offline-only');
CREATE TABLE net.synthetic_dispatch(body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN INSERT INTO net.synthetic_dispatch VALUES(body); RETURN 1; END $$;
INSERT INTO organizations(id,name,slug,twilio_subaccount_sid) VALUES('${before}','Existing synthetic organization','existing-synthetic','synthetic-offline-sid');
`;
const originalNotifications = await readFile(new URL('../../../supabase/migrations/20261010172702_platform_admin_registration_notifications.sql', import.meta.url), 'utf8');
const notificationDDL = originalNotifications.match(/CREATE TABLE public\.platform_admin_notifications \([\s\S]*?\n\);/)[0];
async function db() {
 const d = new PGlite();
 await d.exec(tableDDL + notificationDDL);
 for (const f of [...fixture.seed_functions, ...fixture.trigger_functions]) await d.exec(f.definition);
 for (const t of fixture.triggers) await d.exec(t.def);
 return d;
}
async function snapshot(d) {
 const out = {};
 for (const name of ['organizations','appointment_types','lead_sources','pipeline_stages','platform_admin_notifications','net.synthetic_dispatch']) {
  out[name] = (await d.query(`SELECT to_jsonb(x) AS row FROM ${name} x ORDER BY to_jsonb(x)::text`)).rows;
 }
 out.triggers = (await d.query("SELECT tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='organizations'::regclass AND NOT tgisinternal ORDER BY tgname")).rows;
 return out;
}
async function execute(d, text) {
 await d.exec('BEGIN');
 try { await d.exec(text); await d.exec('COMMIT'); }
 catch (e) { await d.exec('ROLLBACK'); throw e; }
}
const success = await db();
await execute(success, sql);
assert.equal((await success.query('SELECT * FROM organizations')).rows.length, 3);
assert.equal((await success.query('SELECT * FROM appointment_types')).rows.length, 12);
assert.equal((await success.query('SELECT * FROM lead_sources')).rows.length, 16);
assert.equal((await success.query('SELECT * FROM pipeline_stages')).rows.length, 22);
assert.equal((await success.query('SELECT * FROM net.synthetic_dispatch')).rows.length, 0);
assert.deepEqual((await success.query('SELECT DISTINCT status,attempts FROM platform_admin_notifications')).rows, [{status:'skipped',attempts:0}]);
const applied = await snapshot(success);
await assert.rejects(execute(success,sql), /identity already exists/);
assert.deepEqual(await snapshot(success), applied);
// Ordinary future inserts still provision after the approved exception ends.
await success.exec("INSERT INTO organizations(id,name,slug) VALUES('22222222-2222-4222-8222-222222222222','Normal synthetic organization','normal-synthetic')");
assert.equal((await success.query('SELECT * FROM net.synthetic_dispatch')).rows.length, 1);
assert.equal((await success.query("SELECT count(*)::int AS n FROM platform_admin_notifications WHERE status='pending'")).rows[0].n, 1);
await success.close();
console.log('PASS success, skipped notifications, replay refusal, restored ordinary provisioning');
for (const point of ['  INSERT INTO public.organizations(id,name', '  ALTER TABLE public.organizations ENABLE TRIGGER', '  IF before_triggers IS DISTINCT FROM after_triggers']) {
 const d = await db(), prior = await snapshot(d);
 const broken = sql.replace(point, "  RAISE EXCEPTION 'injected rollback';\n" + point);
 await assert.rejects(execute(d,broken), /injected rollback/);
 assert.deepEqual(await snapshot(d), prior);
 await d.close();
 console.log('PASS rollback at ' + point.trim());
}
for (const [setup, match] of [
 ["ALTER TABLE organizations DISABLE TRIGGER on_organization_created_provision_twilio", /trigger inventory changed/],
 ["CREATE TRIGGER extra_org_trigger AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION handle_new_organization_seed_lead_sources()", /trigger inventory changed/],
 ["CREATE OR REPLACE FUNCTION public.seed_default_lead_sources(p_organization_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$", /dependency changed/],
 [`INSERT INTO organizations(id,name) VALUES('${orgA}','Collision')`, /identity already exists/],
 ["INSERT INTO platform_admin_notifications(event_type,subject_id) VALUES('user_registered','1721a969-5ab0-45c8-97cb-96205f26c6fe')", /notification identity already exists/],
 ["ALTER TABLE lead_sources ADD CONSTRAINT fail_seed CHECK (false)", /default seeds incomplete/]
]) {
 const d = await db(); await d.exec(setup); const prior = await snapshot(d);
 await assert.rejects(execute(d,sql), match);
 assert.deepEqual(await snapshot(d), prior);
 await d.close(); console.log('PASS refusal/rollback: ' + match.source);
}
console.log('10 offline scenarios passed. Native lock contention is not simulated by PGlite.');
