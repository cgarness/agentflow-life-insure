import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Query = { table: string; filters: Array<[string, unknown]>; order?: string };
type Row = Record<string, unknown>;
type Reply = { data: Row[] | null; error: { message: string } | null };
const h = vi.hoisted(() => ({
  queries: [] as Query[],
  rows: {} as Record<string, Row[]>,
  execute: vi.fn<(query: Query) => Promise<Reply>>(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const query: Query = { table, filters: [] };
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder; },
      order: (key: string) => { query.order = key; return builder; },
      then: (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => {
        h.queries.push(query);
        return h.execute(query).then(resolve, reject);
      },
    };
    return builder;
  },
} }));
import { useFloatingDialerDispositions } from "../useFloatingDialerDispositions";

function respond(query: Query): Reply {
  const data = (h.rows[query.table] ?? [])
    .filter(row => query.filters.every(([key, value]) => row[key] === value))
    .sort((a, b) => Number(a[query.order ?? "sort_order"]) - Number(b[query.order ?? "sort_order"]));
  return { data, error: null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(org: string | null = "org-a", user: string | null = "user-a") {
  return renderHook(({ org, user }) => useFloatingDialerDispositions(org, user),
    { initialProps: { org, user } });
}
beforeEach(() => {
  h.queries = [];
  h.rows = {
    dispositions: [
      { id: "a-sold", organization_id: "org-a", name: "Sold", color: "#22C55E", sort_order: 2,
        require_notes: true, min_note_chars: 5, callback_scheduler: true, automation_trigger: true,
        automation_id: "auto-a", pipeline_stage_id: "stage-a" },
      { id: "b-answer", organization_id: "org-b", name: "No Answer", color: "#3B82F6", sort_order: 1 },
      { id: "a-answer", organization_id: "org-a", name: "No Answer", color: "#9CA3AF", sort_order: 1 },
      { id: "b-sold", organization_id: "org-b", name: "Sold", color: "#059669", sort_order: 2,
        pipeline_stage_id: "stage-b" },
    ],
    pipeline_stages: [
      { id: "stage-b", organization_id: "org-b", pipeline_type: "lead", convert_to_client: false },
      { id: "stage-a", organization_id: "org-a", pipeline_type: "lead", convert_to_client: true },
      { id: "recruit-a", organization_id: "org-a", pipeline_type: "recruit", convert_to_client: true },
    ],
  };
  h.execute.mockReset().mockImplementation(async query => respond(query));
});
afterEach(cleanup);

it("waits for both identity fields, then filters both real service queries and preserves configured fields/order", async () => {
  const view = mount(null, null);
  expect(view.result.current.status).toBe("unresolved");
  expect(h.queries).toHaveLength(0);
  view.rerender({ org: "org-a", user: null });
  expect(h.queries).toHaveLength(0);
  view.rerender({ org: "org-a", user: "super-admin" });
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(h.queries).toHaveLength(2);
  for (const query of h.queries) expect(query.filters).toContainEqual(["organization_id", "org-a"]);
  expect(h.queries.find(q => q.table === "pipeline_stages")?.filters).toContainEqual(["pipeline_type", "lead"]);
  expect(view.result.current.dispositions.map(d => d.id)).toEqual(["a-answer", "a-sold"]);
  expect(view.result.current.dispositions[1]).toEqual({
    id: "a-sold", name: "Sold", color: "#22C55E", require_notes: true, min_note_chars: 5,
    callback_scheduler: true, automation_trigger: true, automation_id: "auto-a", pipeline_stage_id: "stage-a",
  });
  expect(view.result.current.pipelineStages).toEqual([{ id: "stage-a", convert_to_client: true }]);
  expect(view.result.current.isCurrent()).toBe(true);
});

it("does not coalesce legitimate same-label rows by name", async () => {
  h.rows.dispositions.push({ ...h.rows.dispositions[2], id: "a-answer-two", sort_order: 3 });
  const view = mount();
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(view.result.current.dispositions.filter(d => d.name === "No Answer").map(d => d.id))
    .toEqual(["a-answer", "a-answer-two"]);
});

it.each(["dispositions", "pipeline_stages"])("withholds partial configuration on %s error and allows retry", async table => {
  h.execute.mockImplementation(async query => query.table === table
    ? { data: null, error: { message: "private diagnostic" } } : respond(query));
  const view = mount();
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(view.result.current.dispositions).toEqual([]);
  expect(view.result.current.pipelineStages).toEqual([]);
  expect(view.result.current.isCurrent()).toBe(false);
  h.execute.mockImplementation(async query => respond(query));
  act(() => view.result.current.retry());
  expect(view.result.current.status).toBe("loading");
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
});

it("distinguishes an empty agency from a failed lookup", async () => {
  const view = mount("empty-org");
  await waitFor(() => expect(view.result.current.status).toBe("empty"));
  expect(view.result.current.isCurrent()).toBe(false);
});

it("does not expose dispositions until the matching pipeline read also settles", async () => {
  const pending = deferred<Reply>();
  h.execute.mockImplementation(async query => query.table === "pipeline_stages" ? pending.promise : respond(query));
  const view = mount();
  await waitFor(() => expect(h.queries).toHaveLength(2));
  expect(view.result.current.status).toBe("loading");
  expect(view.result.current.dispositions).toEqual([]);
  await act(async () => pending.resolve(respond(h.queries.find(q => q.table === "pipeline_stages")!)));
  expect(view.result.current.status).toBe("ready");
});

it("masks the prior snapshot on the first render of another scope, including user-only changes", async () => {
  const renders: Array<{ org: string | null; user: string; ids: string[] }> = [];
  const view = renderHook(({ org, user }: { org: string | null; user: string }) => {
    const config = useFloatingDialerDispositions(org, user);
    renders.push({ org, user, ids: config.dispositions.map(d => d.id) });
    return config;
  }, { initialProps: { org: "org-a", user: "user-a" } });
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  const previous = view.result.current.isCurrent;
  view.rerender({ org: "org-b", user: "user-a" });
  expect(renders.find(r => r.org === "org-b")?.ids).toEqual([]);
  expect(previous()).toBe(false);
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  expect(view.result.current.dispositions.map(d => d.id)).toEqual(["b-answer", "b-sold"]);
  view.rerender({ org: "org-b", user: "user-b" });
  expect(renders.find(r => r.user === "user-b")?.ids).toEqual([]);
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  view.rerender({ org: null, user: "user-b" });
  expect(view.result.current.status).toBe("unresolved");
  expect(view.result.current.dispositions).toEqual([]);
});

it("ignores delayed A results across A -> B -> A and never restores the old request token", async () => {
  const first = deferred<Reply>();
  let delayed: Query | undefined;
  h.execute.mockImplementation(async query => {
    if (!delayed && query.table === "dispositions") { delayed = query; return first.promise; }
    return respond(query);
  });
  const view = mount();
  await waitFor(() => expect(delayed).toBeDefined());
  const firstVersion = view.result.current.version;
  view.rerender({ org: "org-b", user: "user-a" });
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  view.rerender({ org: "org-a", user: "user-a" });
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  const latestVersion = view.result.current.version;
  expect(latestVersion).not.toBe(firstVersion);
  await act(async () => first.resolve({ data: [{ id: "obsolete" }], error: null }));
  expect(view.result.current.version).toBe(latestVersion);
  expect(view.result.current.dispositions.map(d => d.id)).toEqual(["a-answer", "a-sold"]);
});

it("ignores obsolete failures after rapid retries and invalidates saved handlers on unmount", async () => {
  const first = deferred<Reply>();
  let delayed = false;
  h.execute.mockImplementation(async query => {
    if (!delayed && query.table === "dispositions") { delayed = true; return first.promise; }
    return respond(query);
  });
  const view = mount();
  await waitFor(() => expect(delayed).toBe(true));
  act(() => view.result.current.retry());
  act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  await act(async () => first.reject(new Error("obsolete failure")));
  expect(view.result.current.status).toBe("ready");
  const wasCurrent = view.result.current.isCurrent;
  expect(wasCurrent()).toBe(true);
  view.unmount();
  expect(wasCurrent()).toBe(false);
});
