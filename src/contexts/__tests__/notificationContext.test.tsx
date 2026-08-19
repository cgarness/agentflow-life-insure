import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ── supabase mock: records every query as an op list; a scriptable dispatcher answers ────────
type Op = { table: string; calls: Array<{ m: string; args: unknown[] }> };
const issuedOps: Op[] = [];
type OpResult = { data?: unknown; error?: unknown; count?: number | null };
let dispatcher: (op: Op) => OpResult | Promise<OpResult>;

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
  for (const m of ["select", "eq", "is", "or", "order", "range", "limit", "update", "delete", "upsert", "insert", "maybeSingle"]) {
    builder[m] = chain(m);
  }
  builder.then = (resolve: (v: unknown) => void) => {
    const res = dispatcher(op);
    if (res instanceof Promise) {
      void res.then((r) => resolve({ data: null, error: null, count: null, ...r }));
    } else {
      resolve({ data: null, error: null, count: null, ...res });
    }
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
// a fresh object identity per render would loop the [user]-dependent effects. The ref lets
// logout/user-change scenarios swap it between renders.
const userRef: { current: { id: string } | null } = { current: { id: "u1" } };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: userRef.current, profile: profileRef.current }),
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

const byNewest = (a: DbNotification, b: DbNotification) =>
  a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1;

/** Serve page queries the way PostgREST would: keyset cursor via .or(), unread filter, limit. */
const servePage = (op: Op): OpResult => {
  if (failPage) return { error: { message: "boom" } };
  let rows = [...pageRows].sort(byNewest);
  if (opHas(op, "eq", "read", false)) rows = rows.filter((r) => !r.read);
  const orCall = op.calls.find((c) => c.m === "or");
  if (orCall) {
    const m = /created_at\.lt\.([^,]+),and\(created_at\.eq\.\1,id\.lt\.([^)]+)\)/.exec(String(orCall.args[0]));
    if (!m) return { error: { message: `unparseable keyset filter: ${String(orCall.args[0])}` } };
    const [, ts, id] = m;
    rows = rows.filter((r) => r.created_at < ts || (r.created_at === ts && r.id < id));
  }
  const limitCall = op.calls.find((c) => c.m === "limit");
  const rangeCall = op.calls.find((c) => c.m === "range");
  if (limitCall) rows = rows.slice(0, limitCall.args[0] as number);
  else if (rangeCall) {
    const [from, to] = rangeCall.args as [number, number];
    rows = rows.slice(from, to + 1);
  } else rows = rows.slice(0, 30);
  return { data: rows };
};

