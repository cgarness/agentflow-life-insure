// Hierarchy stabilization — shared PostgREST harness for the HTTP stages (postgrest_forged.mjs and the frontend
// compatibility suite src/test/integration/hierarchyFrontendCompat.integration.test.ts). DISPOSABLE LOCAL PostgreSQL
// ONLY; synthetic data only (AGENT_RULES invariant #28). Lives in lib/ so the runner's `*.mjs` discovery skips it.
// Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §8, §R (R1, R2).
//
// Contract with scripts/run_hierarchy_stabilization_tests.sh: one database per state in HIERARCHY_DB_<STATE>
// (HIERARCHY_STATES lists the states), PGURL = the cluster without a database, POSTGREST_BIN = PostgREST 12.2.3.
// Every stage CLONES each state database (CREATE DATABASE <name>_<suffix> TEMPLATE <name>) and drops its clones when
// it ends, so one stage's writes can never reach another stage. Each clone gets its own PostgREST process, whose
// authenticator role (<HIER_REST_ROLE_PREFIX><pid>_<n>; the runner sets the prefix to hier_<its pid>_rest_ so its
// leftover check sees only this run's roles; default hier_rest_; never the hosted name "authenticator") is created
// and dropped here.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import postgres from 'postgres';

export const HIERARCHY_STATES = ['S0', 'S1', 'S2', 'S3', 'S1R', 'S2R', 'S3R'];
export const SENTINEL = 'agentflow-hierarchy-synthetic-fixture';
const HOSTED_ROLES = ['supabase_admin', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user'];
const DB_NAME = /^hier_[a-z0-9_]{1,59}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** What is live in each state (the same flags the runner passes to the per-state SQL suites). */
export function stateFlags(state) {
  if (!HIERARCHY_STATES.includes(state)) throw new Error(`unknown hierarchy state ${state}`);
  return {
    m1: ['S1', 'S2', 'S3', 'S2R'].includes(state),
    m2: ['S2', 'S3'].includes(state),
    repaired: ['S3', 'S3R'].includes(state),
    anonRevoked: state !== 'S0',
    // compute_hierarchy_path / update_hierarchy_path / cascade_hierarchy_update: revoked by M1, kept by both rollbacks.
    computeRevoked: state !== 'S0',
  };
}

/** Refuse anything but postgres(ql)://postgres[:pw]@<loopback>:<port>[/hier_*]. */
export function assertLocalUrl(url, label) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`${label}: not a URL`); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !LOOPBACK.has(u.hostname) || u.username !== 'postgres') {
    throw new Error(`${label}: only a loopback postgres superuser URL is accepted (disposable local cluster)`);
  }
  const db = u.pathname.replace(/^\//, '');
  if (db && !DB_NAME.test(db)) throw new Error(`${label}: database name must match ${DB_NAME}`);
  return u;
}

