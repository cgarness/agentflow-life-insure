import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardCallbacksModal, { type DashboardCallbackRow } from "../DashboardCallbacksModal";

vi.mock("@/lib/dashboard-callbacks", () => ({
  CALLBACK_LOOKBACK_DAYS: 30, CALLBACK_LOOKAHEAD_DAYS: 4,
  bucketCallback: (row: { dueAt: string }, now: Date, tomorrow: Date) =>
    new Date(row.dueAt) < now ? "overdue" : new Date(row.dueAt) < tomorrow ? "dueToday" : "dueSoon",
}));

const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const upcoming = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

const rows: DashboardCallbackRow[] = [
  {
    __callback: true, __rowKey: "campaign:1", __canAct: true, __canOpen: true, __blockedReason: null,
    contact_name: "John Smith", contact_id: "lead-1", contact_type: "lead", phone: "5551234567",
    start_time: past, notes: "Requested a quote", type: "Campaign callback",
  },
  {
    __callback: true, __rowKey: "appointment:2", __canAct: false, __canOpen: true,
    __blockedReason: "No number on file",
    contact_name: "Sarah Davis", contact_id: "client-2", contact_type: "client", phone: "",
    start_time: upcoming, notes: "Application review", type: "Callback",
  },
];

const onCall = vi.fn();
const onView = vi.fn();
const onRetry = vi.fn();
const onLoadMore = vi.fn();

function mount(overrides: Partial<React.ComponentProps<typeof DashboardCallbacksModal>> = {}) {
  return render(
    <DashboardCallbacksModal
      open onClose={vi.fn()} rows={rows}
      loading={false} loadError={false} pageError={false} loadingMore={false} hasMore={false}
      onCall={onCall} onView={onView} onRetry={onRetry} onLoadMore={onLoadMore} onScroll={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DashboardCallbacksModal — single-modal visual experiment", () => {
  it("labels counts and search as loaded records, not fabricated global totals", () => {
    mount({ hasMore: true });
    expect(screen.getByText("2 callbacks loaded")).toBeInTheDocument();
    expect(screen.getByText("Filters apply to loaded records")).toBeInTheDocument();
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

  it("preserves canonical call and contact actions and disables nondialable records", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Call John Smith" }));
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0][1]).toBe(rows[0]);
    expect(screen.getByRole("button", { name: "Call Sarah Davis" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "View Sarah Davis" }));
    expect(onView).toHaveBeenCalledWith(rows[1]);
  });

  it("supports initial failure retry and paginated failure retry without hiding records", () => {
    const view = mount({ rows: [], loadError: true });
    expect(screen.getByText("Couldn't load these records")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <DashboardCallbacksModal open onClose={vi.fn()} rows={rows}
        loading={false} loadError={false} pageError={true} loadingMore={false} hasMore={false}
        onCall={onCall} onView={onView} onRetry={onRetry} onLoadMore={onLoadMore} onScroll={vi.fn()} />,
    );
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry page" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
