import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Pure contract (no mocks) ----
import {
  resolveSort,
  buildLeadFilterPayload,
  leadSortColumnToCanonical,
  clientSortColumnToCanonical,
  recruitSortColumnToCanonical,
  LEAD_SORT_COLUMNS,
  CLIENT_SORT_COLUMNS,
  RECRUIT_SORT_COLUMNS,
  DEFAULT_SORT,
} from "@/lib/contactsFilters";

describe("sort allowlist + direction validation (resolveSort)", () => {
  it("keeps a valid column + direction", () => {
    expect(resolveSort(LEAD_SORT_COLUMNS, "name", "asc")).toEqual({ column: "name", direction: "asc" });
    expect(resolveSort(LEAD_SORT_COLUMNS, "created_at", "desc")).toEqual({ column: "created_at", direction: "desc" });
  });
  it("rejects an unknown column / invalid direction / missing (→ default)", () => {
    expect(resolveSort(LEAD_SORT_COLUMNS, "ssn", "asc")).toBeNull();
    expect(resolveSort(LEAD_SORT_COLUMNS, "name", "sideways")).toBeNull();
    expect(resolveSort(LEAD_SORT_COLUMNS, null, "asc")).toBeNull();
  });
  it("default sort is created_at desc", () => {
    expect(DEFAULT_SORT).toEqual({ column: "created_at", direction: "desc" });
  });
});

describe("column-key → canonical mapping (per tab)", () => {
  it("leads", () => {
    expect(leadSortColumnToCanonical("source")).toBe("lead_source");
    expect(leadSortColumnToCanonical("agent")).toBe("assigned_agent");
    expect(leadSortColumnToCanonical("createdDate")).toBe("created_at");
    expect(leadSortColumnToCanonical("ssn")).toBeNull();
  });
  it("clients", () => {
    expect(clientSortColumnToCanonical("faceAmount")).toBe("face_amount");
    expect(clientSortColumnToCanonical("agent")).toBe("assigned_agent");
    expect(clientSortColumnToCanonical("attempts")).toBeNull();
  });
  it("recruits", () => {
    expect(recruitSortColumnToCanonical("status")).toBe("status");
    expect(recruitSortColumnToCanonical("agent")).toBe("assigned_agent");
    expect(recruitSortColumnToCanonical("premium")).toBeNull();
  });
});

describe("canonical allowlists expose the required keys", () => {
  it("leads / clients / recruits include assigned_agent (+ numeric client fields)", () => {
    expect(LEAD_SORT_COLUMNS).toEqual(expect.arrayContaining(["assigned_agent", "attempt_count", "last_disposition"]));
    expect(CLIENT_SORT_COLUMNS).toEqual(expect.arrayContaining(["assigned_agent", "premium", "face_amount", "issue_date"]));
    expect(RECRUIT_SORT_COLUMNS).toEqual(expect.arrayContaining(["assigned_agent", "status"]));
  });
});

describe("buildLeadFilterPayload carries validated sort (or omits → SQL default)", () => {
  const base = { scope: "mine" as const };
  it("ascending / descending", () => {
    expect(buildLeadFilterPayload({ ...base, sortColumn: "name", sortDirection: "asc" }).sort_column).toBe("name");
    expect(buildLeadFilterPayload({ ...base, sortColumn: "name", sortDirection: "asc" }).sort_direction).toBe("asc");
    expect(buildLeadFilterPayload({ ...base, sortColumn: "status", sortDirection: "desc" }).sort_direction).toBe("desc");
  });
  it("invalid column / direction → null/null (server applies default)", () => {
    expect(buildLeadFilterPayload({ ...base, sortColumn: "ssn", sortDirection: "asc" }).sort_column).toBeNull();
    expect(buildLeadFilterPayload({ ...base, sortColumn: "name", sortDirection: "x" }).sort_column).toBeNull();
  });
});

