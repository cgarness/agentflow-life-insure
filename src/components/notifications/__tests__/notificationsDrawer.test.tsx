import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { NotificationsPanel } from "../NotificationsPanel";
import type { DbNotification } from "@/contexts/NotificationContext";

// jsdom shims Radix needs (scoped to this file, not the global setup)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(window as any).ResizeObserver = (window as any).ResizeObserver || RO;

(Element.prototype as any).hasPointerCapture = (Element.prototype as any).hasPointerCapture || (() => false);

(Element.prototype as any).setPointerCapture = (Element.prototype as any).setPointerCapture || (() => {});

(Element.prototype as any).releasePointerCapture = (Element.prototype as any).releasePointerCapture || (() => {});

(Element.prototype as any).scrollIntoView = (Element.prototype as any).scrollIntoView || (() => {});
// jsdom has no PointerEvent; MouseEvent carries the button/coords semantics Radix checks

(window as any).PointerEvent = (window as any).PointerEvent || MouseEvent;

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const markRead = vi.fn(() => new Promise<void>(() => {})); // never resolves — navigation must not wait
const markAllRead = vi.fn(async () => {});
const dismissNotification = vi.fn(async () => {});
const retry = vi.fn();
const loadMore = vi.fn(async () => {});
const loadMoreUnread = vi.fn(async () => {});

type CtxShape = {
  notifications: DbNotification[];
  unreadCount: number;
  isLoading: boolean;
  loadError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  isLoadingMoreUnread: boolean;
  retry: typeof retry;
  loadMore: typeof loadMore;
  loadMoreUnread: typeof loadMoreUnread;
  markRead: typeof markRead;
  markAllRead: typeof markAllRead;
  dismissNotification: typeof dismissNotification;
  requestPushPermission: () => Promise<string>;
};

const ctx: CtxShape = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  loadError: false,
  hasMore: false,
  isLoadingMore: false,
  isLoadingMoreUnread: false,
  retry,
  loadMore,
  loadMoreUnread,
  markRead,
  markAllRead,
  dismissNotification,
  requestPushPermission: async () => "granted",
};

vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ctx,
}));

const notif = (over: Partial<DbNotification>): DbNotification =>
  ({
    id: Math.random().toString(36).slice(2),
    user_id: "u1",
    type: "missed_call",
    title: "Missed Call",
    body: "Missed call from Pat Lee",
    read: false,
    action_url: "/contacts?contact=c1",
    action_label: "View Contact",
    metadata: {},
    created_at: "2026-08-18T12:00:00.000Z",
    organization_id: "org1",
    event_key: "x",
    dismissed_at: null,
    ...over,
  }) as DbNotification;

const setCtx = (over: Partial<CtxShape>) => {
  Object.assign(ctx, {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    loadError: false,
    hasMore: false,
    isLoadingMore: false,
    isLoadingMoreUnread: false,
    ...over,
  });
};

const renderDrawer = (onClose = vi.fn()) => {
  const utils = render(<NotificationsPanel open onClose={onClose} />);
  return { onClose, ...utils };
};

beforeEach(() => {
  vi.clearAllMocks();
  setCtx({});
});

