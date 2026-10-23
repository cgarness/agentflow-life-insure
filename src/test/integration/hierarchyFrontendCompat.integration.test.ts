/**
 * Hierarchy stabilization R2 — frontend ↔ database compatibility suite.
 *
 * The REAL frontend data-layer modules (supabase-users, uplineCandidates, hierarchyTreeData,
 * profileSavePayload via saveMemberProfile, the User Management / Team tab / CampaignDetail
 * loaders, resolveAssignableAgents) run through a real supabase-js client against PostgREST
 * 12.2.3 on a DISPOSABLE local database in every state the release passes through:
 * S0 baseline, S1 M1, S2 M1+M2, S3 M1+M2+M3 and the rollback states S1R, S2R, S3R. Every call
 * must succeed or fail exactly as designed; the suite prints a case × state matrix.
 * Plan: docs/plans/2026-10-23-hierarchy-stabilization/implementation_plan.md §R (R2), §8.
 *
 * Skipped unless HIERARCHY_COMPAT=1. scripts/run_hierarchy_stabilization_tests.sh (stage 6)
 * sets it with HIERARCHY_STATES, HIERARCHY_DB_<STATE>, PGURL and POSTGREST_BIN; every state
 * database is cloned (…_compat) and the clone dropped afterwards. Synthetic data only.
 * `@/integrations/supabase/client` is replaced by a proxy to the current session's client;
 * sessions are real auth-js sessions (HS256 tokens shaped like Supabase's, minted with the
 * run's random PostgREST secret) so `supabase.auth.getSession()` works as in the browser.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as harness from "../../../scripts/tests/hierarchy_stabilization/lib/pgrst_harness.mjs";

const session = vi.hoisted(() => ({ client: null as null | Record<PropertyKey, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy(
    {},
    {
      get(_target, prop) {
        if (!session.client) throw new Error("hierarchy compat: no session client selected");
        const value = session.client[prop];
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(session.client) : value;
      },
    },
  ),
}));
// Only the pure loaders of these hooks are used; their React contexts are not.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: null }) }));

import { usersSupabaseApi } from "@/lib/supabase-users";
import { loadInviteManagerCandidates, loadUplineCandidates, managerNamesById } from "@/lib/hierarchy/uplineCandidates";
import { loadHierarchyTreeData } from "@/lib/hierarchy/hierarchyTreeData";
import { resolveAssignableAgents } from "@/lib/contacts/resolveAssignableAgents";
import { loadMemberManagerNames, loadUserManagementMembers, type ManagedMember } from "@/hooks/useUserManagementMembers";
import { loadTeamAssignableAgents, loadTeamMembers } from "@/hooks/useTeamMembers";
import { filterCampaignLeadsForRole, loadCampaignTeamScope } from "@/hooks/useCampaignTeamScope";
import { saveMemberProfile, UPLINE_NOT_AVAILABLE } from "@/components/settings/user-management/saveMemberProfile";
import type { ProfileSaveForm, ProfileSaveViewer } from "@/lib/user-management/profileSavePayload";

type Flags = { m1: boolean; m2: boolean; repaired: boolean; anonRevoked: boolean; computeRevoked: boolean };
type Env = { state: string; flags: Flags; admin: any; secret: string; rest: { base: string; version: string } };
type Ctx = { env: Env; id: Record<string, string>; org: Record<string, string>; key: Record<string, string> };
type Case = { id: string; title: string; run: (ctx: Ctx) => Promise<string>; expect: (f: Flags) => string };

const ENABLED = process.env.HIERARCHY_COMPAT === "1";
const MATRIX = new Map<string, Record<string, string>>();
const TITLES = new Map<string, string>();

// Leads of K5 (transferred by "delete member"); prefix e8 is used by no other hierarchy suite.
const K5_LEADS = ["e8000000-0000-4000-8000-000000000001", "e8000000-0000-4000-8000-000000000002"];
async function seedCompat(admin: any) {
  const k = await harness.shapeKeys(admin);
  await admin.begin(async (tx: any) => {
    await tx`SELECT set_config('session_replication_role', 'replica', true)`;
    for (const id of K5_LEADS) {
      await tx`INSERT INTO public.leads (id, organization_id, user_id, assigned_agent_id, first_name, last_name)
               VALUES (${id}, ${k.org.A}, ${k.id.K5}, ${k.id.K5}, 'Synthetic lead K5', 'Member')`;
    }
  });
}

// ── Sessions ───────────────────────────────────────────────────────────────────────────────────
let clientCounter = 0;
async function profileRow(ctx: Ctx, id: string) {
  const [p] = await ctx.env.admin`
    SELECT id::text, organization_id::text, role, status, coalesce(is_super_admin, false) AS is_super_admin,
           upline_id::text, commission_level, first_name, hierarchy_path::text AS path
      FROM public.profiles WHERE id = ${id}`;
  return p;
}
/** Sign in as `key`: a real auth-js session in memory, token minted from the profile row (or stale overrides). */
async function signInAs(ctx: Ctx, key: string, overrides: Record<string, unknown> = {}) {
  const profile = await profileRow(ctx, ctx.id[key]);
  const claims = harness.profileClaims(profile, overrides);
  const accessToken = harness.mintJwt(ctx.env.secret, claims);
  const now = Math.floor(Date.now() / 1000);
  const storageKey = `hierarchy-compat-${(clientCounter += 1)}`;
  const store = new Map<string, string>([[storageKey, JSON.stringify({
    access_token: accessToken, refresh_token: "hierarchy-compat-no-refresh", token_type: "bearer", expires_in: 3600,
    expires_at: now + 3600,
    user: { id: profile.id, aud: "authenticated", role: "authenticated", email: `${key.toLowerCase()}@synthetic.invalid`,
            app_metadata: claims.app_metadata, user_metadata: {}, created_at: new Date().toISOString() },
  })]]);
  session.client = createClient(ctx.env.rest.base, "hierarchy-compat-anon-key", {
    global: { fetch: harness.restFetch(ctx.env.rest.base) },
    auth: {
      storageKey,
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    },
  }) as unknown as Record<PropertyKey, unknown>;
  return profile;
}

