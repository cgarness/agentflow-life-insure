// Reachable only from the isolated Vite entry, never the production build. Synthetic data only.
// Replaces auth, permissions, branding and the Supabase transport; every Campaigns component,
// hook, query adapter, model and preference writer under test is the real source.

const params = new URLSearchParams(window.location.search);
export const persona = (params.get("persona") ?? "admin") as "admin" | "agent";
export const scenario = params.get("state") ?? "default";

const ORG = "c0000000-0000-0000-0000-000000000001";
const ADMIN = "c0000000-0000-0000-0000-0000000000a1";
const AGENTS = [
  ["c0000000-0000-0000-0000-0000000000b1", "Maya", "Torres"],
  ["c0000000-0000-0000-0000-0000000000b2", "Jordan", "Reed"],
  ["c0000000-0000-0000-0000-0000000000b3", "Priya", "Shah"],
  ["c0000000-0000-0000-0000-0000000000b4", "Luis", "Ortega"],
  ["c0000000-0000-0000-0000-0000000000b5", "Dana", "Brooks"],
  ["c0000000-0000-0000-0000-0000000000b6", "Sam", "Okafor"],
] as const;
const SELF = persona === "admin" ? ADMIN : AGENTS[0][0];
const role = persona === "admin" ? "Admin" : "Agent";

const profiles = [
  { id: ADMIN, first_name: "Avery", last_name: "Admin", email: "avery@example.test", role: "Admin", status: "Active", avatar_url: null, organization_id: ORG },
  ...AGENTS.map(([id, first, last]) => ({
    id, first_name: first, last_name: last, email: `${first.toLowerCase()}@example.test`, role: "Agent", status: "Active", avatar_url: null, organization_id: ORG,
  })),
];

const A = AGENTS.map((a) => a[0]);
const day = (n: number) => new Date(Date.UTC(2026, 9, 9 - n, 16, 0, 0)).toISOString();
type Seed = [string, string, string, string[], string | null, string[], number, number, number, number, number, string | null];
// [name, type, status, assigned, owner, tags, total, called, contacted, converted, createdDaysAgo, lastDialedMinutesAgo]
const SEEDS: Seed[] = [
  ["Final Expense — October Fresh", "Team", "Active", [A[0], A[1], A[2], A[3], A[4]], ADMIN, ["final expense", "fresh"], 1240, 868, 312, 41, 2, "12"],
  ["Mortgage Protection Aged Leads", "Open Pool", "Active", [A[0], A[2]], ADMIN, ["mortgage"], 3150, 1418, 402, 37, 9, "95"],
  ["IUL Warm Transfers", "Team", "Paused", [A[1], A[5]], ADMIN, ["iul", "transfers"], 410, 410, 188, 29, 15, "3000"],
  ["Maya — Personal Follow-ups", "Personal", "Active", [A[0]], A[0], ["callbacks"], 86, 51, 22, 6, 4, "30"],
  ["Term Life Facebook Q3", "Team", "Completed", [A[2], A[3], A[4]], ADMIN, ["term", "facebook", "q3"], 2280, 2280, 731, 88, 40, "14400"],
  ["Medicare Supplement T65", "Team", "Draft", [A[3]], ADMIN, [], 0, 0, 0, 0, 1, null],
  ["Veterans Final Expense", "Open Pool", "Active", [A[1]], ADMIN, ["veterans"], 960, 302, 97, 12, 6, "2"],
  ["Jordan — Referral Book", "Personal", "Active", [A[1]], A[1], ["referrals"], 140, 133, 70, 18, 21, "240"],
  ["Spanish FE Leads", "Team", "Active", [A[0], A[4], A[5]], ADMIN, ["spanish", "final expense"], 780, 214, 59, 4, 11, "600"],
  ["Annuity Rollover Prospects", "Team", "Archived", [A[2]], ADMIN, ["annuity"], 330, 330, 120, 15, 120, "60000"],
  ["Recycled Leads 2025", "Open Pool", "Paused", [A[0], A[3]], ADMIN, ["recycled"], 5400, 1260, 210, 9, 70, "20000"],
];

const campaigns = SEEDS.map((s, i) => ({
  id: `c0000000-0000-0000-0000-0000000001${String(i).padStart(2, "0")}`,
  name: s[0], type: s[1], status: s[2], description: i % 3 === 0 ? `Synthetic ${s[1].toLowerCase()} campaign for layout verification.` : null,
  assigned_agent_ids: s[3], tags: s[5], user_id: s[4], created_by: s[4], created_at: day(s[10]), organization_id: ORG,
  retry_interval_minutes: [1440, 120, 60, 240][i % 4], retry_interval_hours: 24, max_attempts: i % 2 ? 6 : null,
  calling_hours_start: "08:00:00", calling_hours_end: "21:00:00", ring_timeout_seconds: i % 3 ? 25 : null,
  total_leads: s[6], leads_called: s[7],
  _stats: { contacted: s[8], converted: s[9] }, _lastDialed: s[11],
}));

/** campaigns_select RLS: Admin sees the org; an Agent sees Open Pool, own Personal, assigned Team. */
function rlsVisible(c: (typeof campaigns)[number]) {
  if (persona === "admin") return true;
  if (c.type === "Open Pool") return true;
  if (c.type === "Personal") return c.user_id === SELF;
  return c.assigned_agent_ids.includes(SELF);
}
/** get_campaign_card_stats scope: other users' Personal campaigns are never returned. */
function rpcVisible(c: (typeof campaigns)[number]) {
  if (c.type === "Open Pool") return true;
  if (c.type === "Personal") return c.user_id === SELF;
  return persona === "admin" || c.assigned_agent_ids.includes(SELF);
}

