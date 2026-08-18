import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── supabase mock: records every query as an op list; a scriptable dispatcher answers ────────
type Op = { table: string; calls: Array<{ m: string; args: unknown[] }> };
const issuedOps: Op[] = [];
let dispatcher: (op: Op) => { data?: unknown; error?: unknown; count?: number | null };

const opHas = (op: Op, m: string, ...args: unknown[]) =>
  op.calls.some((c) => c.m === m && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));

function makeBuilder(table: string) {
  const op: Op = { table, calls: [] };
  issuedOps.push(op);
  const builder: Record<string, unknown> = {};
  const chain =
    (m: string) =>
    (...args: unknown[]) => {
      op.calls.push({ m, args });
      return builder;
    };
  for (const m of ["select", "eq", "is", "order", "range", "limit", "update", "delete", "upsert", "insert", "maybeSingle"]) {
    builder[m] = chain(m);
  }
  builder.then = (resolve: (v: unknown) => void) => {
    const res = dispatcher(op);
    resolve({ data: null, error: null, count: null, ...res });
  };
  return builder;
}

type RealtimeHandler = { event: string; cb: (payload: unknown) => void };
const realtimeHandlers: RealtimeHandler[] = [];
let subscribeCb: ((status: string) => void) | null = null;

const channelObj = {
  on(_type: string, filter: { event: string }, cb: (payload: unknown) => void) {
    realtimeHandlers.push({ event: filter.event, cb });
    return channelObj;
  },
  subscribe(cb: (status: string) => void) {
    subscribeCb = cb;
    return channelObj;
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    channel: () => channelObj,
    removeChannel: () => {},
  },
}));

const profileRef: { current: { push_notifications_enabled: boolean | null } | null } = {
  current: { push_notifications_enabled: true },
};
// user must be referentially stable across renders (as the real AuthContext provides) —
// a fresh object identity per render would loop the [user]-dependent effects.
const stableUser = { id: "u1" };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: stableUser, profile: profileRef.current }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { NotificationProvider, useNotifications } from "../NotificationContext";
import type { DbNotification } from "../NotificationContext";

const row = (over: Partial<DbNotification>): DbNotification =>
  ({
    id: Math.random().toString(36).slice(2),
    user_id: "u1",
    type: "missed_call",
    title: "Missed Call",
    body: "b",
    read: false,
    action_url: "/contacts?contact=c1",
    action_label: null,
    metadata: {},
    created_at: "2026-08-18T12:00:00.000Z",
    organization_id: "org1",
    event_key: "k",
    dismissed_at: null,
    ...over,
  }) as DbNotification;

const isCountOp = (op: Op) =>
  op.table === "notifications" && op.calls.some((c) => c.m === "select" && JSON.stringify(c.args[1] ?? {}).includes("head"));
const isPageOp = (op: Op) => op.table === "notifications" && opHas(op, "select", "*");
const isUpdateOp = (op: Op) => op.table === "notifications" && op.calls.some((c) => c.m === "update");

let pageRows: DbNotification[] = [];
let unreadCount = 0;
let failNextUpdate = false;
let failPage = false;

const defaultDispatcher = (op: Op) => {
  if (isCountOp(op)) return { count: unreadCount };
  if (isPageOp(op)) {
    if (failPage) return { error: { message: "boom" } };
    const range = op.calls.find((c) => c.m === "range");
    const [from, to] = (range?.args ?? [0, 29]) as [number, number];
    return { data: pageRows.slice(from, to + 1) };
  }
  if (isUpdateOp(op)) {
    if (failNextUpdate) {
      failNextUpdate = false;
      return { error: { message: "update failed" } };
    }
    return { data: null };
  }
  return {};
};

const Probe: React.FC = () => {
  const ctx = useNotifications();
  return (
    <div>
      <div data-testid="unread">{ctx.unreadCount}</div>
      <div data-testid="loading">{String(ctx.isLoading)}</div>
      <div data-testid="error">{String(ctx.loadError)}</div>
      <div data-testid="hasMore">{String(ctx.hasMore)}</div>
      <ul>
        {ctx.notifications.map((n) => (
          <li key={n.id} data-testid="item" data-read={String(n.read)}>
            {n.id}
          </li>
        ))}
      </ul>
      <button onClick={() => ctx.markRead(ctx.notifications[0]?.id ?? "")}>do-mark</button>
      <button onClick={() => ctx.markAllRead()}>do-mark-all</button>
      <button onClick={() => ctx.dismissNotification(ctx.notifications[0]?.id ?? "")}>do-dismiss</button>
      <button onClick={() => ctx.loadMore()}>do-load-more</button>
      <button onClick={() => ctx.retry()}>do-retry</button>
    </div>
  );
};

const renderProbe = () =>
  render(
    <NotificationProvider>
      <Probe />
    </NotificationProvider>,
  );

const insertHandler = () => realtimeHandlers.find((h) => h.event === "INSERT")!;
const updateHandler = () => realtimeHandlers.find((h) => h.event === "UPDATE")!;

class NotificationMock {
  static permission = "granted";
  static instances: NotificationMock[] = [];
  title: string;
  options: Record<string, unknown>;
  onclick: (() => void) | null = null;
  constructor(title: string, options: Record<string, unknown>) {
    this.title = title;
    this.options = options;
    NotificationMock.instances.push(this);
  }
  close() {}
  static requestPermission = vi.fn(async () => NotificationMock.permission);
}

