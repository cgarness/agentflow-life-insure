import { getFixtureAuth, identities } from "./auth";

// Synthetic transport only. Real hooks, validators, forms and query invalidation run unchanged.
// This fixture is not evidence of PostgreSQL/RLS behavior; the native SQL suite covers that.
type Row = Record<string, unknown>;
type Reply = { data: Row | Row[] | null; error: Error | null };
type Operation = "select" | "insert" | "update" | "delete";
type Event = { table: string; operation: Operation; filters: Record<string, unknown>; payload: Row | null };
const storageKey = "agentflow:carrier-browser-fixture:v1";
const link = (suffix: string, label: string, url: string, group = "quick_links") => ({
  id: `b1000000-0000-4000-8000-${suffix.padStart(12, "0")}`, label, url, group,
});
const rowsAtStart: Row[] = [
  {
    id: "c1000000-0000-4000-8000-000000000001", organization_id: identities.organizationA,
    name: "Atlas Example Life", portal_url: "https://atlas.example/agent", logo_url: null,
    contact_phones: [{ label: "Agent support", value: "+1 (800) 555-0100 ext. 12" }],
    contact_emails: [{ label: "Underwriting", value: "underwriting.department.for.individual.life@atlas.example" }],
    resource_links: [
      link("1", "Start an application", "https://atlas.example/apply"),
      link("2", "Case status", "https://atlas.example/cases"),
      link("3", "Underwriting guide — accelerated and fully underwritten coverage", "https://atlas.example/guide.pdf", "guides_training"),
      link("4", "Product training and certification", "https://atlas.example/training", "guides_training"),
      link("5", "Duplicate portal", "https://atlas.example/agent"),
    ],
    is_appointed: true, updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000002", organization_id: identities.organizationA,
    name: "Beacon Example Life", portal_url: null, logo_url: null, contact_phones: [], contact_emails: [],
    resource_links: [], is_appointed: false, updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000003", organization_id: identities.organizationA,
    name: "WestbridgeExampleLifeAndAnnuityCompanyForIndependentLifeInsuranceAgents",
    portal_url: null, logo_url: null, contact_phones: [], contact_emails: [], resource_links: [],
    is_appointed: false, updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000004", organization_id: identities.organizationB,
    name: "Harbor Example Life", portal_url: null, logo_url: null, contact_phones: [], contact_emails: [],
    resource_links: [], is_appointed: true, updated_at: "2026-01-01T00:00:00.000Z",
  },
];
let rows: Row[] = JSON.parse(localStorage.getItem(storageKey) || "null") ?? structuredClone(rowsAtStart);
const events: Event[] = [];
let failRead = false, failSave = false, delayRead = 0;
const persist = () => localStorage.setItem(storageKey, JSON.stringify(rows));
persist();

class Query {
  private operation: Operation = "select";
  private filters: Record<string, unknown> = {};
  private fields = "*";
  private payload: Row | null = null;
  private one = false;
  constructor(private table: string) {}
  select(fields = "*") { this.fields = fields; return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  order() { return this; }
  update(payload: Row) { this.operation = "update"; this.payload = payload; return this; }
  insert(payload: Row) { this.operation = "insert"; this.payload = payload; return this; }
  delete() { this.operation = "delete"; return this; }
  maybeSingle() { this.one = true; return this; }
  then<T = Reply, U = never>(resolve?: ((reply: Reply) => T | PromiseLike<T>) | null, reject?: ((reason: unknown) => U | PromiseLike<U>) | null) {
    return this.execute().then(resolve, reject);
  }
  private async execute(): Promise<Reply> {
    events.push({ table: this.table, operation: this.operation, filters: { ...this.filters }, payload: structuredClone(this.payload) });
    if (this.table === "role_permissions") return { data: null, error: null };
    if (this.table === "activity_logs" && this.operation === "insert") return { data: null, error: null };
    if (this.table !== "carriers") throw new Error(`Unexpected synthetic table: ${this.table}`);
    const auth = getFixtureAuth();
    if (!auth.user || auth.profile?.id !== auth.user.id || auth.isImpersonating) return { data: null, error: new Error("Synthetic access denied") };
    const scope = this.operation === "insert" ? this.payload?.organization_id : this.filters.organization_id;
    if (scope !== auth.profile.organization_id) throw new Error("Carrier request must carry the confirmed organization scope");
    const matching = rows.filter((row) => Object.entries(this.filters).every(([key, value]) => row[key] === value));
    if (this.operation === "select") {
      const snapshot = structuredClone(matching).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const shouldFail = failRead, delay = delayRead;
      failRead = false; delayRead = 0;
      await new Promise((resolve) => setTimeout(resolve, delay || 30));
      if (shouldFail) return { data: null, error: new Error("Synthetic read failure") };
      return this.reply(snapshot);
    }
    if (auth.profile.role !== "Admin") return { data: null, error: new Error("Synthetic read-only role") };
    if (failSave) { failSave = false; return { data: null, error: new Error("Synthetic save failure; draft must remain") }; }
    const timestamp = new Date().toISOString();
    let affected: Row[] = [];
    if (this.operation === "insert") {
      affected = [{ id: crypto.randomUUID(), ...this.payload, updated_at: timestamp }]; rows.push(...affected);
    } else if (this.operation === "update") {
      affected = matching.map((row) => Object.assign(row, this.payload, { updated_at: timestamp }));
    } else { affected = matching; rows = rows.filter((row) => !matching.includes(row)); }
    persist();
    return this.reply(affected);
  }
  private reply(data: Row[]): Reply {
    const selected = this.fields === "*" ? data : data.map((row) => Object.fromEntries(this.fields.split(",").map((field) => [field, row[field]])));
    return { data: this.one ? selected[0] ?? null : selected, error: null };
  }
}

export const supabase = { from: (table: string) => new Query(table) };
export const fixtureClient = {
  events,
  snapshot: () => structuredClone(rows),
  failNextSave: () => { failSave = true; },
  failNextRead: () => { failRead = true; },
  delayNextRead: (milliseconds: number) => { delayRead = milliseconds; },
  reset: () => { rows = structuredClone(rowsAtStart); events.length = 0; persist(); },
};
