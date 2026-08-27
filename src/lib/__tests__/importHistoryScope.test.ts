/**
 * listImportHistory — organization scoping and uploader scoping.
 *
 * Before this, `Contacts.tsx` ran `.from("import_history").select("*").order(...)` with NO
 * organization filter and NO agent filter, and `import_history_select` RLS is organization-wide
 * (`organization_id = get_user_org_id()`), so every user saw every import in the organization.
 * Errors were swallowed by `if (!error && data)`, making a failed load pixel-identical to an
 * empty history.
 *
 * The mock records the `.select()` projection and every filter, so "this filter was NOT applied"
 * is a real assertion rather than a vacuous one.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface QueryRecord {
  table: string;
  select: string;
  eq: Record<string, unknown>;
  order: { column: string; ascending: boolean }[];
  limit: number | null;
}

const state = vi.hoisted(() => ({
  queries: [] as QueryRecord[],
  rows: [] as Record<string, unknown>[],
  error: null as string | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const record: QueryRecord = { table, select: "*", eq: {}, order: [], limit: null };
    state.queries.push(record);
    const builder: Record<string, unknown> = {
      select(cols: string) { record.select = cols; return builder; },
      eq(col: string, val: unknown) { record.eq[col] = val; return builder; },
      order(column: string, opts?: { ascending?: boolean }) {
        record.order.push({ column, ascending: opts?.ascending !== false });
        return builder;
      },
      limit(n: number) { record.limit = n; return builder; },
      then(resolve: (v: unknown) => unknown) {
        if (state.error) return Promise.resolve({ data: null, error: { message: state.error } }).then(resolve);
        const cols = record.select.split(",").map((c) => c.trim());
        const rows = state.rows
          .filter((row) => Object.entries(record.eq).every(([col, val]) => row[col] === val))
          .map((row) => {
            if (cols.includes("*")) return { ...row };
            const out: Record<string, unknown> = {};
            for (const col of cols) out[col] = row[col];
            return out;
          });
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  }
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { listImportHistory } from "@/lib/supabase-import-history";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ME = "agent-me";
const OTHER = "agent-other";

function importRow(id: string, agentId: string, organizationId = ORG) {
  return {
    id,
    file_name: `${id}.csv`,
    created_at: "2026-08-20T00:00:00Z",
    total_records: 10,
    imported: 9,
    duplicates: 1,
    errors: 0,
    imported_lead_ids: ["l1"],
    import_completion_status: "completed",
    undo_status: null,
    campaign_id: null,
    agent_id: agentId,
    organization_id: organizationId,
  };
}

beforeEach(() => {
  state.queries = [];
  state.error = null;
  state.rows = [];
});

describe("Admin / non-impersonating Super Admin — organization scope", () => {
  it("filters by organization and applies NO agent filter", async () => {
    state.rows = [importRow("mine", ME), importRow("theirs", OTHER)];

    const out = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: true });

    expect(out.map((e) => e.id).sort()).toEqual(["mine", "theirs"]);
    const q = state.queries[0];
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.eq.agent_id).toBeUndefined();
  });

  it("still excludes another organization's imports", async () => {
    state.rows = [importRow("ours", ME, ORG), importRow("foreign", ME, OTHER_ORG)];

    const out = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: true });

    expect(out.map((e) => e.id)).toEqual(["ours"]);
  });
});

describe("every other role, INCLUDING Team Leaders — uploader scope", () => {
  it("applies BOTH the organization filter and the uploader filter", async () => {
    state.rows = [importRow("mine", ME), importRow("theirs", OTHER)];

    const out = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false });

    expect(out.map((e) => e.id)).toEqual(["mine"]);
    const q = state.queries[0];
    expect(q.eq.organization_id).toBe(ORG);
    expect(q.eq.agent_id).toBe(ME);
  });

  it("a Team Leader sees only their OWN imports, not a downline member's", async () => {
    // The requirement is explicit: Team Leaders are not an org-wide viewer and their downline's
    // imports are not theirs. `getAgentScopeIds` is deliberately not consulted here.
    state.rows = [importRow("mine", ME), importRow("downline", "agent-downline")];

    const out = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false });

    expect(out.map((e) => e.id)).toEqual(["mine"]);
  });

  it("a user with no personal imports gets an empty list, not an error", async () => {
    state.rows = [importRow("theirs", OTHER)];

    const out = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false });

    expect(out).toEqual([]);
  });
});

describe("View As", () => {
  it("uses the IMPERSONATED agent's id and organization, never the Super Admin's", async () => {
    const SUPER = "super-admin";
    state.rows = [importRow("agent-import", ME), importRow("super-import", SUPER)];

    // What the page passes while viewing as an Agent: effective id + effective org + orgWide=false
    // (because `isOrganizationWideViewer` is false for the impersonated Agent role).
    const out = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false });

    expect(out.map((e) => e.id)).toEqual(["agent-import"]);
    expect(state.queries[0].eq.agent_id).toBe(ME);
    expect(state.queries[0].eq.agent_id).not.toBe(SUPER);
  });
});

describe("errors are distinguishable from an empty history", () => {
  it("rejects rather than resolving to an empty list", async () => {
    state.error = "permission denied for table import_history";
    await expect(
      listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("fails closed", () => {
  it("issues NO query when the organization is missing", async () => {
    const out = await listImportHistory({ organizationId: null, viewerId: ME, orgWide: false });
    expect(out).toEqual([]);
    expect(state.queries).toHaveLength(0);
  });

  it("issues NO query when a non-org-wide viewer has no id", async () => {
    const out = await listImportHistory({ organizationId: ORG, viewerId: null, orgWide: false });
    expect(out).toEqual([]);
    expect(state.queries).toHaveLength(0);
  });

  it("an org-wide viewer without a viewer id still needs the organization", async () => {
    const out = await listImportHistory({ organizationId: "", viewerId: null, orgWide: true });
    expect(out).toEqual([]);
    expect(state.queries).toHaveLength(0);
  });
});

describe("query shape", () => {
  it("selects an explicit column list (not *) and bounds the result", async () => {
    state.rows = [importRow("mine", ME)];
    await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false });

    const q = state.queries[0];
    expect(q.select).not.toContain("*");
    for (const col of ["id", "file_name", "created_at", "imported_lead_ids", "undo_status", "campaign_id"]) {
      expect(q.select.split(",").map((c) => c.trim())).toContain(col);
    }
    expect(q.order[0]).toMatchObject({ column: "created_at", ascending: false });
    expect(q.limit).toBeGreaterThan(0);
  });

  it("maps rows onto the ImportHistoryEntry shape the drill-in / undo paths expect", async () => {
    state.rows = [importRow("mine", ME)];
    const [entry] = await listImportHistory({ organizationId: ORG, viewerId: ME, orgWide: false });

    expect(entry).toMatchObject({
      id: "mine",
      fileName: "mine.csv",
      date: "2026-08-20T00:00:00Z",
      totalRecords: 10,
      imported: 9,
      duplicates: 1,
      errors: 0,
      importedLeadIds: ["l1"],
      importCompletionStatus: "completed",
      undoStatus: null,
      campaignId: null,
    });
  });
});