const defaultDispatcher = (op: Op): OpResult => {
  if (isCountOp(op)) return { count: unreadCount };
  if (isPageOp(op)) return servePage(op);
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
      <button onClick={() => ctx.loadMoreUnread()}>do-load-more-unread</button>
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
  userRef.current = { id: "u1" };
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

  it("first-page and count queries exclude dismissed rows and are page-limited", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const page = issuedOps.find(isPageOp)!;
    expect(opHas(page, "is", "dismissed_at", null)).toBe(true);
    expect(opHas(page, "limit", 30)).toBe(true);
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

describe("corrective pass — unread reachability, keyset pagination, authoritative reconciliation", () => {
  it("older unread rows stay reachable when the loaded page is all-read (server-backed unread paging)", async () => {
    // First 30 rows (newest) are read; 3 older unread rows exist server-side.
    pageRows = [
      ...Array.from({ length: 30 }, (_, i) =>
        row({ id: `read${String(i).padStart(2, "0")}`, read: true, created_at: `2026-08-18T12:00:${String(59 - i).padStart(2, "0")}.000Z` }),
      ),
      row({ id: "old-unread-1", read: false, created_at: "2026-08-15T10:00:03.000Z" }),
      row({ id: "old-unread-2", read: false, created_at: "2026-08-15T10:00:02.000Z" }),
      row({ id: "old-unread-3", read: false, created_at: "2026-08-15T10:00:01.000Z" }),
    ];
    unreadCount = 3;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getAllByTestId("item")).toHaveLength(30);
    expect(screen.getByTestId("unread")).toHaveTextContent("3");

    fireEvent.click(screen.getByText("do-load-more-unread"));
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(33));
    // the unread page query was server-filtered to unread, non-dismissed rows
    const unreadPage = issuedOps.find((op) => isPageOp(op) && opHas(op, "eq", "read", false))!;
    expect(unreadPage).toBeTruthy();
    expect(opHas(unreadPage, "is", "dismissed_at", null)).toBe(true);
    const ids = screen.getAllByTestId("item").map((el) => el.textContent);
    expect(ids).toEqual(expect.arrayContaining(["old-unread-1", "old-unread-2", "old-unread-3"]));
  });

  it("loadMore uses a keyset cursor (created_at + id), so a realtime INSERT cannot shift the page or skip rows", async () => {
    pageRows = Array.from({ length: 35 }, (_, i) =>
      row({ id: `k${String(i).padStart(2, "0")}`, created_at: `2026-08-18T11:00:${String(59 - i).padStart(2, "0")}.000Z` }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("hasMore")).toHaveTextContent("true"));
    // a realtime INSERT lands before the user pages — with offset pagination this would shift
    // the window and skip row k30; keyset must not.
    act(() => {
      insertHandler().cb({ new: row({ id: "zz-realtime", created_at: "2026-08-18T12:30:00.000Z" }) });
    });
    fireEvent.click(screen.getByText("do-load-more"));
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(36));
    const ids = screen.getAllByTestId("item").map((el) => el.textContent);
    for (let i = 0; i < 35; i++) expect(ids).toContain(`k${String(i).padStart(2, "0")}`);
    const pageOpsWithCursor = issuedOps.filter((op) => isPageOp(op) && op.calls.some((c) => c.m === "or"));
    expect(pageOpsWithCursor.length).toBeGreaterThan(0);
    // cursor anchored at the oldest LOADED row (k29), untouched by the newer realtime insert
    expect(String(pageOpsWithCursor[0].calls.find((c) => c.m === "or")!.args[0])).toContain("2026-08-18T11:00:30.000Z");
  });

  it("reconciliation is authoritative: rows no longer present server-side (e.g. retention-deleted) are removed", async () => {
    pageRows = [row({ id: "stays" }), row({ id: "retention-deleted", created_at: "2026-07-01T00:00:00.000Z" })];
    renderProbe();
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(2));
    pageRows = [pageRows[0]]; // server no longer returns the old row
    act(() => {
      fireEvent(window, new Event("focus"));
    });
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(1));
    expect(screen.getByTestId("item")).toHaveTextContent("stays");
  });

  it("reconciles on the INITIAL SUBSCRIBED event, closing the fetch/subscribe race", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const countOpsBefore = issuedOps.filter(isCountOp).length;
    // a row was inserted between the initial fetch and the subscription becoming live
    pageRows = [row({ id: "raced-in" })];
    unreadCount = 1;
    act(() => {
      subscribeCb!("SUBSCRIBED");
    });
    await waitFor(() => expect(issuedOps.filter(isCountOp).length).toBeGreaterThan(countOpsBefore));
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("1"));
    await waitFor(() => expect(screen.queryAllByTestId("item")).toHaveLength(1));
  });

  it("logout invalidates in-flight fetches — an old user's late response cannot repopulate state", async () => {
    let resolvePage: ((r: OpResult) => void) | null = null;
    dispatcher = (op: Op) => {
      if (isCountOp(op)) return { count: 5 };
      if (isPageOp(op)) return new Promise<OpResult>((res) => { resolvePage = res; });
      return {};
    };
    const view = renderProbe();
    await waitFor(() => expect(resolvePage).not.toBeNull());
    // user logs out while the fetch is still in flight
    userRef.current = null;
    view.rerender(
      <NotificationProvider>
        <Probe />
      </NotificationProvider>,
    );
    act(() => {
      resolvePage!({ data: [row({ id: "stale-user-row" })] });
    });
    await waitFor(() => expect(screen.queryAllByTestId("item")).toHaveLength(0));
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });

  it("an UPDATE about an UNLOADED row reconciles the authoritative unread count instead of leaving it stale", async () => {
    pageRows = [row({ id: "loaded" })];
    unreadCount = 4; // 3 unread beyond the loaded page
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("4"));
    const countOpsBefore = issuedOps.filter(isCountOp).length;
    unreadCount = 3; // another device marked one of the unloaded rows read
    act(() => {
      updateHandler().cb({ new: row({ id: "not-loaded-row", read: true }) });
    });
    await waitFor(() => expect(issuedOps.filter(isCountOp).length).toBeGreaterThan(countOpsBefore));
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("3"));
  });

  it("same-tick duplicate INSERT deliveries stay deduped and two distinct inserts both count", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    act(() => {
      insertHandler().cb({ new: row({ id: "x1" }) });
      insertHandler().cb({ new: row({ id: "x1" }) }); // duplicate delivery, same tick
      insertHandler().cb({ new: row({ id: "x2" }) });
    });
    expect(screen.getAllByTestId("item")).toHaveLength(2);
    expect(screen.getByTestId("unread")).toHaveTextContent("2");
  });
});

