/**
 * useContactFollowUps — the Follow-ups card's data hook.
 *
 * Pins: the tasks read shares the Tasks tab's cache entry (`["tasks", contactId]`); with no data yet an
 * error from EITHER source is an error state (never a partial list); a failed background refetch keeps
 * the data and flags it; `refreshKey` refetches both, including while the very first read is still
 * pending (that read started before the page's write, so it must not be reused).
 */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchRows: vi.fn(),
  getTasks: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/contactFollowUpsQueries", () => ({
  fetchContactFollowUpRows: (...args: unknown[]) => h.fetchRows(...args),
}));
vi.mock("@/lib/tasksApi", () => ({
  tasksApi: { getTasks: (...args: unknown[]) => h.getTasks(...args) },
}));

import { useContactFollowUps } from "@/hooks/useContactFollowUps";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = 24 * 60 * 60 * 1000;

const apptRow = (id: string, offsetMs = 2 * DAY) => ({
  id,
  title: `Meeting ${id}`,
  type: "Sales Call",
  status: "Scheduled",
  start_time: new Date(Date.now() + offsetMs).toISOString(),
  end_time: null,
  notes: null,
  user_id: AGENT_A,
  created_by: AGENT_A,
  contact_id: LEAD,
});
const taskRow = (id: string) => ({
  id,
  contact_id: LEAD,
  contact_type: "lead",
  assigned_to: AGENT_A,
  title: `Task ${id}`,
  task_type: "Follow Up",
  due_date: new Date(Date.now() + 5 * DAY).toISOString(),
  completed_at: null,
});
const rows = (appointments: unknown[] = []) => ({ appointments, campaign: [], truncated: false });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let client: QueryClient;
function setup(initial: { refreshKey?: number; organizationId?: string | null } = {}) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ refreshKey, organizationId }: { refreshKey: number; organizationId: string | null }) =>
      useContactFollowUps({ contactId: LEAD, contactType: "lead", organizationId, refreshKey }),
    {
      wrapper,
      initialProps: {
        refreshKey: initial.refreshKey ?? 0,
        organizationId: initial.organizationId === undefined ? ORG : initial.organizationId,
      },
    },
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.fetchRows.mockReset();
  h.getTasks.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  client.clear();
  errorSpy.mockRestore();
});

describe("loading → ready", () => {
  it("merges appointments and tasks, sorted, and reads tasks under the Tasks tab's own key", async () => {
    const tasks = [taskRow("t1")];
    h.fetchRows.mockResolvedValue(rows([apptRow("a1")]));
    h.getTasks.mockResolvedValue(tasks);

    const { result } = setup();
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.items.map((i) => i.sourceRowId)).toEqual(["a1", "t1"]);
    expect(result.current.summary.primary?.sourceRowId).toBe("a1");
    expect(result.current.refreshFailed).toBe(false);
    expect(h.fetchRows).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: LEAD, contactType: "lead", organizationId: ORG }),
    );
    expect(h.getTasks).toHaveBeenCalledWith(LEAD, ORG);
    expect(client.getQueryData(["tasks", LEAD])).toBe(tasks);
  });

  it("no organization → nothing is read and the card stays in its loading state", async () => {
    const { result } = setup({ organizationId: null });
    await act(async () => {});
    expect(h.fetchRows).not.toHaveBeenCalled();
    expect(h.getTasks).not.toHaveBeenCalled();
    expect(result.current.state).toBe("loading");
  });
});

describe("fails closed", () => {
  it("a tasks error with no data is an error state, even though the appointments loaded (never a partial list)", async () => {
    h.fetchRows.mockResolvedValue(rows([apptRow("a1")]));
    h.getTasks.mockRejectedValue(new Error("tasks down"));

    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.items).toEqual([]);
  });

  it("an appointments error is an error state once its single retry also fails", async () => {
    h.fetchRows.mockRejectedValue(new Error("rows down"));
    h.getTasks.mockResolvedValue([]);

    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("error"), { timeout: 4000 });
    expect(h.fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual([]);
  });

  it("a failed background refetch keeps the data on screen and flags it; Retry clears the flag", async () => {
    h.fetchRows.mockResolvedValue(rows([apptRow("a1")]));
    h.getTasks.mockResolvedValue([]);
    const { result } = setup();
    await waitFor(() => expect(result.current.state).toBe("ready"));

    h.getTasks.mockRejectedValueOnce(new Error("blip"));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["tasks", LEAD] });
    });
    await waitFor(() => expect(result.current.refreshFailed).toBe(true));
    expect(result.current.state).toBe("ready");
    expect(result.current.items.map((i) => i.sourceRowId)).toEqual(["a1"]);

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.refreshFailed).toBe(false));
  });
});

describe("refreshKey", () => {
  it("a bump after the page's own write refetches both sources", async () => {
    h.fetchRows.mockResolvedValue(rows([]));
    h.getTasks.mockResolvedValue([]);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(h.fetchRows).toHaveBeenCalledTimes(1);
    expect(h.getTasks).toHaveBeenCalledTimes(1);

    h.fetchRows.mockResolvedValue(rows([apptRow("new")]));
    rerender({ refreshKey: 1, organizationId: ORG });
    await waitFor(() => expect(result.current.items.map((i) => i.sourceRowId)).toEqual(["new"]));
    expect(h.fetchRows).toHaveBeenCalledTimes(2);
    expect(h.getTasks).toHaveBeenCalledTimes(2);
  });

  it("a bump while the FIRST read is still pending issues a new read instead of reusing the pre-write one", async () => {
    const first = deferred<ReturnType<typeof rows>>();
    h.fetchRows.mockReturnValueOnce(first.promise).mockResolvedValue(rows([apptRow("new")]));
    h.getTasks.mockResolvedValue([]);

    const { result, rerender } = setup();
    await waitFor(() => expect(h.fetchRows).toHaveBeenCalledTimes(1));

    rerender({ refreshKey: 1, organizationId: ORG });
    await waitFor(() => expect(h.fetchRows).toHaveBeenCalledTimes(2));
    first.resolve(rows([])); // the stale pre-write read lands late and must not win

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.items.map((i) => i.sourceRowId)).toEqual(["new"]);
  });
});
