import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardWidgetFrame } from "@/components/dashboard/ui/DashboardWidgetFrame";
import { DASHBOARD_WIDGET_META } from "@/components/dashboard/ui/dashboardWidgetMeta";

/** The widget card: details open from a real button (and the header), never from the body. */
afterEach(cleanup);

describe("DashboardWidgetFrame", () => {
  it("opens details from a named button and the header, not from the widget body", () => {
    const onOpen = vi.fn();
    render(
      <DashboardWidgetFrame widgetKey="callbacks" editMode={false} onOpenDetails={onOpen}>
        <button type="button">Call Casey</button>
      </DashboardWidgetFrame>,
    );
    expect(screen.getByRole("region", { name: "Callbacks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Callbacks details" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Call Casey" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("heading", { name: "Callbacks" }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("names the edit-mode controls and offers no details button while editing", () => {
    const onHide = vi.fn();
    render(
      <DashboardWidgetFrame widgetKey="anniversaries" editMode onHide={onHide} onOpenDetails={vi.fn()} dragHandleProps={{}}>
        <p>body</p>
      </DashboardWidgetFrame>,
    );
    expect(screen.getByRole("button", { name: "Reorder Client Milestones" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide Client Milestones widget" }));
    expect(onHide).toHaveBeenCalledWith("anniversaries");
    expect(screen.queryByRole("button", { name: /details/ })).not.toBeInTheDocument();
  });

  it("keeps persisted keys and gives every widget its category tone", () => {
    expect(Object.fromEntries(Object.entries(DASHBOARD_WIDGET_META).map(([key, meta]) => [key, [meta.label, meta.tone]]))).toEqual({
      callbacks: ["Callbacks", "blue"],
      appointments: ["Schedule", "purple"],
      goal_progress: ["Goal Progress", "green"],
      leaderboard: ["Leaderboard", "gold"],
      missed_calls: ["Missed Calls", "red"],
      anniversaries: ["Client Milestones", "pink"],
    });
  });
});