// ── Outcome formatting ────────────────────────────────────────────────────────────────────────
const keys = (ctx: Ctx, ids: readonly (string | null | undefined)[]) => ids.map((i) => (i ? ctx.key[i] ?? i.slice(0, 8) : "none")).join(",");
const pathKeys = (ctx: Ctx, path: string | null) =>
  (path ?? "").split(".").filter(Boolean).map((l) => ctx.key[l.replace(/_/g, "-")] ?? l.slice(0, 8)).join(".");
function failure(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return `error ${err?.code ? `${err.code} ` : ""}${err?.message ?? String(e)}`;
}
async function attempt(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "ok"; } catch (e) { return failure(e); }
}
async function changedSince(ctx: Ctx, tag: string): Promise<string> {
  const rows = await ctx.env.admin`SELECT key, what FROM hierarchy_test.diff_snap(${tag})`;
  return `changed=${rows.map((r: { key: string; what: string }) => `${r.key}:${r.what}`).join(" ")}`;
}
const snap = (ctx: Ctx, tag: string) => ctx.env.admin`SELECT hierarchy_test.take_snap(${tag})`;
const orgA = (ctx: Ctx) => ctx.org.A;
async function member(ctx: Ctx, viewerKey: string, memberKey: string): Promise<ManagedMember> {
  const viewer = await profileRow(ctx, ctx.id[viewerKey]);
  const { members } = await loadUserManagementMembers({
    viewer: { id: viewer.id, role: viewer.role, isSuperAdmin: viewer.is_super_admin }, organizationId: orgA(ctx),
  });
  const found = members.find((m) => m.id === ctx.id[memberKey]);
  if (!found) throw new Error(`${memberKey} is not in ${viewerKey}'s member list`);
  return found;
}
function formOf(m: ManagedMember, patch: Partial<ProfileSaveForm> = {}): ProfileSaveForm {
  return {
    firstName: m.firstName, lastName: m.lastName, email: m.email, phone: m.phone ?? "", role: m.role, status: m.status,
    avatar: m.avatar ?? "", isSuperAdmin: m.isSuperAdmin, licensedStates: m.profile.licensedStates,
    residentState: m.profile.residentState, commissionLevel: m.profile.commissionLevel,
    uplineId: m.profile.uplineId ?? "_none", npn: m.profile.npn, timezone: m.profile.timezone, carriers: m.profile.carriers,
    ...patch,
  };
}
const ADMIN_VIEWER: ProfileSaveViewer = { isAdminViewer: true, isSelf: false, isSuperAdminViewer: false };
const TL_VIEWER: ProfileSaveViewer = { isAdminViewer: false, isSelf: false, isSuperAdminViewer: false };

