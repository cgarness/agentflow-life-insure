import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  auth: vi.fn(), responses: [] as { data: unknown; error: { code?: string } | null }[],
  queries: [] as { method: string; value?: unknown; filters: unknown[][]; returning?: string }[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: h.auth },
  from: () => {
    const query = { method: "", filters: [] as unknown[][] } as typeof h.queries[number];
    h.queries.push(query);
    const settle = () => Promise.resolve(h.responses.shift() ?? { data: null, error: null });
    const builder = {
      select(value: string) { if (!query.method) query.method = "select"; query.returning = value; return builder; },
      insert(value: unknown) { query.method = "insert"; query.value = value; return builder; },
      update(value: unknown) { query.method = "update"; query.value = value; return builder; },
      delete() { query.method = "delete"; return builder; },
      eq(...args: unknown[]) { query.filters.push(["eq", ...args]); return builder; },
      is(...args: unknown[]) { query.filters.push(["is", ...args]); return builder; },
      maybeSingle: settle, single: settle,
      then: (resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) => settle().then(resolve, reject),
    };
    return builder;
  },
} }));
import { fetchUserLayout, getDefaultLayout, resetUserLayout, saveUserLayout } from "@/lib/report-layout";
const owner = { userId: "user-1", orgId: "org-1" };
const auth = (id = owner.userId, org = owner.orgId) => ({ data: { user: { id, app_metadata: { organization_id: org } } }, error: null });
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => { h.auth.mockReset(); h.auth.mockResolvedValue(auth()); h.responses = []; h.queries = []; });

describe("Reports personal persistence", () => {
  it("loads and normalizes legacy personal preferences without writing", async () => {
    h.responses.push(ok({ layout: { version: 1, tabs: { overview: [{ id: "stat_inbound", visible: true }] } } }));
    expect((await fetchUserLayout(owner)).sections[0]).toEqual({ id: "stat_inbound", visible: true });
    expect(h.queries.map((q) => q.method)).toEqual(["select"]);
    expect(h.queries[0].filters).toContainEqual(["eq", "user_id", owner.userId]);
  });
  it("inherits an organization default only when the personal row is absent", async () => {
    h.responses.push(ok(null), ok({ layout: { version: 3, sections: [{ id: "stat_inbound", visible: true }] } }));
    expect((await fetchUserLayout(owner)).sections[0].id).toBe("stat_inbound");
    expect(h.queries[1].filters).toContainEqual(["is", "user_id", null]);
  });
  it("does not treat a read error as absence or write a fallback", async () => {
    h.responses.push({ data: null, error: { code: "42501" } });
    await expect(fetchUserLayout(owner)).rejects.toThrow("Could not load");
    expect(h.queries).toHaveLength(1);
  });
  it.each(["user", "organization", "missing", "auth error"])("rejects %s identity problems before database access", async (kind) => {
    if (kind === "user") h.auth.mockResolvedValue(auth("user-2"));
    if (kind === "organization") h.auth.mockResolvedValue(auth(owner.userId, "org-2"));
    if (kind === "missing") h.auth.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "auth error") h.auth.mockResolvedValue({ data: { user: null }, error: new Error("offline") });
    await expect(saveUserLayout(owner, getDefaultLayout())).rejects.toThrow();
    expect(h.queries).toHaveLength(0);
  });
  it("rejects an identity change after lookup instead of writing the new account", async () => {
    h.auth.mockResolvedValueOnce(auth()).mockResolvedValueOnce(auth("user-2"));
    h.responses.push(ok({ id: "layout-1" }));
    await expect(saveUserLayout(owner, getDefaultLayout())).rejects.toThrow("account or organization changed");
    expect(h.queries.map((q) => q.method)).toEqual(["select"]);
  });
  it("updates only the exact owner row and returns an immutable acknowledged snapshot", async () => {
    const draft = getDefaultLayout(); draft.sections.forEach(Object.freeze); Object.freeze(draft.sections); Object.freeze(draft);
    h.responses.push(ok({ id: "layout-1" }), ok({ id: "layout-1" }));
    const saved = await saveUserLayout(owner, draft);
    expect(saved).toEqual(draft); expect(saved).not.toBe(draft);
    expect(h.queries[1].filters).toEqual([["eq", "id", "layout-1"], ["eq", "organization_id", owner.orgId], ["eq", "user_id", owner.userId]]);
    expect(h.queries[1].returning).toBe("id");
  });
  it("inserts a non-null personal owner and surfaces unique first-save conflicts", async () => {
    h.responses.push(ok(null), { data: null, error: { code: "23505" } });
    await expect(saveUserLayout(owner, getDefaultLayout())).rejects.toThrow("another tab");
    expect(h.queries[1].value).toMatchObject({ user_id: owner.userId, organization_id: owner.orgId });
    expect(h.queries.map((q) => q.method)).toEqual(["select", "insert"]);
  });
  it.each([{ data: null, error: { code: "42501" } }, { data: null, error: null }])("does not claim an unacknowledged update succeeded", async (result) => {
    h.responses.push(ok({ id: "layout-1" }), result);
    await expect(saveUserLayout(owner, getDefaultLayout())).rejects.toThrow("Could not save");
  });
  it("propagates delete failure without replacing the draft with a fallback", async () => {
    h.responses.push({ data: null, error: { code: "42501" } });
    await expect(resetUserLayout(owner)).rejects.toThrow("Could not reset");
    expect(h.queries).toHaveLength(1);
  });
  it("reset deletes only the personal row then returns the inherited layout", async () => {
    h.responses.push(ok(null), ok(null), ok({ layout: { version: 4, sections: [{ id: "stat_inbound", visible: true }] } }));
    expect((await resetUserLayout(owner)).sections[0].id).toBe("stat_inbound");
    expect(h.queries[0]).toMatchObject({ method: "delete", filters: [["eq", "organization_id", owner.orgId], ["eq", "user_id", owner.userId]] });
    expect(h.queries.every((q) => q.method !== "insert" && q.method !== "update")).toBe(true);
  });
});
