// Hierarchy stabilization — forged and stale-token requests over real HTTP: PostgREST 12.2.3 against every database
// state the release passes through. DISPOSABLE LOCAL PostgreSQL ONLY; synthetic data only (invariant #28).
// Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §8 ("Forged requests (PostgREST)",
// "Stale / forged tokens (R1)") and §R R1.
//
// Run by scripts/run_hierarchy_stabilization_tests.sh (stage 6) as
//   HIERARCHY_STATES='S0 S1 …' HIERARCHY_DB_<STATE>=<url> PGURL=<cluster> POSTGREST_BIN=<postgrest> node <this file>
// Each state database is CLONED (…_forged) and the clone dropped at the end, so nothing here reaches another stage.
// Requests carry HS256 tokens minted with the run's random JWT secret, shaped like Supabase's (sub, role
// authenticated, app_metadata.{role, organization_id}, is_super_admin). A "stale" token is one whose role / org
// claims disagree with the profile row; the database row is changed by the superuser, as a promotion, demotion or
// deactivation would.
//
// Expectations are per state (flags as in the SQL suites): the preimage states S0, S1R and S3R keep the documented
// gaps (they are the negative controls proving each check can fail); M1 (S1, S2, S3, S2R) closes the R1 gaps, the
// contact tenancy escape (AUTHZ-1), client-chosen call timestamps (AUTHZ-4) and the cross-org path oracle (D2); the
// path-function revokes (computeRevoked) hold from S1 on, rollbacks included; M2 (S2, S3) adds the structural guards;
// S3 / S3R have the repaired paths (Team Leader T reaches A1, A2, D1).
// Output: one 'PASS <state> <case>: <outcome>' line per case and state, then a case × state matrix; any mismatch
// prints 'FAIL …' and the process exits 1.
import * as h from './lib/pgrst_harness.mjs';

const { POSTGREST_BIN, PGURL } = process.env;
if (!POSTGREST_BIN) throw new Error('POSTGREST_BIN is required');
h.assertLocalUrl(PGURL ?? '', 'PGURL');
const STATE_DBS = h.stateDatabasesFromEnv();

// ── Synthetic rows seeded into each clone (prefixes e1…e7 are used by no other hierarchy suite) ─────────────────────
// Organization E (no profiles in the production shape): Admin EA → Team Leader ET → Agents EG1, EG2; Agent EX
// reports to EA (a peer outside ET's downline). Its paths are written canonical, so ET's downline is live in EVERY
// state and the R1 cases test token handling, not path staleness.
const E = {
  EA: 'e1000000-0000-4000-8000-000000000001', ET: 'e1000000-0000-4000-8000-000000000002',
  EG1: 'e1000000-0000-4000-8000-000000000003', EG2: 'e1000000-0000-4000-8000-000000000004',
  EX: 'e1000000-0000-4000-8000-000000000005',
};
const ROW = {
  lead_A1: 'e2000000-0000-4000-8000-000000000001', lead_T: 'e2000000-0000-4000-8000-000000000002',
  lead_EG1: 'e2000000-0000-4000-8000-000000000003', lead_EX: 'e2000000-0000-4000-8000-000000000004',
  lead_ET: 'e2000000-0000-4000-8000-000000000005',
  client_EG1: 'e3000000-0000-4000-8000-000000000003', client_EX: 'e3000000-0000-4000-8000-000000000004',
  recruit_EG1: 'e4000000-0000-4000-8000-000000000003', recruit_EX: 'e4000000-0000-4000-8000-000000000004',
  call_A1: 'e5000000-0000-4000-8000-000000000001', call_EG1: 'e5000000-0000-4000-8000-000000000003',
  call_EX: 'e5000000-0000-4000-8000-000000000004',
  email_EG1: 'e6000000-0000-4000-8000-000000000003', email_EX: 'e6000000-0000-4000-8000-000000000004',
  task_EG1: 'e7000000-0000-4000-8000-000000000003', task_EX: 'e7000000-0000-4000-8000-000000000004',
};
const label = (id) => id.replaceAll('-', '_');