const CYCLE = "Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)";
const CROSS_ORG = "Hierarchy: an upline must belong to the same organization";
const SELF = "Hierarchy: a member cannot be their own upline";
const INVITE = "Hierarchy: an invitation's upline must be an active member of the same organization";
const ACCOUNT_CONTROL = "Only an Admin of this organization may change account-control fields (status, team, upline, billing)";
const COMMISSION = "Only an Admin of this organization may change another member's commission level";
const RLS_UPDATE = "Update failed: User profile not found or permission denied (RLS). Please ensure you have applied the latest database migrations.";
const DELETE_REFUSED = "Only an Admin of this organization can transfer contacts and delete a member.";

// ── Cases ──────────────────────────────────────────────────────────────────────────────────────
// Reads: profiles_select_org admits every same-org read and the walks follow upline_id, so every
// read is identical in every state (the compatibility claim); the expected values come from the
// production shape (supabase/tests/fixtures/hierarchy_shapes.json).
const READS: Case[] = [
  {
    id: "C01", title: "getAgentScopeTraversal (Team Leader T)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const t = await usersSupabaseApi.getAgentScopeTraversal({ viewerId: ctx.id.T, organizationId: orgA(ctx) });
      return `scoped=${keys(ctx, t.scopedIds)} traversed=${keys(ctx, t.traversedIds)}`;
    },
    expect: () => "scoped=T,A1,A2 traversed=T,A1,A2,D1",
  },
  {
    id: "C02", title: "getAgentScopeTraversal (Admin R) walks through Deleted members",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const t = await usersSupabaseApi.getAgentScopeTraversal({ viewerId: ctx.id.R, organizationId: orgA(ctx) });
      return `scoped=${keys(ctx, t.scopedIds)} traversed=${keys(ctx, t.traversedIds)}`;
    },
    expect: () => "scoped=R,T,K1,K2,K3,K4,K5,A1,A2 traversed=R,T,T2,K1,K2,K3,K4,K5,A1,A2,D1,D2",
  },
  {
    id: "C03", title: "getAgentScopeIds (Agent A1; Team Leader T without an org)",
    run: async (ctx) => {
      await signInAs(ctx, "A1");
      const a = await usersSupabaseApi.getAgentScopeIds({ viewerId: ctx.id.A1, organizationId: orgA(ctx) });
      await signInAs(ctx, "T");
      const none = await usersSupabaseApi.getAgentScopeIds({ viewerId: ctx.id.T, organizationId: null });
      return `A1=${keys(ctx, a)} no-org=[${none.join(",")}]`;
    },
    expect: () => "A1=A1 no-org=[]",
  },
  {
    id: "C04", title: "getUplineChainIds (A1, D2; an org-B id stays outside)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const a1 = await usersSupabaseApi.getUplineChainIds({ profileId: ctx.id.A1, organizationId: orgA(ctx) });
      const d2 = await usersSupabaseApi.getUplineChainIds({ profileId: ctx.id.D2, organizationId: orgA(ctx) });
      const ba = await usersSupabaseApi.getUplineChainIds({ profileId: ctx.id.BA, organizationId: orgA(ctx) });
      return `A1=${keys(ctx, a1)} D2=${keys(ctx, d2)} BA=[${keys(ctx, ba)}]`;
    },
    expect: () => "A1=T,R D2=T2,R BA=[]",
  },
  {
    id: "C05", title: "getByIds with role / status narrowing (Deleted never returned)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const ids = [ctx.id.T, ctx.id.A1, ctx.id.A2, ctx.id.D1, ctx.id.BA];
      const all = await usersSupabaseApi.getByIds({ ids, organizationId: orgA(ctx) });
      const agents = await usersSupabaseApi.getByIds({ ids, organizationId: orgA(ctx), role: "Agent", status: "Active" });
      return `all=${keys(ctx, all.map((u) => u.id))} agents=${keys(ctx, agents.map((u) => u.id))}`;
    },
    expect: () => "all=A1,A2,T agents=A1,A2",
  },
  {
    id: "C06", title: "getAll (Admin R): org members, role filter, search",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const all = await usersSupabaseApi.getAll({ organizationId: orgA(ctx) });
      const tls = await usersSupabaseApi.getAll({ organizationId: orgA(ctx), role: "Team Leader" });
      const k3 = await usersSupabaseApi.getAll({ organizationId: orgA(ctx), search: "k3" });
      return `all=${keys(ctx, all.map((u) => u.id))} tl=${keys(ctx, tls.map((u) => u.id))} search=${keys(ctx, k3.map((u) => u.id))}`;
    },
    expect: () => "all=A1,A2,K1,K2,K3,K4,K5,R,T tl=T search=K3",
  },
  {
    id: "C07", title: "getDownlineAgents (direct reports; no org → no query)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const t = await usersSupabaseApi.getDownlineAgents(ctx.id.T, orgA(ctx));
      const none = await usersSupabaseApi.getDownlineAgents(ctx.id.T, null);
      return `T=${keys(ctx, t.map((a) => a.id))} no-org=[${none.length}]`;
    },
    expect: () => "T=A1,A2 no-org=[0]",
  },
  {
    id: "C08", title: "loadUplineCandidates (Admin R): A1, T, and D2 under a Deleted Team Leader",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const a1 = await loadUplineCandidates({ targetId: ctx.id.A1, organizationId: orgA(ctx), currentUplineId: ctx.id.T });
      const t = await loadUplineCandidates({ targetId: ctx.id.T, organizationId: orgA(ctx), currentUplineId: ctx.id.R });
      const d2 = await loadUplineCandidates({ targetId: ctx.id.D2, organizationId: orgA(ctx), currentUplineId: ctx.id.T2 });
      const out = (r: Awaited<ReturnType<typeof loadUplineCandidates>>) =>
        `${keys(ctx, r.candidates.map((c) => c.id))}${r.currentOutsideSet ? ` current=${keys(ctx, [r.currentOutsideSet.id])}:${r.currentOutsideSet.status}` : ""}`;
      return `A1=${out(a1)} T=${out(t)} D2=${out(d2)}`;
    },
    expect: () => "A1=R,T T=R D2=R,T current=T2:Deleted",
  },
  {
    id: "C09", title: "loadInviteManagerCandidates and managerNamesById",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const managers = await loadInviteManagerCandidates({ organizationId: orgA(ctx) });
      const names = await managerNamesById([ctx.id.T, ctx.id.T2, ctx.id.R, ctx.id.BA], orgA(ctx));
      const named = Object.keys(names).map((i) => `${ctx.key[i]}${names[i].status === "Deleted" ? "(Deleted)" : ""}`).sort();
      return `managers=${keys(ctx, managers.map((m) => m.id))} names=${named.join(",")}`;
    },
    expect: () => "managers=R,T names=R,T,T2(Deleted)",
  },
  {
    id: "C10", title: "loadHierarchyTreeData (Admin R, Team Leader T, Agent A1)",
    run: async (ctx) => {
      const out: string[] = [];
      for (const k of ["R", "T", "A1"]) {
        const p = await signInAs(ctx, k);
        const d = await loadHierarchyTreeData({ viewerId: p.id, organizationId: orgA(ctx), role: p.role, isSuperAdmin: p.is_super_admin });
        out.push(`${k}:${d.scope}=${keys(ctx, d.rows.map((r) => r.id))}`);
      }
      return out.join(" ");
    },
    expect: () => "R:organization=R,T,T2,K1,K2,K3,K4,K5,A1,A2,D1,D2 T:reporting-line=R,T,A1,A2,D1 A1:reporting-line=R,T,A1",
  },
  {
    id: "C11", title: "loadUserManagementMembers + manager names (Admin, Team Leader, Agent)",
    run: async (ctx) => {
      const out: string[] = [];
      for (const k of ["R", "T", "A1"]) {
        const p = await signInAs(ctx, k);
        const viewer = { id: p.id, role: p.role, isSuperAdmin: p.is_super_admin };
        const r = await loadUserManagementMembers({ viewer, organizationId: orgA(ctx), traversalCache: new Map() });
        out.push(`${k}:${r.scope}=${keys(ctx, r.members.map((m) => m.id))}`);
        if (k === "T") {
          const agents = await loadUserManagementMembers({ viewer, organizationId: orgA(ctx), filters: { role: "Agent" } });
          const names = await loadMemberManagerNames(r.members, orgA(ctx));
          out.push(`T-agents=${keys(ctx, agents.members.map((m) => m.id))}`);
          out.push(`T-managers=${r.members.map((m) => `${ctx.key[m.id]}>${names[m.profile.uplineId ?? ""] ? ctx.key[m.profile.uplineId as string] : "?"}`).join(",")}`);
        }
      }
      return out.join(" ");
    },
    expect: () => "R:organization=A1,A2,K1,K2,K3,K4,K5,R,T T:downline=A1,A2,T T-agents=A1,A2 T-managers=A1>T,A2>T,T>R A1:self=A1",
  },
  {
    id: "C12", title: "Team tab loaders: loadTeamMembers (T), loadTeamAssignableAgents (org C leader)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const team = await loadTeamMembers({ leaderId: ctx.id.T, organizationId: orgA(ctx) });
      await signInAs(ctx, "CA");
      const add = await loadTeamAssignableAgents({ leaderId: ctx.id.CA, organizationId: ctx.org.C });
      return `team=${keys(ctx, team.map((r) => r.id))} assignable=${keys(ctx, add.map((r) => r.id))}`;
    },
    expect: () => "team=A1,A2 assignable=CG",
  },
  {
    id: "C13", title: "CampaignDetail Team Leader scope + display filter",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const team = await loadCampaignTeamScope({ viewerId: ctx.id.T, organizationId: orgA(ctx) });
      const rows = [ctx.id.T, ctx.id.A1, ctx.id.K1, null].map((claimed_by, i) => ({ id: `row${i}`, claimed_by }));
      const shown = filterCampaignLeadsForRole(rows, { role: "Team Leader", viewerId: ctx.id.T, teamIds: new Set(team) });
      return `team=${keys(ctx, team)} shown=${shown.map((r) => (r.claimed_by ? ctx.key[r.claimed_by] : "unclaimed")).join(",")}`;
    },
    expect: () => "team=T,A1,A2 shown=T,A1,unclaimed",
  },
  {
    // FullScreenContactView's two reads (copied from the component) feeding the real resolver. The
    // Team Leader's team is get_contact_scope_agents — is_ancestor_of — so it widens only once the
    // repaired paths are live (plan §4: self → self + the two Active reports).
    id: "C14", title: "Assigned Agent options: get_contact_scope_agents → resolveAssignableAgents",
    run: async (ctx) => {
      const out: string[] = [];
      for (const k of ["T", "R", "A1"]) {
        const p = await signInAs(ctx, k);
        const sb = session.client as any;
        const roster = await sb.from("profiles").select("id, first_name, last_name, status").eq("organization_id", orgA(ctx)).eq("status", "Active");
        if (roster.error) throw roster.error;
        const team = p.role === "Team Leader" ? await sb.rpc("get_contact_scope_agents") : { data: [] };
        if (team.error) throw team.error;
        const toAgent = (r: { id: string; first_name: string; last_name: string }) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name });
        const options = resolveAssignableAgents({
          role: p.role, viewerId: p.id, isSuperAdmin: p.is_super_admin, orgAgents: roster.data.map(toAgent),
          teamAgents: team.data.map(toAgent), currentAssigneeId: ctx.id.K1,
        });
        out.push(`${k}=${keys(ctx, options.map((o) => o.id)).split(",").sort().join(",")}`);
      }
      return out.join(" ");
    },
    expect: (f) => `T=${f.repaired ? "A1,A2,K1,T" : "K1,T"} R=A1,A2,K1,K2,K3,K4,K5,R,T A1=A1,K1`,
  },
];

