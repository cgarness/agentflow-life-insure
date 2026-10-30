import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardCallbacksModal from "../DashboardCallbacksModal";
import type { NormalizedCallbackRow } from "@/lib/dashboard-callbacks";
import { EMPTY_TEAM_CONTEXT, type AttentionFeed } from "@/hooks/useAttentionDetailFeed";

vi.mock("@/lib/dashboard-callbacks", () => ({
  CALLBACK_LOOKBACK_DAYS: 30, CALLBACK_LOOKAHEAD_DAYS: 4,
  bucketCallback: (row: { dueAt: string }, now: Date, tomorrow: Date) =>
    new Date(row.dueAt) < now ? "overdue" : new Date(row.dueAt) < tomorrow ? "dueToday" : "dueSoon",
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const upcoming = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

const rows: NormalizedCallbackRow[] = [
  {
    key: "campaign:1", source: "campaign", sourceRowId: "1", dueAt: past, contactId: "lead-1", contactType: "lead",
    contactName: "John Smith", phone: "5551234567", note: "Requested a quote", canAct: true, blockedReason: null,
    ownerId: null, campaignId: null, clearance: null,
  },
  {
    key: "appointment:2", source: "appointment", sourceRowId: "2", dueAt: upcoming, contactId: "client-2", contactType: "client",
    contactName: "Sarah Davis", phone: "", note: "Application review", canAct: false, blockedReason: "No number on file",
    ownerId: null, campaignId: null, clearance: null,
  },
];

const feedOf = (over: Partial<AttentionFeed<NormalizedCallbackRow>> = {}): AttentionFeed<NormalizedCallbackRow> => ({
  status: "ready", rows, active: 2, cleared: 0, clearedRows: [], clearedStatus: "idle", team: EMPTY_TEAM_CONTEXT,
  view: "active", hasMore: false, pageError: false, loadingMore: false, refreshing: false, refreshError: false, ...over,
});

const onCall = vi.fn();
const onView = vi.fn();
const onRetry = vi.fn();
const onLoadMore = vi.fn();

function mount(feed: AttentionFeed<NormalizedCallbackRow> = feedOf(), clearable = false) {
  return render(
    <DashboardCallbacksModal
      open onClose={vi.fn()} feed={feed} clearable={clearable} busyKeys={new Set()} team={false}
      handlers={{ onCall, onView, onClear: vi.fn(), onUndo: vi.fn() }}
      onViewChange={vi.fn()} onRetry={onRetry} onLoadMore={onLoadMore} onScroll={vi.fn()}
    />,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DashboardCallbacksModal — presentation over the shared feed", () => {
  it("labels counts and search as loaded records, and the footer with the EXACT active total", () => {
    mount(feedOf({ hasMore: true, active: 37 }));
    expect(screen.getByText("2 callbacks loaded")).toBeInTheDocument();
    expect(screen.getByText("Filters apply to loaded records")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 37 active callbacks")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search loaded callbacks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("filters loaded rows without losing the original callback source", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Overdue (1)" }));
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.queryByText("Sarah Davis")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All (2)" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search loaded callbacks" }), { target: { value: "Sarah" } });
    expect(screen.queryByText("John Smith")).not.toBeInTheDocument();
    expect(screen.getByText("Sarah Davis")).toBeInTheDocument();
  });

  it("preserves canonical call and contact actions; a nondialable record stays focusable and says why", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Call John Smith" }));
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0][0]).toBe(rows[0]);
    const blocked = screen.getByRole("button", { name: "Call Sarah Davis" });
    // Blocked, but still reachable by keyboard with its reason (never a silent disabled button).
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).not.toBeDisabled();
    expect(blocked).toHaveAccessibleDescription("No number on file");
    fireEvent.click(blocked);
    expect(onCall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "View Sarah Davis" }));
    expect(onView).toHaveBeenCalledWith(rows[1]);
  });

  it("supports initial failure retry and paginated failure retry without hiding records", () => {
    const view = mount(feedOf({ status: "failed", rows: [] }));
    expect(screen.getByText("Couldn't load these records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <DashboardCallbacksModal open onClose={vi.fn()} feed={feedOf({ pageError: true })} clearable={false} busyKeys={new Set()} team={false}
        handlers={{ onCall, onView }} onViewChange={vi.fn()} onRetry={onRetry} onLoadMore={onLoadMore} onScroll={vi.fn()} />,
    );
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry page" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("offers Clear and the Active / Cleared view only when Clear is available", () => {
    const view = mount();
    expect(screen.queryByRole("button", { name: /^Clear callback for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Callbacks view" })).not.toBeInTheDocument();
    view.unmount();
    mount(feedOf({ cleared: 3 }), true);
    expect(screen.getByRole("button", { name: "Clear callback for John Smith" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Active (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Cleared (3)" })).toHaveAttribute("aria-pressed", "false");
  });
});