async function seed(admin) {
  const k = await h.shapeKeys(admin);
  const orgA = k.org.A;
  const orgE = k.org.E;
  await admin.begin(async (tx) => {
    // Written as the superuser with triggers off: the rows and their canonical paths are exactly what is listed.
    await tx`SELECT set_config('session_replication_role', 'replica', true)`;
    const profiles = [
      ['EA', null, 'Admin', `${label(E.EA)}`],
      ['ET', 'EA', 'Team Leader', `${label(E.EA)}.${label(E.ET)}`],
      ['EG1', 'ET', 'Agent', `${label(E.EA)}.${label(E.ET)}.${label(E.EG1)}`],
      ['EG2', 'ET', 'Agent', `${label(E.EA)}.${label(E.ET)}.${label(E.EG2)}`],
      ['EX', 'EA', 'Agent', `${label(E.EA)}.${label(E.EX)}`],
    ];
    for (const [key, up, role, path] of profiles) {
      await tx`INSERT INTO auth.users (id, email) VALUES (${E[key]}, ${`${key.toLowerCase()}@synthetic.invalid`})`;
      await tx`INSERT INTO public.profiles (id, organization_id, upline_id, role, status, first_name, last_name, email, hierarchy_path)
               VALUES (${E[key]}, ${orgE}, ${up ? E[up] : null}, ${role}, 'Active', ${`Synthetic ${key}`}, 'Member',
                       ${`${key.toLowerCase()}@synthetic.invalid`}, ${path}::public.ltree)`;
    }
    const owner = { A1: [orgA, k.id.A1], T: [orgA, k.id.T], EG1: [orgE, E.EG1], EX: [orgE, E.EX], ET: [orgE, E.ET] };
    for (const who of ['A1', 'T', 'EG1', 'EX', 'ET']) {
      const [org, uid] = owner[who];
      await tx`INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name)
               VALUES (${ROW[`lead_${who}`]}, ${org}, ${uid}, ${uid}, ${`Synthetic lead ${who}`}, 'Member')`;
    }
    for (const who of ['EG1', 'EX']) {
      const uid = E[who];
      await tx`INSERT INTO public.clients (id, organization_id, assigned_agent_id, first_name) VALUES (${ROW[`client_${who}`]}, ${orgE}, ${uid}, 'Synthetic')`;
      await tx`INSERT INTO public.recruits (id, organization_id, assigned_agent_id, first_name) VALUES (${ROW[`recruit_${who}`]}, ${orgE}, ${uid}, 'Synthetic')`;
      await tx`INSERT INTO public.contact_emails (id, organization_id, owner_user_id, provider, direction, external_message_id, from_email)
               VALUES (${ROW[`email_${who}`]}, ${orgE}, ${uid}, 'google', 'inbound', ${`synthetic-${who}`}, 'sender@synthetic.invalid')`;
      await tx`INSERT INTO public.tasks (id, organization_id, contact_id, contact_type, assigned_to, created_by, title, task_type, due_date)
               VALUES (${ROW[`task_${who}`]}, ${orgE}, ${ROW[`lead_${who}`]}, 'lead', ${uid}, ${E.EA}, 'Synthetic task', 'General', now())`;
    }
    for (const [who, org, uid] of [['A1', orgA, k.id.A1], ['EG1', orgE, E.EG1], ['EX', orgE, E.EX]]) {
      await tx`INSERT INTO public.calls (id, organization_id, agent_id, direction, status)
               VALUES (${ROW[`call_${who}`]}, ${org}, ${uid}, 'outbound', 'completed')`;
    }
  });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
async function http(ctx, token, method, path, body) {
  const headers = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ctx.env.rest.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
/** '<status> <code>[ <message>]' for an error, 'rows <n>' for a table write/read, '200 <value>' for a scalar. */
function brief(r, withMessage = false) {
  if (r.status >= 400) return `${r.status} ${r.json?.code ?? '?'}${withMessage ? ` ${r.json?.message ?? ''}` : ''}`;
  if (Array.isArray(r.json)) return `rows ${r.json.length}`;
  return `${r.status} ${typeof r.json === 'string' ? r.json : JSON.stringify(r.json)}`;
}
/** One battery cell: '1' / '0' rows, or the error code. */
const cell = (r) => (r.status >= 400 ? `E${r.json?.code ?? r.status}` : String(Array.isArray(r.json) ? r.json.length : r.json));

async function profileRow(ctx, id) {
  const [p] = await ctx.env.admin`
    SELECT id::text, organization_id::text, role, status, coalesce(is_super_admin, false) AS is_super_admin, upline_id::text,
           commission_level, hierarchy_path::text AS path FROM public.profiles WHERE id = ${id}`;
  return p;
}
/** A token minted from the profile row as it is NOW (a fresh token), with optional stale / forged overrides. */
async function token(ctx, id, overrides = {}) {
  return h.mintJwt(ctx.env.secret, h.profileClaims(await profileRow(ctx, id), overrides));
}
async function exists(ctx, table, id) {
  const [{ n }] = await ctx.env.admin.unsafe(`SELECT count(*)::int AS n FROM public.${table} WHERE id = $1`, [id]);
  return n === 1;
}
/** The organization key a contact row is in now ('none' for NULL), read as the superuser. */
async function orgOf(ctx, table, id) {
  const [row] = await ctx.env.admin.unsafe(`SELECT organization_id::text AS org FROM public.${table} WHERE id = $1`, [id]);
  if (!row) return 'gone';
  if (row.org === null) return 'none';
  return (ctx.keys.key[row.org] ?? row.org.slice(0, 8)).replace(/^org:/, '');
}
/** AUTHZ-1: <writer> PATCHes <table> row <id> with <patch>; outcome, the row's organization afterwards, and whether
 *  org E's Admin EA still sees it. */
async function tenancyMove(ctx, writer, table, id, patch) {
  const r = await http(ctx, await token(ctx, writer), 'PATCH', `/${table}?id=eq.${id}`, patch);
  const seen = cell(await http(ctx, await token(ctx, E.EA), 'GET', `/${table}?select=id&id=eq.${id}`));
  return `${brief(r, true)}; org=${await orgOf(ctx, table, id)}; EA sees ${seen}`;
}
/** TESTS-04: with ONLY <toggle> on for org E's Team Leaders, ET deletes a downline lead, client and recruit. */
async function perTypeDelete(ctx, toggle) {
  await ctx.env.admin`INSERT INTO public.role_permissions (organization_id, role, permissions)
                      VALUES (${ctx.org.E}, 'Team Leader', ${ctx.env.admin.json({ contacts: { [toggle]: true } })})`;
  const tok = await token(ctx, E.ET);
  const out = [];
  for (const [table, id] of [['leads', ROW.lead_EG1], ['clients', ROW.client_EG1], ['recruits', ROW.recruit_EG1]]) {
    out.push(`${table} ${brief(await http(ctx, tok, 'DELETE', `/${table}?id=eq.${id}`))}`);
  }
  const left = [];
  for (const [table, id] of [['leads', ROW.lead_EG1], ['clients', ROW.client_EG1], ['recruits', ROW.recruit_EG1]]) {
    left.push(`${table}=${(await exists(ctx, table, id)) ? 1 : 0}`);
  }
  return `${out.join(', ')}; survivors ${left.join(' ')}`;
}
const keysOfPath = (ctx, path) => (path ?? '').split('.').filter(Boolean).map((l) => ctx.keys.key[l.replaceAll('_', '-')] ?? l.slice(0, 8)).join('.');
const keyOf = (ctx, id) => (id ? ctx.keys.key[id] ?? Object.keys(E).find((k) => E[k] === id) ?? id.slice(0, 8) : 'none');

// ── Cases: { id, title, run(ctx) → outcome, expect(flags) → outcome } ──────────────────────────────────────────────
const CYCLE = 'Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)';
const CROSS_ORG = 'Hierarchy: an upline must belong to the same organization';
const SELF = 'Hierarchy: a member cannot be their own upline';
const ACCOUNT_CONTROL = 'Only an Admin of this organization may change account-control fields (status, team, upline, billing)';
const COMMISSION = "Only an Admin of this organization may change another member's commission level";
const CALL_GUARD = "Only the call's agent or an Admin of this organization may change this call (coaching flag and notes excepted)";
const ORG_GUARD = "A contact's organization cannot be changed by a direct client write";
const ESCAPED = (org) => `rows 1; org=${org}; EA sees 0`;
const KEPT = `403 42501 ${ORG_GUARD}; org=E; EA sees 1`;

const FORGED = [
  {
    id: 'F01', title: 'anon /rpc/compute_hierarchy_path',
    run: async (ctx) => brief(await http(ctx, null, 'POST', '/rpc/compute_hierarchy_path', { target_user_id: ctx.id.T })),
    expect: (f) => (f.computeRevoked ? '401 42501' : `200 ${label(ctx0.id.R)}.${label(ctx0.id.T)}`),
  },
  {
    id: 'F02', title: 'authenticated /rpc/compute_hierarchy_path (Agent of another org)',
    run: async (ctx) => brief(await http(ctx, await token(ctx, ctx.id.CG), 'POST', '/rpc/compute_hierarchy_path', { target_user_id: ctx.id.T })),
    expect: (f) => (f.computeRevoked ? '403 42501' : `200 ${label(ctx0.id.R)}.${label(ctx0.id.T)}`),
  },
  {
    id: 'F03', title: 'anon /rpc/is_ancestor_of',
    run: async (ctx) => brief(await http(ctx, null, 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.R, descendant_id: ctx.id.K1 })),
    expect: (f) => (f.anonRevoked ? '401 42501' : '200 true'),
  },
  {
    id: 'F04', title: 'authenticated is_ancestor_of on two foreign ids (org C caller, org A pair)',
    run: async (ctx) => brief(await http(ctx, await token(ctx, ctx.id.CG), 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.R, descendant_id: ctx.id.K1 })),
    expect: (f) => (f.m1 ? '200 false' : '200 true'),
  },
  {
    id: 'F05', title: 'authenticated is_ancestor_of on a foreign self-pair',
    run: async (ctx) => brief(await http(ctx, await token(ctx, ctx.id.CG), 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.K1, descendant_id: ctx.id.K1 })),
    expect: (f) => (f.m1 ? '200 false' : '200 true'),
  },
  {
    id: 'F06', title: 'same-org Agent asks is_ancestor_of about someone else (ancestor ≠ caller)',
    run: async (ctx) => brief(await http(ctx, await token(ctx, ctx.id.K2), 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.R, descendant_id: ctx.id.K1 })),
    expect: (f) => (f.m1 ? '200 false' : '200 true'),
  },
  {
    id: 'F07', title: 'control: an Admin asks about their own downline member',
    run: async (ctx) => brief(await http(ctx, await token(ctx, ctx.id.R), 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.R, descendant_id: ctx.id.K1 })),
    expect: () => '200 true',
  },
  {
    id: 'F08', title: 'PATCH hierarchy_path (Admin on a member, member on self)',
    run: async (ctx) => {
      const before = (await profileRow(ctx, ctx.id.K1)).path;
      const a = await http(ctx, await token(ctx, ctx.id.R), 'PATCH', `/profiles?id=eq.${ctx.id.K1}`, { hierarchy_path: label(ctx.id.K1) });
      const s = await http(ctx, await token(ctx, ctx.id.K1), 'PATCH', `/profiles?id=eq.${ctx.id.K1}`, { hierarchy_path: label(ctx.id.K1) });
      const after = (await profileRow(ctx, ctx.id.K1)).path;
      return `${brief(a, true)} / ${brief(s)}; path ${after === before ? 'unchanged' : 'CHANGED'}`;
    },
    expect: () => '403 42501 permission denied for table profiles / 403 42501; path unchanged',
  },
  {
    id: 'F09', title: 'cross-organization upline PATCH by an Admin',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, ctx.id.R), 'PATCH', `/profiles?id=eq.${ctx.id.K1}`, { upline_id: ctx.id.BA });
      return `${brief(r, true)}; upline=${keyOf(ctx, (await profileRow(ctx, ctx.id.K1)).upline_id)}`;
    },
    expect: (f) => (f.m2 ? `400 23514 ${CROSS_ORG}; upline=R` : 'rows 1; upline=BA'),
  },
  {
    id: 'F10', title: 'cyclic upline PATCH (Team Leader under their own report) by an Admin',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, ctx.id.R), 'PATCH', `/profiles?id=eq.${ctx.id.T}`, { upline_id: ctx.id.A1 });
      return `${brief(r, true)}; upline=${keyOf(ctx, (await profileRow(ctx, ctx.id.T)).upline_id)}`;
    },
    expect: (f) => (f.m2 ? `400 23514 ${CYCLE}; upline=R` : 'rows 1; upline=A1'),
  },
  {
    id: 'F11', title: 'self-parent upline PATCH by an Admin',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, ctx.id.R), 'PATCH', `/profiles?id=eq.${ctx.id.K1}`, { upline_id: ctx.id.K1 });
      return `${brief(r, true)}; upline=${keyOf(ctx, (await profileRow(ctx, ctx.id.K1)).upline_id)}`;
    },
    expect: (f) => (f.m2 ? `400 23514 ${SELF}; upline=R` : 'rows 1; upline=K1'),
  },
  {
    id: 'F12', title: 'Team Leader PATCH of a downline member\'s upline (org A, reachable once repaired)',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, ctx.id.T), 'PATCH', `/profiles?id=eq.${ctx.id.A1}`, { upline_id: null });
      return `${brief(r, true)}; upline=${keyOf(ctx, (await profileRow(ctx, ctx.id.A1)).upline_id)}`;
    },
    expect: (f) => (f.repaired ? `403 42501 ${ACCOUNT_CONTROL}; upline=T` : 'rows 0; upline=T'),
  },
  {
    id: 'F13', title: 'Team Leader PATCH of a downline member\'s upline (org E, always reachable)',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, E.ET), 'PATCH', `/profiles?id=eq.${E.EG1}`, { upline_id: E.EA });
      return `${brief(r, true)}; upline=${keyOf(ctx, (await profileRow(ctx, E.EG1)).upline_id)}`;
    },
    expect: () => `403 42501 ${ACCOUNT_CONTROL}; upline=ET`,
  },
  {
    id: 'F14', title: 'Team Leader PATCH of a downline commission_level (org A)',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, ctx.id.T), 'PATCH', `/profiles?id=eq.${ctx.id.A1}`, { commission_level: '90%' });
      return `${brief(r, true)}; level=${(await profileRow(ctx, ctx.id.A1)).commission_level}`;
    },
    // S3R: M1 rolled back while the repair is live — the documented re-widening (plan §10, M1 rollback warning).
    expect: (f) => (!f.repaired ? 'rows 0; level=0%' : f.m1 ? `403 42501 ${COMMISSION}; level=0%` : 'rows 1; level=90%'),
  },
  {
    id: 'F15', title: 'Team Leader PATCH of a downline commission_level (org E)',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, E.ET), 'PATCH', `/profiles?id=eq.${E.EG1}`, { commission_level: '90%' });
      return `${brief(r, true)}; level=${(await profileRow(ctx, E.EG1)).commission_level}`;
    },
    expect: (f) => (f.m1 ? `403 42501 ${COMMISSION}; level=0%` : 'rows 1; level=90%'),
  },
  {
    id: 'F16', title: 'Team Leader unchanged-commission save of a downline member (org E) passes',
    run: async (ctx) => {
      const r = await http(ctx, await token(ctx, E.ET), 'PATCH', `/profiles?id=eq.${E.EG1}`, { commission_level: '0%', phone: '5555550101' });
      return brief(r, true);
    },
    expect: () => 'rows 1',
  },
  {
    id: 'F17', title: 'Team Leader DELETE of a downline lead (org A)',
    run: async (ctx) => `${brief(await http(ctx, await token(ctx, ctx.id.T), 'DELETE', `/leads?id=eq.${ROW.lead_A1}`))}; ${(await exists(ctx, 'leads', ROW.lead_A1)) ? 'survives' : 'deleted'}`,
    expect: (f) => (f.repaired && !f.m1 ? 'rows 1; deleted' : 'rows 0; survives'),
  },
  {
    id: 'F18', title: 'Team Leader DELETE of a downline lead (org E, delete toggle off)',
    run: async (ctx) => `${brief(await http(ctx, await token(ctx, E.ET), 'DELETE', `/leads?id=eq.${ROW.lead_EG1}`))}; ${(await exists(ctx, 'leads', ROW.lead_EG1)) ? 'survives' : 'deleted'}`,
    expect: (f) => (f.m1 ? 'rows 0; survives' : 'rows 1; deleted'),
  },
  {
    id: 'F19', title: 'Team Leader DELETE of a downline lead with contacts.leads.delete on',
    run: async (ctx) => {
      await ctx.env.admin`INSERT INTO public.role_permissions (organization_id, role, permissions)
                          VALUES (${ctx.org.E}, 'Team Leader', '{"contacts": {"contacts.leads.delete": true}}')`;
      return `${brief(await http(ctx, await token(ctx, E.ET), 'DELETE', `/leads?id=eq.${ROW.lead_EG1}`))}; ${(await exists(ctx, 'leads', ROW.lead_EG1)) ? 'survives' : 'deleted'}`;
    },
    expect: () => 'rows 1; deleted',
  },
  {
    id: 'F20', title: 'Team Leader DELETE of a downline call (org A)',
    run: async (ctx) => `${brief(await http(ctx, await token(ctx, ctx.id.T), 'DELETE', `/calls?id=eq.${ROW.call_A1}`))}; ${(await exists(ctx, 'calls', ROW.call_A1)) ? 'survives' : 'deleted'}`,
    expect: (f) => (f.repaired && !f.m1 ? 'rows 1; deleted' : 'rows 0; survives'),
  },
  {
    id: 'F21', title: 'Team Leader DELETE of a downline call (org E)',
    run: async (ctx) => `${brief(await http(ctx, await token(ctx, E.ET), 'DELETE', `/calls?id=eq.${ROW.call_EG1}`))}; ${(await exists(ctx, 'calls', ROW.call_EG1)) ? 'survives' : 'deleted'}`,
    expect: (f) => (f.m1 ? 'rows 0; survives' : 'rows 1; deleted'),
  },
  {
    id: 'F22', title: 'Team Leader edits a downline call: coaching flag + notes, then status',
    run: async (ctx) => {
      const tok = await token(ctx, E.ET);
      const coach = await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EG1}`, { flagged_for_coaching: true, notes: 'Synthetic coaching note' });
      const core = await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EG1}`, { status: 'failed' });
      const [c] = await ctx.env.admin`SELECT status FROM public.calls WHERE id = ${ROW.call_EG1}`;
      return `coach ${brief(coach)}; status ${brief(core, true)}; stored=${c.status}`;
    },
    expect: (f) => (f.m1 ? `coach rows 1; status 403 42501 ${CALL_GUARD}; stored=completed` : 'coach rows 1; status rows 1; stored=failed'),
  },
  {
    id: 'F23', title: 'control: an Active Admin edits and deletes another agent\'s call',
    run: async (ctx) => {
      const tok = await token(ctx, E.EA);
      const core = await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EG1}`, { status: 'failed' });
      const del = await http(ctx, tok, 'DELETE', `/calls?id=eq.${ROW.call_EX}`);
      return `status ${brief(core)}; delete ${brief(del)}`;
    },
    expect: () => 'status rows 1; delete rows 1',
  },
  {
    id: 'F24', title: 'token signed with another secret, unsigned (alg none) and expired tokens',
    run: async (ctx) => {
      const claims = h.profileClaims(await profileRow(ctx, ctx.id.R));
      const other = h.mintJwt(h.newJwtSecret(), claims);
      const a = await http(ctx, other, 'GET', '/profiles?select=id');
      const b = await http(ctx, other, 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.R, descendant_id: ctx.id.K1 });
      const c = await http(ctx, h.unsignedJwt(claims), 'GET', '/leads?select=id');
      const d = await http(ctx, h.mintJwt(ctx.env.secret, claims, -60), 'GET', '/calls?select=id');
      return [a, b, c, d].map((r) => `${r.status} ${r.json?.code}`).join(' / ');
    },
    expect: () => '401 PGRST301 / 401 PGRST301 / 401 PGRST301 / 401 PGRST301',
  },
  // AUTHZ-1: no direct client write moves a contact between organizations (the owner branches of the contacts
  // policies' WITH CHECK do not bind organization_id). Preimage: the row escapes and org E's Admin loses it.
  {
    id: 'F25', title: 'AUTHZ-1 Team Leader reassigns a downline lead to self + organization_id null',
    run: async (ctx) => tenancyMove(ctx, E.ET, 'leads', ROW.lead_EG1, { assigned_agent_id: E.ET, organization_id: null }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('none')),
  },
  {
    id: 'F26', title: 'AUTHZ-1 Team Leader reassigns a downline lead to self + a foreign organization',
    run: async (ctx) => tenancyMove(ctx, E.ET, 'leads', ROW.lead_EG1, { assigned_agent_id: E.ET, organization_id: ctx.org.A }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('A')),
  },
  {
    id: 'F27', title: 'AUTHZ-1 Team Leader reassigns a downline client to self + organization_id null',
    run: async (ctx) => tenancyMove(ctx, E.ET, 'clients', ROW.client_EG1, { assigned_agent_id: E.ET, organization_id: null }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('none')),
  },
  {
    id: 'F28', title: 'AUTHZ-1 Team Leader reassigns a downline client to self + a foreign organization',
    run: async (ctx) => tenancyMove(ctx, E.ET, 'clients', ROW.client_EG1, { assigned_agent_id: E.ET, organization_id: ctx.org.A }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('A')),
  },
  {
    id: 'F29', title: 'AUTHZ-1 Team Leader reassigns a downline recruit to self + organization_id null',
    run: async (ctx) => tenancyMove(ctx, E.ET, 'recruits', ROW.recruit_EG1, { assigned_agent_id: E.ET, organization_id: null }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('none')),
  },
  {
    id: 'F30', title: 'AUTHZ-1 Team Leader reassigns a downline recruit to self + a foreign organization',
    run: async (ctx) => tenancyMove(ctx, E.ET, 'recruits', ROW.recruit_EG1, { assigned_agent_id: E.ET, organization_id: ctx.org.A }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('A')),
  },
  {
    id: 'F31', title: 'AUTHZ-1 Agent moves its OWN lead to a foreign organization',
    run: async (ctx) => tenancyMove(ctx, E.EX, 'leads', ROW.lead_EX, { organization_id: ctx.org.A }),
    expect: (f) => (f.m1 ? KEPT : ESCAPED('A')),
  },
  {
    // AUTHZ-4: on a downline call the database sets updated_at; t0 is the database clock before the request.
    id: 'F32', title: 'AUTHZ-4 Team Leader coaching PATCH supplying updated_at 2000-01-01 (org E)',
    run: async (ctx) => {
      const [{ t0 }] = await ctx.env.admin`SELECT clock_timestamp()::text AS t0`;
      const r = await http(ctx, await token(ctx, E.ET), 'PATCH', `/calls?id=eq.${ROW.call_EG1}`,
        { flagged_for_coaching: true, updated_at: '2000-01-01T00:00:00Z' });
      const [c] = await ctx.env.admin`
        SELECT flagged_for_coaching AS flagged, updated_at >= ${t0}::timestamptz AS fresh,
               updated_at = '2000-01-01T00:00:00Z'::timestamptz AS backdated
          FROM public.calls WHERE id = ${ROW.call_EG1}`;
      return `${brief(r)}; flagged=${c.flagged}; updated_at=${c.fresh ? '>= request time' : c.backdated ? '2000-01-01' : 'other'}`;
    },
    expect: (f) => (f.m1 ? 'rows 1; flagged=true; updated_at=>= request time' : 'rows 1; flagged=true; updated_at=2000-01-01'),
  },
  {
    // D2 (TESTS-03): a stored path into ANOTHER organization is not ancestry. Planted by the superuser with triggers
    // off (no client or M2 path can write it); org B's Admin asks about org A's K5.
    id: 'F33', title: 'D2 cross-organization stored path: org B Admin is_ancestor_of(self, org A member)',
    run: async (ctx) => {
      await ctx.env.admin.begin(async (tx) => {
        await tx`SELECT set_config('session_replication_role', 'replica', true)`;
        await tx`UPDATE public.profiles SET upline_id = ${ctx.id.BA}, hierarchy_path = ${`${label(ctx.id.BA)}.${label(ctx.id.K5)}`}::public.ltree
                  WHERE id = ${ctx.id.K5}`;
      });
      return brief(await http(ctx, await token(ctx, ctx.id.BA), 'POST', '/rpc/is_ancestor_of', { ancestor_id: ctx.id.BA, descendant_id: ctx.id.K5 }));
    },
    expect: (f) => (f.m1 ? '200 false' : '200 true'),
  },
  // TESTS-04: each restrictive DELETE policy reads its own table's toggle.
  {
    id: 'F34', title: 'D5 per type: only contacts.leads.delete on — Team Leader DELETE of a downline lead, client, recruit',
    run: async (ctx) => perTypeDelete(ctx, 'contacts.leads.delete'),
    expect: (f) => (f.m1 ? 'leads rows 1, clients rows 0, recruits rows 0; survivors leads=0 clients=1 recruits=1'
      : 'leads rows 1, clients rows 1, recruits rows 1; survivors leads=0 clients=0 recruits=0'),
  },
  {
    id: 'F35', title: 'D5 per type: only contacts.clients.delete on — Team Leader DELETE of a downline lead, client, recruit',
    run: async (ctx) => perTypeDelete(ctx, 'contacts.clients.delete'),
    expect: (f) => (f.m1 ? 'leads rows 0, clients rows 1, recruits rows 0; survivors leads=1 clients=0 recruits=1'
      : 'leads rows 1, clients rows 1, recruits rows 1; survivors leads=0 clients=0 recruits=0'),
  },
  {
    id: 'F36', title: 'D5 per type: only contacts.recruits.delete on — Team Leader DELETE of a downline lead, client, recruit',
    run: async (ctx) => perTypeDelete(ctx, 'contacts.recruits.delete'),
    expect: (f) => (f.m1 ? 'leads rows 0, clients rows 0, recruits rows 1; survivors leads=1 clients=1 recruits=0'
      : 'leads rows 1, clients rows 1, recruits rows 1; survivors leads=0 clients=0 recruits=0'),
  },
];

// ── R1: stale and forged tokens (org E). One battery per variant; every cell is asserted. ──────────────────────────
// read=<lead client recruit call email task>  upd=lead update  coach=call coaching flag  core=call status
// prof=downline profile update  xorg=read an org-A lead  dlead / dcall = delete a downline lead / call.
async function teamLeaderBattery(ctx, tok) {
  const reads = [];
  for (const [table, id] of [['leads', ROW.lead_EG1], ['clients', ROW.client_EG1], ['recruits', ROW.recruit_EG1],
    ['calls', ROW.call_EG1], ['contact_emails', ROW.email_EG1], ['tasks', ROW.task_EG1]]) {
    reads.push(cell(await http(ctx, tok, 'GET', `/${table}?select=id&id=eq.${id}`)));
  }
  const upd = cell(await http(ctx, tok, 'PATCH', `/leads?id=eq.${ROW.lead_EG1}`, { last_name: 'Changed' }));
  const coach = cell(await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EG1}`, { flagged_for_coaching: true }));
  const core = cell(await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EG1}`, { status: 'failed' }));
  const prof = cell(await http(ctx, tok, 'PATCH', `/profiles?id=eq.${E.EG1}`, { phone: '5555550102' }));
  const xorg = cell(await http(ctx, tok, 'GET', `/leads?select=id&id=eq.${ROW.lead_A1}`));
  const dlead = cell(await http(ctx, tok, 'DELETE', `/leads?id=eq.${ROW.lead_EG1}`));
  const dcall = cell(await http(ctx, tok, 'DELETE', `/calls?id=eq.${ROW.call_EG1}`));
  return `read=${reads.join('')} upd=${upd} coach=${coach} core=${core} prof=${prof} xorg=${xorg} dlead=${dlead} dcall=${dcall}`;
}
// A (former) Admin acting on another agent's rows in their organization (EX's call and lead; EX's profile).
async function adminBattery(ctx, tok) {
  const read = cell(await http(ctx, tok, 'GET', `/calls?select=id&id=eq.${ROW.call_EX}`));
  const coach = cell(await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EX}`, { flagged_for_coaching: true }));
  const core = cell(await http(ctx, tok, 'PATCH', `/calls?id=eq.${ROW.call_EX}`, { status: 'failed' }));
  const prof = cell(await http(ctx, tok, 'PATCH', `/profiles?id=eq.${E.EX}`, { phone: '5555550103' }));
  const dcall = cell(await http(ctx, tok, 'DELETE', `/calls?id=eq.${ROW.call_EX}`));
  const dlead = cell(await http(ctx, tok, 'DELETE', `/leads?id=eq.${ROW.lead_EX}`));
  return `readcall=${read} coach=${coach} core=${core} prof=${prof} dcall=${dcall} dlead=${dlead}`;
}
const setProfile = (ctx, id, role, status) => ctx.env.admin`UPDATE public.profiles SET role = ${role}, status = ${status} WHERE id = ${id}`;
const OPEN_TL = 'read=111111 upd=1 coach=1 core=1 prof=1 xorg=0 dlead=1 dcall=1';
const NOTHING = 'read=000000 upd=0 coach=0 core=0 prof=0 xorg=0 dlead=0 dcall=0';