const WRITES: Case[] = [
  {
    // Gate 1 exit criterion at the frontend: the F1 payload of an untouched save lists neither upline_id nor
    // commission_level, so saving a Team Leader heals nothing and touches no other row in ANY state.
    id: "W01", title: "saveMemberProfile, Admin renames Team Leader T (F1 payload)",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const m = await member(ctx, "R", "T");
      await snap(ctx, "w01");
      const r = await saveMemberProfile({ user: m, form: formOf(m, { firstName: "Synthetic T renamed" }), viewer: ADMIN_VIEWER, organizationId: orgA(ctx) });
      return `${r.partialError ? failure(r.partialError) : "saved"}; ${await changedSince(ctx, "w01")}`;
    },
    expect: () => "saved; changed=T:updated_at,other",
  },
  {
    // Negative control for R2: the LEGACY payload (upline_id always listed) before M2 rewrites T's direct reports
    // (the §1 live risk); M2's no-op guard makes it harmless. F1 (W01) never sends it.
    id: "W02", title: "control: legacy payload updateProfile(T, unchanged uplineId)",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      await snap(ctx, "w02");
      const r = await attempt(() => usersSupabaseApi.updateProfile(ctx.id.T, { uplineId: ctx.id.R }));
      return `${r}; ${await changedSince(ctx, "w02")}`;
    },
    expect: (f) => (f.m2 ? "ok; changed=T:updated_at"
      : f.repaired ? "ok; changed=A1:updated_at A2:updated_at D1:updated_at T:updated_at"
        : "ok; changed=A1:path,updated_at A2:path,updated_at D1:path,updated_at T:updated_at"),
  },
  {
    id: "W03", title: "saveMemberProfile, Admin moves A1 from T to R (a real move)",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const m = await member(ctx, "R", "A1");
      const r = await saveMemberProfile({ user: m, form: formOf(m, { uplineId: ctx.id.R }), viewer: ADMIN_VIEWER, organizationId: orgA(ctx) });
      const p = await profileRow(ctx, ctx.id.A1);
      return `${r.partialError ? failure(r.partialError) : "saved"}; upline=${ctx.key[p.upline_id]} path=${pathKeys(ctx, p.path)}`;
    },
    // Before M2 the preimage trigger derives the path from the OLD upline (root cause #1).
    expect: (f) => `saved; upline=R path=${f.m2 ? "R.A1" : "R.T.A1"}`,
  },
  {
    id: "W04", title: "saveMemberProfile refuses a cycle and a cross-org upline before any write",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const t = await member(ctx, "R", "T");
      await snap(ctx, "w04");
      const cycle = await attempt(() => saveMemberProfile({ user: t, form: formOf(t, { uplineId: ctx.id.A1 }), viewer: ADMIN_VIEWER, organizationId: orgA(ctx) }));
      const cross = await attempt(() => saveMemberProfile({ user: t, form: formOf(t, { uplineId: ctx.id.BA }), viewer: ADMIN_VIEWER, organizationId: orgA(ctx) }));
      return `${cycle === `error ${UPLINE_NOT_AVAILABLE}` ? "cycle refused" : cycle}; ${cross === `error ${UPLINE_NOT_AVAILABLE}` ? "cross-org refused" : cross}; ${await changedSince(ctx, "w04")}`;
    },
    expect: () => "cycle refused; cross-org refused; changed=",
  },
  {
    id: "W05", title: "assignUpline direct (Admin): cycle, cross-org, self — guard messages only with M2",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const cycle = await attempt(() => usersSupabaseApi.assignUpline(ctx.id.T, ctx.id.A1));
      const cross = await attempt(() => usersSupabaseApi.assignUpline(ctx.id.K1, ctx.id.BA));
      const self = await attempt(() => usersSupabaseApi.assignUpline(ctx.id.K2, ctx.id.K2));
      return `cycle: ${cycle} | cross: ${cross} | self: ${self}`;
    },
    expect: (f) => (f.m2 ? `cycle: error 23514 ${CYCLE} | cross: error 23514 ${CROSS_ORG} | self: error 23514 ${SELF}` : "cycle: ok | cross: ok | self: ok"),
  },
  {
    // A deliberate Admin reassignment: from M2 on the path is derived correctly, so T's authority over K1 turns on
    // at once (T's Contacts scope gains K1) — before M3. This is what interim guidance D14 covers until Gate 2c.
    id: "W06", title: "Team tab Add Agent (Admin assigns K1 to T), re-read, T's contact scope",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const r = await attempt(() => usersSupabaseApi.assignUpline(ctx.id.K1, ctx.id.T));
      const team = await loadTeamMembers({ leaderId: ctx.id.T, organizationId: orgA(ctx) });
      await signInAs(ctx, "T");
      const scope = await (session.client as any).rpc("get_contact_scope_agents");
      if (scope.error) throw scope.error;
      const scoped = keys(ctx, scope.data.map((s: { id: string }) => s.id)).split(",").sort().join(",");
      return `${r}; team=${keys(ctx, team.map((x) => x.id))} K1 path=${pathKeys(ctx, (await profileRow(ctx, ctx.id.K1)).path)} T scope=${scoped}`;
    },
    expect: (f) => `ok; team=A1,A2,K1 K1 path=${f.m2 ? "R.T.K1" : "R.K1"} T scope=${
      f.m2 ? (f.repaired ? "A1,A2,K1,T" : "K1,T") : f.repaired ? "A1,A2,T" : "T"}`,
  },
  {
    id: "W07", title: "Team tab Remove (Team Leader T removes A1)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const r = await attempt(() => usersSupabaseApi.removeFromTeam(ctx.id.A1));
      return `${r}; upline=${ctx.key[(await profileRow(ctx, ctx.id.A1)).upline_id]}`;
    },
    // Reachable only on repaired paths, where the account-control trigger refuses; otherwise RLS matches no row.
    expect: (f) => (f.repaired ? `error 42501 ${ACCOUNT_CONTROL}; upline=T` : "ok; upline=T"),
  },
  {
    id: "W08", title: "saveMemberProfile, Team Leader T saves downline A1 (F6: no account-control keys)",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const m = await member(ctx, "T", "A1");
      const r = await saveMemberProfile({ user: m, form: formOf(m, { firstName: "Synthetic A1 renamed", commissionLevel: "90%", uplineId: ctx.id.R }), viewer: TL_VIEWER, organizationId: orgA(ctx) });
      const p = await profileRow(ctx, ctx.id.A1);
      return `${r.partialError ? `partial: ${failure(r.partialError)}` : "saved"}; name=${p.first_name} level=${p.commission_level} upline=${ctx.key[p.upline_id]}`;
    },
    expect: (f) => (f.repaired ? "saved; name=Synthetic A1 renamed level=0% upline=T" : `partial: error ${RLS_UPDATE}; name=Synthetic A1 level=0% upline=T`),
  },
  {
    // A forged direct call (bypassing the F6 payload): the commission guard refuses it with M1 once the TL reaches
    // A1; S3R (M1 rolled back after the repair) is the documented re-widening (plan §10).
    id: "W09", title: "updateProfile direct: Team Leader T changes A1's commission level",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const r = await attempt(() => usersSupabaseApi.updateProfile(ctx.id.A1, { commissionLevel: "90%" }));
      return `${r}; level=${(await profileRow(ctx, ctx.id.A1)).commission_level}`;
    },
    expect: (f) => (!f.repaired ? `error ${RLS_UPDATE}; level=0%` : f.m1 ? `error 42501 ${COMMISSION}; level=0%` : "ok; level=90%"),
  },
  {
    id: "W10", title: "deleteUser with transfer: Team Leader refused before any write; Admin succeeds",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const tl = await attempt(() => usersSupabaseApi.deleteUser(ctx.id.K5, ctx.id.K4));
      const [before] = await ctx.env.admin`SELECT count(*)::int AS n FROM public.leads WHERE assigned_agent_id = ${ctx.id.K5}`;
      await signInAs(ctx, "R");
      const admin = await attempt(() => usersSupabaseApi.deleteUser(ctx.id.K5, ctx.id.K4));
      const [after] = await ctx.env.admin`SELECT count(*)::int AS n FROM public.leads WHERE assigned_agent_id = ${ctx.id.K4}`;
      return `TL: ${tl === `error ${DELETE_REFUSED}` ? "refused" : tl} (K5 leads ${before.n}); Admin: ${admin}; K5=${(await profileRow(ctx, ctx.id.K5)).status} K4 leads ${after.n}`;
    },
    expect: () => "TL: refused (K5 leads 2); Admin: ok; K5=Deleted K4 leads 2",
  },
  {
    // R1 in the frontend: the delete guard reads the caller's PROFILE, so a demoted Admin's stale token starts no
    // transfer in any state.
    id: "W11", title: "deleteUser with transfer: demoted Admin (DB Agent) with a stale Admin token",
    run: async (ctx) => {
      await ctx.env.admin`UPDATE public.profiles SET role = 'Agent' WHERE id = ${ctx.id.R}`;
      await signInAs(ctx, "R", { role: "Admin" });
      const r = await attempt(() => usersSupabaseApi.deleteUser(ctx.id.K5, ctx.id.K4));
      const [left] = await ctx.env.admin`SELECT count(*)::int AS n FROM public.leads WHERE assigned_agent_id = ${ctx.id.K5}`;
      return `${r === `error ${DELETE_REFUSED}` ? "refused" : r}; K5 leads ${left.n}; K5=${(await profileRow(ctx, ctx.id.K5)).status}`;
    },
    expect: () => "refused; K5 leads 2; K5=Active",
  },
  {
    id: "W12", title: "deleteUser without transfer: Team Leader T on A1",
    run: async (ctx) => {
      await signInAs(ctx, "T");
      const r = await attempt(() => usersSupabaseApi.deleteUser(ctx.id.A1));
      return `${r}; A1=${(await profileRow(ctx, ctx.id.A1)).status}`;
    },
    expect: (f) => (f.repaired ? `error 42501 ${ACCOUNT_CONTROL}; A1=Active` : "error Delete failed: user profile not found or permission denied.; A1=Active"),
  },
  {
    // The Invite modal only offers Active Admins / Team Leaders (C09); a direct insert naming a Deleted or
    // foreign upline is refused once M2's invitation guard is live.
    id: "W13", title: "createInvitation with a Deleted / foreign upline (Admin R)",
    run: async (ctx) => {
      await signInAs(ctx, "R");
      const base = { firstName: "Synthetic", lastName: "Invitee", role: "Agent" as const, licensedStates: [], commissionLevel: "0%" };
      const deleted = await attempt(() => usersSupabaseApi.createInvitation({ ...base, email: "deleted-upline@synthetic.invalid", uplineId: ctx.id.T2 }, orgA(ctx)));
      const foreign = await attempt(() => usersSupabaseApi.createInvitation({ ...base, email: "foreign-upline@synthetic.invalid", uplineId: ctx.id.BA }, orgA(ctx)));
      const valid = await attempt(() => usersSupabaseApi.createInvitation({ ...base, email: "valid-upline@synthetic.invalid", uplineId: ctx.id.T }, orgA(ctx)));
      return `deleted: ${deleted} | foreign: ${foreign} | active: ${valid}`;
    },
    expect: (f) => (f.m2 ? `deleted: error 23514 ${INVITE} | foreign: error 23514 ${INVITE} | active: ok` : "deleted: ok | foreign: ok | active: ok"),
  },
];