describe("saved-pref restore validates against the tab allowlist", () => {
  it("supported saved column restores; unsupported falls back to null", () => {
    expect(leadSortColumnToCanonical("agent")).not.toBeNull();
    expect(leadSortColumnToCanonical("removedColumn")).toBeNull();
    expect(clientSortColumnToCanonical("premium")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assigned-Agent ordering SPEC (the RPC SQL implements this exact ordering:
// LEFT JOIN profiles → agent_sort; NULLS LAST both directions; tie-break
// created_at DESC, id DESC). End-to-end DB ordering is verified by the
// checkpoint-2 read-only SQL; this proves the required ordering semantics.
// ---------------------------------------------------------------------------
interface SpecRow { id: string; agent: string | null; created: number }
function orderByAgentSpec(rows: SpecRow[], dir: "asc" | "desc"): string[] {
  return [...rows]
    .sort((a, b) => {
      const ka = a.agent == null ? null : a.agent.toLowerCase();
      const kb = b.agent == null ? null : b.agent.toLowerCase();
      if (ka !== kb) {
        if (ka == null) return 1; // NULLS LAST
        if (kb == null) return -1; // NULLS LAST
        return dir === "asc" ? ka.localeCompare(kb) : kb.localeCompare(ka);
      }
      if (a.created !== b.created) return a.created > b.created ? -1 : 1; // created_at DESC
      return a.id > b.id ? -1 : 1; // id DESC tie-break
    })
    .map((r) => r.id);
}

describe("Assigned Agent ordering — A / B / unassigned fixture", () => {
  // Two contacts for Agent A (same name → exercises tie-break), one for Agent B, one unassigned.
  const fixture: SpecRow[] = [
    { id: "a1", agent: "Alice A", created: 3 },
    { id: "a2", agent: "Alice A", created: 1 },
    { id: "b1", agent: "Bob B", created: 2 },
    { id: "u1", agent: null, created: 4 }, // unassigned (most recent)
  ];

  it("ascending: by agent name, unassigned LAST, tie-break created desc then id desc", () => {
    expect(orderByAgentSpec(fixture, "asc")).toEqual(["a1", "a2", "b1", "u1"]);
  });
  it("descending: agent name desc, unassigned still LAST", () => {
    expect(orderByAgentSpec(fixture, "desc")).toEqual(["b1", "a1", "a2", "u1"]);
  });
  it("the unassigned row is preserved in both directions (never dropped — no !inner)", () => {
    expect(orderByAgentSpec(fixture, "asc")).toContain("u1");
    expect(orderByAgentSpec(fixture, "desc")).toContain("u1");
  });
  it("spans more than one page consistently (full-dataset order, then slice)", () => {
    const asc = orderByAgentSpec(fixture, "asc");
    const pageSize = 2;
    expect(asc.slice(0, pageSize)).toEqual(["a1", "a2"]); // page 1
    expect(asc.slice(pageSize, pageSize * 2)).toEqual(["b1", "u1"]); // page 2 — incl. unassigned
  });
});

// ---------------------------------------------------------------------------
// Clients/Recruits use the server-side RPC (LEFT JOIN), NOT a PostgREST embed.
// ---------------------------------------------------------------------------
const { recorded, rpcResults } = vi.hoisted(() => ({
  recorded: [] as Array<{ rpc: string; args: unknown; ordered?: boolean }>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      const entry: { rpc: string; args: unknown; ordered?: boolean } = { rpc: name, args };
      recorded.push(entry);
      const res = rpcResults[name] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {
        order() { entry.ordered = true; return builder; },
        range(from: number, to: number) {
          const full = Array.isArray(res.data) ? (res.data as unknown[]) : [];
          return Promise.resolve(res.error ? { data: null, error: res.error } : { data: full.slice(from, to + 1), error: null });
        },
        then(onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) {
          return Promise.resolve(res).then(onF, onR);
        },
      };
      return builder;
    },
  },
}));

import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";

const rpcArgs = (name: string) => recorded.find((r) => r.rpc === name)?.args as { p_filters?: Record<string, unknown> } | undefined;

beforeEach(() => {
  recorded.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
});

describe("Clients server-side sort via RPC (no page-local re-sort, no PostgREST embed)", () => {
  it("getAll calls search_contacts_clients with the sort in p_filters", async () => {
    rpcResults["search_contacts_clients"] = { data: { total_count: 0, rows: [] }, error: null };
    await clientsSupabaseApi.getAll({ sortColumn: "assigned_agent", sortDirection: "asc" });
    expect(rpcArgs("search_contacts_clients")?.p_filters?.sort_column).toBe("assigned_agent");
    expect(rpcArgs("search_contacts_clients")?.p_filters?.sort_direction).toBe("asc");
  });

  it("getAllIdsMatching uses contacts_client_ids_matching, ordered by ord, ranged, same sort (parity)", async () => {
    rpcResults["contacts_client_ids_matching"] = {
      data: [{ id: "c1", ord: 1 }, { id: "c2", ord: 2 }],
      error: null,
    };
    const ids = await clientsSupabaseApi.getAllIdsMatching({ sortColumn: "name", sortDirection: "asc" });
    expect(ids).toEqual(["c1", "c2"]);
    const call = recorded.find((r) => r.rpc === "contacts_client_ids_matching");
    expect(call?.ordered).toBe(true); // .order("ord") applied → deterministic range slicing
    expect((call?.args as { p_filters?: Record<string, unknown> })?.p_filters?.sort_column).toBe("name");
  });

  it("returns >1000 ids across ranges, duplicate-free", async () => {
    rpcResults["contacts_client_ids_matching"] = {
      data: Array.from({ length: 2500 }, (_, i) => ({ id: `c${i}`, ord: i })),
      error: null,
    };
    const ids = await clientsSupabaseApi.getAllIdsMatching({ sortColumn: "assigned_agent", sortDirection: "desc" });
    expect(ids).toHaveLength(2500);
    expect(new Set(ids).size).toBe(2500);
    expect(recorded.filter((r) => r.rpc === "contacts_client_ids_matching")).toHaveLength(3);
  });
});

describe("Recruits server-side sort via RPC", () => {
  it("getAll calls search_contacts_recruits with the sort in p_filters", async () => {
    rpcResults["search_contacts_recruits"] = { data: { total_count: 0, rows: [] }, error: null };
    await recruitsSupabaseApi.getAll({ sortColumn: "assigned_agent", sortDirection: "desc" });
    expect(rpcArgs("search_contacts_recruits")?.p_filters?.sort_column).toBe("assigned_agent");
    expect(rpcArgs("search_contacts_recruits")?.p_filters?.sort_direction).toBe("desc");
  });

  it("getAllIdsMatching uses contacts_recruit_ids_matching, ordered by ord", async () => {
    rpcResults["contacts_recruit_ids_matching"] = { data: [{ id: "r1", ord: 1 }], error: null };
    const ids = await recruitsSupabaseApi.getAllIdsMatching({ sortColumn: "status", sortDirection: "asc" });
    expect(ids).toEqual(["r1"]);
    expect(recorded.find((r) => r.rpc === "contacts_recruit_ids_matching")?.ordered).toBe(true);
  });
});