const R1 = [
  {
    id: 'R1a', title: 'fresh Team Leader token (DB Team Leader, Active) — positive control',
    run: async (ctx) => teamLeaderBattery(ctx, await token(ctx, E.ET)),
    expect: (f) => (f.m1 ? 'read=111111 upd=1 coach=1 core=E42501 prof=1 xorg=0 dlead=0 dcall=0' : OPEN_TL),
  },
  {
    // Promotion: the profile is already Team Leader, the token still says Agent → JWT-keyed branches fail closed
    // until the token refreshes (R1a is the refreshed token). tasks_select_team_leader and can_update_profile read
    // the profile, so they follow the database at once (in every state).
    id: 'R1b', title: 'promotion: DB Team Leader, stale Agent token',
    run: async (ctx) => teamLeaderBattery(ctx, await token(ctx, E.ET, { role: 'Agent' })),
    expect: () => 'read=000001 upd=0 coach=0 core=0 prof=1 xorg=0 dlead=0 dcall=0',
  },
  {
    id: 'R1c', title: 'demotion: DB Agent, stale Team Leader token',
    run: async (ctx) => { await setProfile(ctx, E.ET, 'Agent', 'Active'); return teamLeaderBattery(ctx, await token(ctx, E.ET, { role: 'Team Leader' })); },
    // Preimage: every JWT-keyed branch still grants the downline (tasks and profiles already read the database).
    expect: (f) => (f.m1 ? NOTHING : 'read=111110 upd=1 coach=1 core=1 prof=0 xorg=0 dlead=1 dcall=1'),
  },
  {
    id: 'R1d', title: 'deactivation: DB Team Leader Inactive, live Team Leader token',
    run: async (ctx) => { await setProfile(ctx, E.ET, 'Team Leader', 'Inactive'); return teamLeaderBattery(ctx, await token(ctx, E.ET)); },
    expect: (f) => (f.m1 ? NOTHING : OPEN_TL),
  },
  {
    id: 'R1e', title: 'deactivation: DB Team Leader Deleted, live Team Leader token',
    run: async (ctx) => { await setProfile(ctx, E.ET, 'Team Leader', 'Deleted'); return teamLeaderBattery(ctx, await token(ctx, E.ET)); },
    expect: (f) => (f.m1 ? NOTHING : OPEN_TL),
  },
  {
    // The token names organization A (a member moved, or a forged claim): every JWT-keyed branch compares the row's
    // org with the claim, so neither org's downline opens; the profile-keyed task policy and can_update_profile
    // follow the database (org E).
    id: 'R1f', title: 'organization claim mismatch: DB org E Team Leader, token org A',
    run: async (ctx) => teamLeaderBattery(ctx, await token(ctx, E.ET, { organization_id: ctx.org.A })),
    expect: () => 'read=000001 upd=0 coach=0 core=0 prof=1 xorg=0 dlead=0 dcall=0',
  },
  {
    id: 'R1g', title: 'control: fresh Active Admin token on another agent\'s rows',
    run: async (ctx) => adminBattery(ctx, await token(ctx, E.EA)),
    expect: () => 'readcall=1 coach=1 core=1 prof=1 dcall=1 dlead=1',
  },
  {
    // R1 for calls: core edits and deletes need an Active org-admin PROFILE. Pinned residuals (not hierarchy, not
    // changed by M1; bounded by the token lifetime): the JWT Admin branch still reads org rows, sets the coaching
    // flag / notes (D6 exception) and deletes leads.
    id: 'R1h', title: 'demoted Admin: DB Agent, stale Admin token',
    run: async (ctx) => { await setProfile(ctx, E.EA, 'Agent', 'Active'); return adminBattery(ctx, await token(ctx, E.EA, { role: 'Admin' })); },
    expect: (f) => (f.m1 ? 'readcall=1 coach=1 core=E42501 prof=0 dcall=0 dlead=1' : 'readcall=1 coach=1 core=1 prof=0 dcall=1 dlead=1'),
  },
  {
    // Pinned residual: can_update_profile and enforce_profile_field_authorization check the role, not the status,
    // so an Inactive Admin profile still updates members (unchanged by this project; recorded follow-up).
    id: 'R1i', title: 'deactivated Admin: DB Admin Inactive, live Admin token',
    run: async (ctx) => { await setProfile(ctx, E.EA, 'Admin', 'Inactive'); return adminBattery(ctx, await token(ctx, E.EA)); },
    expect: (f) => (f.m1 ? 'readcall=1 coach=1 core=E42501 prof=1 dcall=0 dlead=1' : 'readcall=1 coach=1 core=1 prof=1 dcall=1 dlead=1'),
  },
  // TESTS-05: D5 applies whatever the Team Leader profile's status: an Inactive or Deleted Team Leader with a live
  // token still needs the delete toggle for its OWN lead.
  {
    id: 'R1j', title: 'deactivation: DB Team Leader Inactive, live token, DELETE of its OWN lead without the toggle',
    run: async (ctx) => {
      await setProfile(ctx, E.ET, 'Team Leader', 'Inactive');
      const r = await http(ctx, await token(ctx, E.ET), 'DELETE', `/leads?id=eq.${ROW.lead_ET}`);
      return `${brief(r)}; ${(await exists(ctx, 'leads', ROW.lead_ET)) ? 'survives' : 'deleted'}`;
    },
    expect: (f) => (f.m1 ? 'rows 0; survives' : 'rows 1; deleted'),
  },
  {
    id: 'R1k', title: 'deactivation: DB Team Leader Deleted, live token, DELETE of its OWN lead without the toggle',
    run: async (ctx) => {
      await setProfile(ctx, E.ET, 'Team Leader', 'Deleted');
      const r = await http(ctx, await token(ctx, E.ET), 'DELETE', `/leads?id=eq.${ROW.lead_ET}`);
      return `${brief(r)}; ${(await exists(ctx, 'leads', ROW.lead_ET)) ? 'survives' : 'deleted'}`;
    },
    expect: (f) => (f.m1 ? 'rows 0; survives' : 'rows 1; deleted'),
  },
];

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let ctx0 = null;   // the first state's key maps (identical in every state), for expectations that name ids
const CASES = [...FORGED, ...R1];
const matrix = new Map(CASES.map((c) => [c.id, {}]));
let failed = 0;
let passed = 0;