const CASES = [...READS, ...WRITES];
for (const c of CASES) TITLES.set(c.id, c.title);

describe.skipIf(!ENABLED)("hierarchy frontend ↔ database compatibility (R2)", () => {
  const databases: { state: string; url: string }[] = ENABLED ? harness.stateDatabasesFromEnv() : [];

  afterAll(async () => {
    const states = databases.map((d) => d.state);
    const lines = ["Frontend ↔ database compatibility: case × state (actual outcomes)"];
    for (const c of CASES) {
      lines.push(`${c.id} ${c.title}`);
      for (const s of states) lines.push(`    ${s.padEnd(3)} ${MATRIX.get(c.id)?.[s] ?? "NOT RUN"}`);
    }
    const text = lines.join("\n");
    console.log(text);
    if (process.env.HIERARCHY_COMPAT_REPORT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.HIERARCHY_COMPAT_REPORT, `${text}\n`);
    }
  });

  it("has PostgREST and every state database", () => {
    expect(process.env.POSTGREST_BIN, "POSTGREST_BIN").toBeTruthy();
    expect(databases.map((d) => d.state).sort()).toEqual([...harness.HIERARCHY_STATES].sort());
  });

  for (const { state, url } of databases) {
    describe(state, () => {
      let ctx: Ctx;
      beforeAll(async () => {
        const env = await harness.openStateEnvironment({ state, url, suffix: "compat", bin: process.env.POSTGREST_BIN, seed: seedCompat });
        const k = await harness.shapeKeys(env.admin);
        ctx = { env, id: k.id, org: k.org, key: k.key };
      }, 120_000);
      afterAll(async () => {
        session.client = null;
        if (ctx) await harness.closeStateEnvironment(ctx.env);
      }, 60_000);
      beforeEach(async () => {
        session.client = null;
        await harness.restoreSnapshot(ctx.env.admin);
      });

      for (const c of CASES) {
        it(`${c.id} ${c.title}`, async () => {
          let actual: string;
          try {
            actual = await c.run(ctx);
          } catch (e) {
            actual = `threw ${failure(e)}`;
          }
          MATRIX.set(c.id, { ...(MATRIX.get(c.id) ?? {}), [state]: actual });
          expect(actual).toBe(c.expect(ctx.env.flags));
        }, 60_000);
      }
    });
  }
});