describe("corrective pass 2 — separate pagination streams + race-safe reconciliation", () => {
  it("the All cursor stays anchored to the All-page boundary after an older unread row was loaded", async () => {
    // 30 newest read rows (the first All page), 40 intervening read rows, one much older unread row.
    pageRows = [
      ...Array.from({ length: 30 }, (_, i) =>
        row({ id: `top${String(i).padStart(2, "0")}`, read: true, created_at: `2026-08-18T12:00:${String(59 - i).padStart(2, "0")}.000Z` }),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        row({ id: `mid${String(i).padStart(2, "0")}`, read: true, created_at: `2026-08-18T11:59:${String(59 - i).padStart(2, "0")}.000Z` }),
      ),
      row({ id: "ancient-unread", read: false, created_at: "2026-08-10T00:00:00.000Z" }),
    ];
    unreadCount = 1;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getAllByTestId("item")).toHaveLength(30);

    // unread stream pulls the much older unread row
    fireEvent.click(screen.getByText("do-load-more-unread"));
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(31));
    expect(screen.getAllByTestId("item").map((el) => el.textContent)).toContain("ancient-unread");

    // the All stream must continue from ITS OWN boundary (top29 @ 12:00:30), not the unread row
    fireEvent.click(screen.getByText("do-load-more"));
    await waitFor(() => expect(screen.getAllByTestId("item")).toHaveLength(61));
    const ids = screen.getAllByTestId("item").map((el) => el.textContent);
    for (let i = 0; i < 30; i++) expect(ids).toContain(`mid${String(i).padStart(2, "0")}`);
    const allPageOps = issuedOps.filter(
      (op) => isPageOp(op) && op.calls.some((c) => c.m === "or") && !opHas(op, "eq", "read", false),
    );
    expect(allPageOps.length).toBeGreaterThan(0);
    expect(String(allPageOps[allPageOps.length - 1].calls.find((c) => c.m === "or")!.args[0])).toContain(
      "2026-08-18T12:00:30.000Z",
    );
  });

  it("a silent reconciliation started before a Realtime INSERT cannot wipe that insert (row + count survive exactly once)", async () => {
    pageRows = [row({ id: "base", read: true })];
    unreadCount = 0;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    // defer the NEXT page response (the silent reconcile's), then let later fetches see fresh data
    let resolveStalePage: ((r: OpResult) => void) | null = null;
    dispatcher = (op: Op) => {
      if (isCountOp(op)) return { count: unreadCount };
      if (isPageOp(op)) {
        if (!resolveStalePage) {
          return new Promise<OpResult>((res) => { resolveStalePage = res; });
        }
        return servePage(op);
      }
      return defaultDispatcher(op);
    };

    act(() => {
      subscribeCb!("SUBSCRIBED"); // reconcile starts; its page response is now hanging
    });
    await waitFor(() => expect(resolveStalePage).not.toBeNull());

    // a newer Realtime INSERT lands while the reconcile is in flight
    pageRows = [row({ id: "live-1", read: false, created_at: "2026-08-18T13:00:00.000Z" }), ...pageRows];
    unreadCount = 1;
    act(() => {
      insertHandler().cb({ new: pageRows[0] });
    });
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("1"));

    // the STALE response resolves with the pre-insert world — it must not overwrite the insert
    act(() => {
      resolveStalePage!({ data: [row({ id: "base", read: true })], count: 0 } as OpResult);
    });
    await waitFor(() => {
      const ids = screen.getAllByTestId("item").map((el) => el.textContent);
      expect(ids.filter((i) => i === "live-1")).toHaveLength(1);
    });
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
  });

  it("a Realtime INSERT arriving while an optimistic action is pending survives that action's failure", async () => {
    pageRows = [
      row({ id: "u-a", read: false, created_at: "2026-08-18T12:00:02.000Z" }),
      row({ id: "u-b", read: false, created_at: "2026-08-18T12:00:01.000Z" }),
    ];
    unreadCount = 2;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    let failPendingUpdate: ((r: OpResult) => void) | null = null;
    dispatcher = (op: Op) => {
      if (isUpdateOp(op)) return new Promise<OpResult>((res) => { failPendingUpdate = res; });
      if (isCountOp(op)) return { count: unreadCount };
      if (isPageOp(op)) return servePage(op);
      return {};
    };

    fireEvent.click(screen.getByText("do-mark-all")); // optimistic: everything read, badge 0
    await waitFor(() => expect(failPendingUpdate).not.toBeNull());
    expect(screen.getByTestId("unread")).toHaveTextContent("0");

    act(() => {
      insertHandler().cb({ new: row({ id: "fresh-live", read: false, created_at: "2026-08-18T13:00:00.000Z" }) });
    });
    expect(screen.getByTestId("unread")).toHaveTextContent("1");

    // the action fails — rollback must be targeted: the realtime row survives, originals revert
    unreadCount = 3; // authoritative post-failure count (2 restored + the live insert)
    act(() => {
      failPendingUpdate!({ error: { message: "update failed" } });
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const ids = screen.getAllByTestId("item").map((el) => el.textContent);
    expect(ids).toContain("fresh-live");
    expect(ids).toContain("u-a");
    expect(ids).toContain("u-b");
    const unreadFlags = screen.getAllByTestId("item").map((el) => el.getAttribute("data-read"));
    expect(unreadFlags.filter((f) => f === "false")).toHaveLength(3);
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("3"));
  });

  it("out-of-order unread-count refreshes: an older response cannot overwrite the latest", async () => {
    pageRows = [row({ id: "loaded", read: true })];
    unreadCount = 5;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("5"));

    const countResolvers: Array<(r: OpResult) => void> = [];
    dispatcher = (op: Op) => {
      if (isCountOp(op)) return new Promise<OpResult>((res) => { countResolvers.push(res); });
      if (isPageOp(op)) return servePage(op);
      return {};
    };

    act(() => {
      updateHandler().cb({ new: row({ id: "unloaded-1", read: true }) }); // refresh #1 (older)
    });
    act(() => {
      updateHandler().cb({ new: row({ id: "unloaded-2", read: true }) }); // refresh #2 (latest)
    });
    await waitFor(() => expect(countResolvers).toHaveLength(2));

    act(() => {
      countResolvers[1]({ count: 7 }); // the LATEST request resolves first
    });
    await waitFor(() => expect(screen.getByTestId("unread")).toHaveTextContent("7"));
    act(() => {
      countResolvers[0]({ count: 9 }); // the OLDER request resolves last — must be discarded
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("unread")).toHaveTextContent("7");
  });
});