/** [{ state, url }] from HIERARCHY_STATES / HIERARCHY_DB_<STATE>; refuses anything that is not a local hier_* db. */
export function stateDatabasesFromEnv(env = process.env) {
  const states = (env.HIERARCHY_STATES ?? '').split(/\s+/).filter(Boolean);
  if (states.length === 0) throw new Error('HIERARCHY_STATES is empty');
  return states.map((state) => {
    stateFlags(state);
    const url = env[`HIERARCHY_DB_${state}`];
    if (!url) throw new Error(`HIERARCHY_DB_${state} is not set`);
    const u = assertLocalUrl(url, `HIERARCHY_DB_${state}`);
    if (!u.pathname.replace(/^\//, '')) throw new Error(`HIERARCHY_DB_${state} names no database`);
    return { state, url };
  });
}

const connect = (url, max = 2) => postgres(url, { max, onnotice: () => {}, idle_timeout: 5, connect_timeout: 10 });
const withDatabase = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

/** Same proof as hs_prove_local: loopback server, postgres superuser, no hosted roles, no production-named db. */
export async function proveLocal(sql) {
  const [row] = await sql`
    SELECT coalesce(host(inet_server_addr()), 'unix-socket') AS addr, current_user AS usr,
           (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) AS su,
           (SELECT count(*)::int FROM pg_catalog.pg_roles WHERE rolname = ANY (${HOSTED_ROLES})) AS hosted,
           EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'jncvvsvckxhqgqvkppmj') AS prodref`;
  if (!['127.0.0.1', '::1', 'unix-socket'].includes(row.addr)) throw new Error('refusing: server address is not loopback');
  if (row.usr !== 'postgres' || row.su !== true) throw new Error('refusing: not connected as the postgres superuser');
  if (row.hosted !== 0) throw new Error('refusing: hosted platform roles exist on this server');
  if (row.prodref) throw new Error('refusing: a database named after the production project exists on this server');
}

/** Same proof as hs_prove_synthetic: the fixture's sentinel and synthetic profile names only. */
export async function proveSynthetic(sql) {
  const [row] = await sql`
    SELECT (SELECT string_agg(marker, ',') FROM hierarchy_test.synthetic_sentinel) AS marker,
           (SELECT count(*)::int FROM public.profiles WHERE first_name NOT LIKE 'Synthetic %') AS others`;
  if (row.marker !== SENTINEL) throw new Error('refusing: database lacks the synthetic sentinel');
  if (row.others !== 0) throw new Error('refusing: database holds non-synthetic profile rows');
}

/**
 * CREATE DATABASE <source>_<suffix> TEMPLATE <source> on the same local cluster. A leftover clone of the same name
 * (an aborted earlier run) is dropped first, but only after it proves synthetic. Returns { url, name, drop }.
 */
export async function cloneDatabase(sourceUrl, suffix) {
  const src = assertLocalUrl(sourceUrl, 'clone source');
  const srcName = src.pathname.replace(/^\//, '');
  const name = `${srcName}_${suffix}`;
  if (!DB_NAME.test(name) || name.length > 63) throw new Error(`clone name ${name} is not a valid hier_* name`);
  const cluster = connect(withDatabase(sourceUrl, 'postgres'), 1);
  try {
    await proveLocal(cluster);
    const source = connect(sourceUrl, 1);
    try { await proveSynthetic(source); } finally { await source.end(); }
    const [{ exists }] = await cluster`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists`;
    if (exists) {
      const old = connect(withDatabase(sourceUrl, name), 1);
      try { await proveSynthetic(old); } finally { await old.end(); }
      await cluster.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    }
    await cluster.unsafe(`CREATE DATABASE ${name} TEMPLATE ${srcName}`);
  } finally {
    await cluster.end();
  }
  const url = withDatabase(sourceUrl, name);
  return {
    url,
    name,
    async drop() {
      const c = connect(withDatabase(sourceUrl, 'postgres'), 1);
      try {
        await proveLocal(c);
        await c.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}

let roleCounter = 0;
const ROLE_PREFIX = process.env.HIER_REST_ROLE_PREFIX ?? 'hier_rest_';
if (!/^hier_[a-z0-9_]{0,40}$/.test(ROLE_PREFIX)) throw new Error('HIER_REST_ROLE_PREFIX must match ^hier_[a-z0-9_]{0,40}$');
/** A LOGIN NOINHERIT authenticator for one PostgREST process (member of anon, authenticated, service_role). */
export async function createAuthenticator(clusterUrl) {
  const role = `${ROLE_PREFIX}${process.pid}_${(roleCounter += 1)}`;
  const password = randomBytes(18).toString('hex');
  const cluster = connect(withDatabase(clusterUrl, 'postgres'), 1);
  try {
    await proveLocal(cluster);
    await cluster.unsafe(`DROP ROLE IF EXISTS ${role}`);
    await cluster.unsafe(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${password}'`);
    await cluster.unsafe(`GRANT anon, authenticated, service_role TO ${role}`);
  } finally {
    await cluster.end();
  }
  return {
    role,
    password,
    async drop() {
      const c = connect(withDatabase(clusterUrl, 'postgres'), 1);
      try { await c.unsafe(`DROP ROLE IF EXISTS ${role}`); } finally { await c.end(); }
    },
  };
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** HS256 JWT signed with `secret` (PostgREST's PGRST_JWT_SECRET). `ttl` seconds; negative = already expired. */
export function mintJwt(secret, claims, ttl = 3600) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + ttl, ...claims })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
/** An unsigned ("alg": "none") token carrying the same claims. */
export function unsignedJwt(claims) {
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}.`;
}
export const newJwtSecret = () => randomBytes(32).toString('hex');

/**
 * Supabase-shaped claims for a profile row: role authenticated, app_metadata.{role, organization_id} and the
 * top-level is_super_admin the custom access token hook copies from the profile. Pass overrides to forge a stale or
 * mismatched token (the database row is not consulted).
 */
export function profileClaims(profile, overrides = {}) {
  return {
    sub: profile.id,
    role: 'authenticated',
    aud: 'authenticated',
    is_super_admin: overrides.is_super_admin ?? (profile.is_super_admin === true),
    app_metadata: {
      role: overrides.role ?? profile.role,
      organization_id: overrides.organization_id ?? profile.organization_id,
    },
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Start PostgREST for one database; resolves once it serves its root. Returns { base, version, stop }. */
export async function startPostgrest({ bin, dbUrl, authenticator, secret }) {
  if (!bin) throw new Error('POSTGREST_BIN is required');
  const port = await freePort();
  const dbUri = new URL(dbUrl);
  dbUri.username = authenticator.role;
  dbUri.password = authenticator.password;
  let log = '';
  const child = spawn(bin, [], {
    env: {
      PATH: process.env.PATH,
      PGRST_DB_URI: dbUri.toString(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: secret,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_POOL: '4',
      PGRST_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (chunk) => { log = (log + chunk.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const r = await fetch(`${base}/`);
      if (r.ok) break;
    } catch { /* not listening yet */ }
    if (exited || attempt > 150) {
      child.kill('SIGTERM');
      throw new Error(`PostgREST did not start: ${log.replace(/postgres(ql)?:\/\/[^\s"]+/g, '<db-uri>')}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const version = (await fetch(`${base}/`)).headers.get('server');
  return {
    base,
    version,
    async stop() {
      if (exited) return;
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(resolve, 3000);
      });
    },
  };
}

/** supabase-js addresses <url>/rest/v1/…; PostgREST serves at its root. */
export function restFetch(base) {
  return (input, init) => fetch(String(input).replace(`${base}/rest/v1`, base), init);
}

/**
 * Data snapshot / restore for a clone (superuser only): copies every table of schema public into schema
 * hier_rest_snap and installs hier_rest_snap.restore(), which rewrites ONLY the tables whose contents differ, with
 * session_replication_role = replica so no trigger (path derivation, set_claim, guards) re-fires on the way back.
 */
export async function installSnapshot(sql) {
  await sql.unsafe(`
    CREATE SCHEMA hier_rest_snap;
    REVOKE ALL ON SCHEMA hier_rest_snap FROM PUBLIC;
    DO $snap$
    DECLARE t record;
    BEGIN
      FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r' LOOP
        EXECUTE format('CREATE TABLE hier_rest_snap.%I AS TABLE public.%I', t.relname, t.relname);
      END LOOP;
    END $snap$;
    CREATE FUNCTION hier_rest_snap.restore() RETURNS integer LANGUAGE plpgsql AS $fn$
    DECLARE t record; differs boolean; n integer := 0;
    BEGIN
      PERFORM set_config('session_replication_role', 'replica', true);
      FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'hier_rest_snap' AND c.relkind = 'r' ORDER BY c.relname LOOP
        -- Row images as text (json columns have no equality operator, so no EXCEPT).
        EXECUTE format('SELECT (SELECT md5(coalesce(string_agg(r, E''\\n'' ORDER BY r), '''')) FROM (SELECT to_jsonb(x)::text r FROM public.%1$I x) a)
                            IS DISTINCT FROM
                               (SELECT md5(coalesce(string_agg(r, E''\\n'' ORDER BY r), '''')) FROM (SELECT to_jsonb(x)::text r FROM hier_rest_snap.%1$I x) b)',
                       t.relname)
          INTO differs;
        IF differs THEN
          EXECUTE format('DELETE FROM public.%1$I; INSERT INTO public.%1$I SELECT * FROM hier_rest_snap.%1$I', t.relname);
          n := n + 1;
        END IF;
      END LOOP;
      PERFORM set_config('session_replication_role', 'origin', true);
      RETURN n;
    END $fn$;
    REVOKE ALL ON FUNCTION hier_rest_snap.restore() FROM PUBLIC;`);
}
export async function restoreSnapshot(sql) {
  const [{ restore }] = await sql.begin((tx) => tx`SELECT hier_rest_snap.restore() AS restore`);
  return restore;
}

/** key ↔ id maps of the fixture's shapes (production shape first), from hierarchy_test.shape. */
export async function shapeKeys(sql) {
  const rows = await sql`
    SELECT key, id::text AS id, org_key, org_id::text AS org_id FROM hierarchy_test.shape
     WHERE shape IN ('production', 'organization') ORDER BY shape, key`;
  const id = {};
  const org = {};
  const key = {};
  for (const r of rows) {
    if (r.org_key === null && r.org_id === null) org[r.key] = r.id;
    else { id[r.key] = r.id; key[r.id] = r.key; }
  }
  for (const [k, v] of Object.entries(org)) key[v] = `org:${k}`;
  return { id, org, key };
}

/**
 * One state's HTTP environment: a clone of the state database, an authenticator, a JWT secret and a running
 * PostgREST. `seed(admin)` runs (as the postgres superuser) before the data snapshot. close() stops and drops all.
 */
export async function openStateEnvironment({ state, url, suffix, bin, seed }) {
  const clone = await cloneDatabase(url, suffix);
  const opened = { state, flags: stateFlags(state), clone };
  try {
    opened.admin = connect(clone.url, 2);
    await proveLocal(opened.admin);
    await proveSynthetic(opened.admin);
    if (seed) await seed(opened.admin);
    await proveSynthetic(opened.admin);
    await installSnapshot(opened.admin);
    opened.authenticator = await createAuthenticator(clone.url);
    opened.secret = newJwtSecret();
    opened.rest = await startPostgrest({ bin, dbUrl: clone.url, authenticator: opened.authenticator, secret: opened.secret });
  } catch (e) {
    await closeStateEnvironment(opened).catch(() => {});
    throw e;
  }
  return opened;
}

export async function closeStateEnvironment(env) {
  const errors = [];
  for (const step of [
    () => env.rest?.stop(),
    () => env.admin?.end(),
    () => env.authenticator?.drop(),
    () => env.clone?.drop(),
  ]) {
    try { await step(); } catch (e) { errors.push(e); }
  }
  if (errors.length) throw errors[0];
}