beforeEach(() => {
  issuedOps.length = 0;
  realtimeHandlers.length = 0;
  subscribeCb = null;
  pageRows = [];
  unreadCount = 0;
  failNextUpdate = false;
  failPage = false;
  dispatcher = defaultDispatcher;
  toastError.mockClear();
  NotificationMock.instances = [];
  NotificationMock.permission = "granted";
   
  (window as any).Notification = NotificationMock;
  profileRef.current = { push_notifications_enabled: true };
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

describe("authoritative unread count + first page", () => {
  it("badge count comes from the server head-count, not the loaded rows", async () => {
    pageRows = [row({ id: "a" }), row({ id: "b", read: true })];
    unreadCount = 137;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getAllByTestId("item")).toHaveLength(2);
    expect(screen.getByTestId("unread")).toHaveTextContent("137");
  });

  it("first-page and count queries exclude dismissed rows and are range-limited", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const page = issuedOps.find(isPageOp)!;
    expect(opHas(page, "is", "dismissed_at", null)).toBe(true);
    expect(opHas(page, "range", 0, 29)).toBe(true);
    const count = issuedOps.find(isCountOp)!;
    expect(opHas(count, "is", "dismissed_at", null)).toBe(true);
    expect(opHas(count, "eq", "read", false)).toBe(true);
  });

  it("a failed load is an error state with a working retry — never a fake empty list", async () => {
    failPage = true;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("true"));
    failPage = false;
    pageRows = [row({ id: "a" })];
    fireEvent.click(screen.getByText("do-retry"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("false"));
    expect(screen.getAllByTestId("item")).toHaveLength(1);
  });

  it("loadMore appends the next page and dedupes by id", async () => {
    pageRows = Array.from({ length: 35 }, (_, i) => row({ id: `n${i}` }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("hasMore")).toHaveTextContent("true"));
    expect(screen.getAllByTestId("item")).toHaveLength(30);
    fireEvent.click(screen.getByText("do-load-more"));
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(35));
    expect(screen.getByTestId("hasMore")).toHaveTextContent("false");
    const ids = screen.getAllByTestId("item").map((el) => el.textContent);
    expect(new Set(ids).size).toBe(35);
  });
});

describe("optimistic actions with rollback + error surfacing", () => {
  it("markRead flips locally and decrements the badge; rollback + toast on failure", async () => {
    pageRows = [row({ id: "m1" })];
    unreadCount = 5;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    failNextUpdate = true;
    fireEvent.click(screen.getByText("do-mark"));
    // optimistic first
    expect(screen.getByTestId("item")).toHaveAttribute("data-read", "true");
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // rolled back
    expect(screen.getByTestId("item")).toHaveAttribute("data-read", "false");
    expect(screen.getByTestId("unread")).toHaveTextContent("5");
  });

  it("markAllRead zeroes the badge optimistically and recovers on failure", async () => {
    pageRows = [row({ id: "m1" }), row({ id: "m2" })];
    unreadCount = 9;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    failNextUpdate = true;
    fireEvent.click(screen.getByText("do-mark-all"));
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByTestId("unread")).toHaveTextContent("9");
  });

  it("dismiss issues a soft-dismissal UPDATE (never a DELETE) and removes the row locally", async () => {
    pageRows = [row({ id: "d1" })];
    unreadCount = 1;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByText("do-dismiss"));
    await waitFor(() => expect(screen.queryAllByTestId("item")).toHaveLength(0));
    const dismissOp = issuedOps.find(
      (op) => isUpdateOp(op) && op.calls.some((c) => c.m === "update" && JSON.stringify(c.args[0]).includes("dismissed_at")),
    );
    expect(dismissOp).toBeTruthy();
    expect(issuedOps.some((op) => op.table === "notifications" && op.calls.some((c) => c.m === "delete"))).toBe(false);
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });
});

describe("realtime", () => {
  it("INSERT prepends, dedupes by id, and bumps the badge for unread rows", async () => {
    pageRows = [row({ id: "existing" })];
    unreadCount = 1;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    act(() => {
      insertHandler().cb({ new: row({ id: "fresh" }) });
      insertHandler().cb({ new: row({ id: "fresh" }) }); // duplicate delivery
    });
    expect(screen.getAllByTestId("item")).toHaveLength(2);
    expect(screen.getByTestId("unread")).toHaveTextContent("2");
  });

  it("an UPDATE that sets dismissed_at removes the row (cross-device dismissal)", async () => {
    pageRows = [row({ id: "gone" })];
    unreadCount = 1;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    act(() => {
      updateHandler().cb({ new: row({ id: "gone", dismissed_at: "2026-08-18T13:00:00.000Z" }) });
    });
    expect(screen.queryAllByTestId("item")).toHaveLength(0);
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });

  it("reconciles (count refetch) when the window regains focus", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const countOpsBefore = issuedOps.filter(isCountOp).length;
    unreadCount = 4;
    act(() => {
      fireEvent(window, new Event("focus"));
    });
    await waitFor(() => expect(issuedOps.filter(isCountOp).length).toBeGreaterThan(countOpsBefore));
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("4"));
  });
});

describe("browser push honesty", () => {
  it("fires only when the preference is on, permission granted, and the app is hidden/unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    act(() => {
      insertHandler().cb({ new: row({ id: "p1", title: "Ping" }) });
    });
    expect(NotificationMock.instances).toHaveLength(1);
    expect(NotificationMock.instances[0].options.tag).toBe("p1");
  });

  it("stays silent when push_notifications_enabled is false", async () => {
    profileRef.current = { push_notifications_enabled: false };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    act(() => {
      insertHandler().cb({ new: row({ id: "p2" }) });
    });
    expect(NotificationMock.instances).toHaveLength(0);
  });

  it("stays silent while the app is visible and focused (drawer open or closed is irrelevant)", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    act(() => {
      insertHandler().cb({ new: row({ id: "p3" }) });
    });
    expect(NotificationMock.instances).toHaveLength(0);
  });
});