describe("drawer shell", () => {
  it("renders as a right-side full-height sheet with title, description, and 440px desktop width", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("id", "notifications-drawer");
    expect(dialog.className).toContain("right-0");
    expect(dialog.className).toContain("h-full");
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).toContain("sm:w-[440px]");
    expect(within(dialog).getByText("Notifications")).toBeInTheDocument();
    // accessible description wired via aria-describedby
    expect(dialog).toHaveAttribute("aria-describedby");
  });

  it("closes on Escape", () => {
    const { onClose } = renderDrawer();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop interaction", async () => {
    const { onClose } = renderDrawer();
    const overlay = document.querySelector(".fixed.inset-0");
    expect(overlay).not.toBeNull();
    // Radix attaches its outside-pointerdown listener a tick after mount
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    fireEvent.pointerDown(overlay as Element, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(overlay as Element, { pointerId: 1, button: 0 });
    fireEvent.click(overlay as Element);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows the exact server unread count independent of loaded page size", () => {
    setCtx({ notifications: [notif({}), notif({})], unreadCount: 137 });
    renderDrawer();
    expect(screen.getByText("99+")).toBeInTheDocument();
    setCtx({ notifications: [notif({})], unreadCount: 42 });
    renderDrawer();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("filters and grouping", () => {
  it("offers only All and Unread filters (no category tabs)", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
    expect(screen.queryByText("Calls")).not.toBeInTheDocument();
    expect(screen.queryByText("Leads")).not.toBeInTheDocument();
    expect(screen.queryByText("Messages")).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("groups unread under New and read under Earlier, newest first", () => {
    setCtx({
      notifications: [
        notif({ id: "a", title: "Unread newest", read: false, created_at: "2026-08-18T12:00:00.000Z" }),
        notif({ id: "b", title: "Read older", read: true, created_at: "2026-08-16T12:00:00.000Z" }),
        notif({ id: "c", title: "Unread older", read: false, created_at: "2026-08-17T12:00:00.000Z" }),
      ],
      unreadCount: 2,
    });
    renderDrawer();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
    const titles = screen.getAllByTestId("notification-title").map((el) => el.textContent);
    expect(titles).toEqual(["Unread newest", "Unread older", "Read older"]);
  });

  it("Unread filter hides read rows and shows the no-unread state when empty", () => {
    setCtx({
      notifications: [notif({ id: "r", title: "Read one", read: true })],
      unreadCount: 0,
    });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(screen.queryByText("Read one")).not.toBeInTheDocument();
    expect(screen.getByText("No unread notifications")).toBeInTheDocument();
  });
});

describe("states", () => {
  it("shows a loading skeleton instead of flashing the empty state", () => {
    setCtx({ isLoading: true });
    renderDrawer();
    expect(screen.queryByText(/No notifications/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("notification-skeleton").length).toBeGreaterThan(0);
  });

  it("shows an error state with a working Retry", () => {
    setCtx({ loadError: true });
    renderDrawer();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(retry).toHaveBeenCalled();
  });

  it("shows a clean empty state when there is nothing at all", () => {
    renderDrawer();
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
  });

  it("offers Load more when another page exists", () => {
    setCtx({ notifications: [notif({})], hasMore: true });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /load earlier/i }));
    expect(loadMore).toHaveBeenCalled();
  });
});

describe("fast interaction", () => {
  it("navigates immediately with optimistic mark-read (never awaits the network)", () => {
    const onClose = vi.fn();
    setCtx({ notifications: [notif({ id: "n1", title: "Go", action_url: "/contacts?contact=c9" })], unreadCount: 1 });
    render(<NotificationsPanel open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("notification-title"));
    // markRead's promise never resolves; navigation must already have happened
    expect(markRead).toHaveBeenCalledWith("n1");
    expect(navigateMock).toHaveBeenCalledWith("/contacts?contact=c9");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not navigate to a non-internal action_url", () => {
    setCtx({ notifications: [notif({ id: "n2", title: "Evil", action_url: "https://evil.example" })], unreadCount: 1 });
    renderDrawer();
    fireEvent.click(screen.getByTestId("notification-title"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("Delete lives in the row overflow menu, opened and used via keyboard", async () => {
    setCtx({ notifications: [notif({ id: "n3", title: "Dismiss me" })], unreadCount: 1 });
    renderDrawer();
    const trigger = screen.getByRole("button", { name: /notification actions/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
    fireEvent.click(deleteItem);
    expect(dismissNotification).toHaveBeenCalledWith("n3");
  });

  it("Mark all read is available while anything is unread", () => {
    setCtx({ notifications: [notif({})], unreadCount: 1 });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    expect(markAllRead).toHaveBeenCalled();
  });
});

describe("corrective pass — Unread filter/page boundary", () => {
  const thirtyReadRows = () =>
    Array.from({ length: 30 }, (_, i) =>
      notif({ id: `read${i}`, title: `Read ${i}`, read: true, created_at: `2026-08-18T12:00:${String(59 - i).padStart(2, "0")}.000Z` }),
    );

  it("never shows 'No unread notifications' while the authoritative unreadCount is above zero", () => {
    // loaded page is entirely read, but 3 older unread rows exist server-side
    setCtx({ notifications: thirtyReadRows(), unreadCount: 3 });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(screen.queryByText("No unread notifications")).not.toBeInTheDocument();
  });

  it("auto-loads the server-side unread rows when the Unread view has none loaded", () => {
    setCtx({ notifications: thirtyReadRows(), unreadCount: 3 });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(loadMoreUnread).toHaveBeenCalled();
  });

  it("keeps a manual load path visible when more unread exist than are loaded — even with zero filtered rows", () => {
    setCtx({ notifications: thirtyReadRows(), unreadCount: 3, isLoadingMoreUnread: true });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    // while loading, a progress affordance is visible instead of any empty state
    expect(screen.getByTestId("unread-loading")).toBeInTheDocument();
  });

  it("offers 'Load more unread' when some unread rows are loaded but the server count is higher", () => {
    setCtx({
      notifications: [...thirtyReadRows(), notif({ id: "u-loaded", title: "One unread", read: false })],
      unreadCount: 5,
    });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(screen.getByText("One unread")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load more unread/i }));
    expect(loadMoreUnread).toHaveBeenCalled();
  });

  it("still shows the true no-unread state when the authoritative count is exactly zero", () => {
    setCtx({ notifications: thirtyReadRows(), unreadCount: 0 });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(screen.getByText("No unread notifications")).toBeInTheDocument();
    expect(loadMoreUnread).not.toHaveBeenCalled();
  });
});

describe("corrective pass 2 — automatic unread loading runs at most once per entry", () => {
  const allReadRows = () =>
    Array.from({ length: 30 }, (_, i) =>
      notif({ id: `r${i}`, title: `R${i}`, read: true, created_at: `2026-08-18T12:00:${String(59 - i).padStart(2, "0")}.000Z` }),
    );

  it("a settled failed/empty auto-load does not loop; one manual click issues exactly one more call", () => {
    setCtx({ notifications: allReadRows(), unreadCount: 3 });
    const view = render(<NotificationsPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(loadMoreUnread).toHaveBeenCalledTimes(1);

    // the attempt settles (empty/failed): loading flag cycles true → false while the
    // stale positive count and zero loaded unread rows persist
    setCtx({ notifications: allReadRows(), unreadCount: 3, isLoadingMoreUnread: true });
    view.rerender(<NotificationsPanel open onClose={vi.fn()} />);
    setCtx({ notifications: allReadRows(), unreadCount: 3, isLoadingMoreUnread: false });
    view.rerender(<NotificationsPanel open onClose={vi.fn()} />);
    expect(loadMoreUnread).toHaveBeenCalledTimes(1); // no automatic retry loop

    // manual retry stays available and issues exactly one additional request
    fireEvent.click(screen.getByRole("button", { name: /load unread notifications/i }));
    expect(loadMoreUnread).toHaveBeenCalledTimes(2);
  });

  it("re-entering the Unread view allows one fresh automatic attempt", () => {
    setCtx({ notifications: allReadRows(), unreadCount: 3 });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(loadMoreUnread).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(loadMoreUnread).toHaveBeenCalledTimes(2);
  });
});