for (const { state, url } of STATE_DBS) {
  const env = await h.openStateEnvironment({ state, url, suffix: 'forged', bin: POSTGREST_BIN, seed });
  try {
    const keys = await h.shapeKeys(env.admin);
    const ctx = { env, keys, id: keys.id, org: keys.org };
    ctx0 = ctx0 ?? ctx;
    console.log(`== ${state} (${env.rest.version}; m1=${env.flags.m1} m2=${env.flags.m2} repaired=${env.flags.repaired})`);
    for (const c of CASES) {
      let actual;
      try {
        actual = await c.run(ctx);
      } catch (e) {
        actual = `threw ${e?.message ?? e}`;
      } finally {
        await h.restoreSnapshot(env.admin);
      }
      const expected = c.expect(env.flags, state);
      matrix.get(c.id)[state] = actual;
      if (actual === expected) {
        passed += 1;
        console.log(`PASS ${state} ${c.id} ${c.title}: ${actual}`);
      } else {
        failed += 1;
        console.log(`FAIL ${state} ${c.id} ${c.title}\n     actual:   ${actual}\n     expected: ${expected}`);
      }
    }
    // The clone ends exactly as seeded: every case's writes were rolled back by the snapshot restore.
    const [{ n }] = await env.admin`SELECT hier_rest_snap.restore() AS n`;
    if (n !== 0) { failed += 1; console.log(`FAIL ${state} snapshot: ${n} table(s) still differed after the last restore`); }
  } finally {
    await h.closeStateEnvironment(env);
  }
}

// Matrix (outcomes shortened: messages dropped, they are asserted in the PASS lines above).
const short = (s) => (s ?? '—').replace(/ (Only|Hierarchy:|permission)[^;/]*/g, '').replace(/\s+/g, ' ');
console.log('\nForged / stale-token requests: case × state (shortened outcomes; full outcomes in the PASS lines)');
const states = STATE_DBS.map((s) => s.state);
for (const c of CASES) {
  console.log(`${c.id.padEnd(4)} ${c.title}`);
  for (const s of states) console.log(`       ${s.padEnd(3)} ${short(matrix.get(c.id)[s])}`);
}
// Not prefixed PASS/FAIL: the runner counts exactly the per-case PASS lines and fails on any FAIL line above.
console.log(`\npostgrest_forged summary: ${passed} passed, ${failed} failed (${CASES.length} cases × ${states.length} states)`);
process.exit(failed === 0 ? 0 : 1);