const PREFS_KEY = `campaigns-visual-prefs:${SELF}`;
const requests: string[] = [];
const never = () => new Promise<never>(() => {});

type Filter = [op: "eq" | "is" | "in", col: string, val: unknown];
class Query {
  private filters: Filter[] = [];
  private op: "select" | "update" | "insert" = "select";
  private values: Record<string, unknown> | null = null;
  private from = 0;
  private to = Number.MAX_SAFE_INTEGER;
  private single = false;
  private count = false;
  constructor(private table: string) {}
  select(_cols?: string, opts?: { count?: string }) { this.count = opts?.count === "exact"; return this; }
  eq(col: string, val: unknown) { this.filters.push(["eq", col, val]); return this; }
  is(col: string, val: unknown) { this.filters.push(["is", col, val]); return this; }
  in(col: string, val: unknown) { this.filters.push(["in", col, val]); return this; }
  order() { return this; }
  range(from: number, to: number) { this.from = from; this.to = to; return this; }
  abortSignal() { return this; }
  maybeSingle() { this.single = true; return this; }
  update(values: Record<string, unknown>) { this.op = "update"; this.values = values; return this; }
  insert(values: Record<string, unknown>) { this.op = "insert"; this.values = values; return this; }
  then<T>(ok: (v: unknown) => T, fail?: (e: unknown) => T) { return this.run().then(ok, fail); }
  private match(row: Record<string, unknown>) {
    return this.filters.every(([op, col, val]) => op === "in" ? (val as unknown[]).includes(row[col]) : op === "is" ? row[col] === val : row[col] === val);
  }
  private async run(): Promise<unknown> {
    requests.push(`${this.op}:${this.table}`);
    if (this.table === "campaigns") {
      if (this.op === "insert") return { data: null, error: null };
      if (scenario === "loading") return never();
      if (scenario === "error") return { data: null, error: { message: "synthetic failure" } };
      const rows = scenario === "empty" ? [] : campaigns.filter(rlsVisible).filter((r) => this.match(r));
      return { data: rows.slice(this.from, this.to + 1), error: null, count: this.count ? rows.length : null };
    }
    if (this.table === "profiles") {
      const rows = profiles.filter((r) => this.match(r));
      return { data: rows.slice(this.from, this.to + 1), error: null, count: this.count ? rows.length : null };
    }
    if (this.table === "organizations") return { data: { status: params.get("org") ?? "active" }, error: null };
    if (this.table === "activity_logs") return { data: null, error: null };
    if (this.table === "user_preferences") {
      const stored = localStorage.getItem(PREFS_KEY);
      const row = stored ? JSON.parse(stored) : null;
      if (this.op === "select") return { data: row, error: null };
      const next = { settings: this.values!.settings, updated_at: new Date().toISOString() };
      if (this.op === "insert") { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); return { data: null, error: null }; }
      if (!row || !this.match(row)) return { data: [], error: null };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return { data: [{ updated_at: next.updated_at }], error: null };
    }
    throw new Error(`Unexpected fixture table: ${this.table}`);
  }
}

class Rpc {
  private from = 0;
  private to = Number.MAX_SAFE_INTEGER;
  constructor(private fn: string, private args: Record<string, unknown> | undefined, private count: boolean) {}
  order() { return this; }
  range(from: number, to: number) { this.from = from; this.to = to; return this; }
  abortSignal() { return this; }
  then<T>(ok: (v: unknown) => T, fail?: (e: unknown) => T) { return this.run().then(ok, fail); }
  private async run(): Promise<unknown> {
    requests.push(`rpc:${this.fn}`);
    if (this.fn === "get_campaign_card_stats") {
      if (scenario === "stats-loading") return never();
      if (scenario === "stats-error") return { data: null, error: { message: "synthetic failure" } };
      const ids = (this.args?.p_campaign_ids as string[]) ?? [];
      const data = campaigns.filter((c) => ids.includes(c.id) && rpcVisible(c)).map((c) => ({
        campaign_id: c.id, total_leads: c.total_leads, called_leads: c.leads_called,
        contacted_leads: c._stats.contacted, converted_leads: c._stats.converted, policies_sold: c._stats.converted + 3,
      }));
      return { data, error: null };
    }
    if (this.fn === "get_campaign_last_dialed") {
      const all = campaigns.filter((c) => c._lastDialed !== null).map((c) => ({
        campaign_id: c.id, last_dialed_at: new Date(Date.now() - Number(c._lastDialed) * 60_000).toISOString(),
      }));
      return { data: all.slice(this.from, this.to + 1), error: null, count: this.count ? all.length : null };
    }
    throw new Error(`Unexpected fixture RPC: ${this.fn}`);
  }
}

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: (fn: string, args?: Record<string, unknown>, opts?: { count?: string }) => new Rpc(fn, args, opts?.count === "exact"),
};

const self = profiles.find((p) => p.id === SELF)!;
const profile = { ...self, is_super_admin: false, organization_id: ORG };
export const useAuth = () => ({ user: { id: SELF }, profile, realProfile: profile, session: null, isImpersonating: false });

export const usePermissions = () => ({
  isLoading: false,
  error: null,
  permissions: null,
  hasPageAccess: () => true,
  hasFeatureAccess: (key: string) => persona === "admin" || ["Campaigns"].includes(key),
  getDataScope: () => (persona === "admin" ? "all" : "own"),
  canSeeCommission: () => persona === "admin",
});

export const useBranding = () => ({
  formatDate: (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""),
});

Object.assign(window, { campaignsFixture: { requests: () => [...requests], clearPrefs: () => localStorage.removeItem(PREFS_KEY) } });
