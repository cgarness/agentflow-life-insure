import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingSmsStatus } from "@/components/messaging/PendingSmsStatus";
import type { PendingSmsView } from "@/lib/sms-send/smsDisplayMerge";

afterEach(cleanup);

const view = (over: Partial<PendingSmsView>): PendingSmsView => ({
  localId: "local-1", state: "sending", slow: false, message: null, reconcile: "none", ...over,
});

function renderStatus(v: PendingSmsView, canEdit = true) {
  const onEdit = vi.fn();
  const onDismiss = vi.fn();
  render(<PendingSmsStatus view={v} canEdit={canEdit} onEdit={onEdit} onDismiss={onDismiss} />);
  return { onEdit, onDismiss, region: screen.getByRole("status") };
}

const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("PendingSmsStatus", () => {
  it("in flight: Sending…, then Still sending…, with no actions", () => {
    renderStatus(view({}));
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(buttons()).toEqual([]);
    cleanup();
    renderStatus(view({ slow: true }));
    expect(screen.getByText("Still sending…")).toBeInTheDocument();
  });

  it("proven not sent: reason, Edit (only into an empty SMS composer) and Dismiss", () => {
    const { onEdit, onDismiss } = renderStatus(view({ state: "not_sent", message: "This number can't receive texts." }));
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByTitle("This number can't receive texts.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onEdit).toHaveBeenCalledWith("local-1");
    expect(onDismiss).toHaveBeenCalledWith("local-1");
    cleanup();
    renderStatus(view({ state: "not_sent", message: "No." }), false);
    expect(buttons()).toEqual(["Dismiss"]);
  });

  it("not confirmed: never offers Edit, copy or resend", () => {
    renderStatus(view({ state: "uncertain", message: "Delivery could not be confirmed." }), true);
    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    expect(buttons()).toEqual(["Dismiss"]);
  });

  it("accepted: no label while the saved row is read; a pending-history label if it cannot be", () => {
    const { region } = renderStatus(view({ state: "accepted", reconcile: "pending" }));
    expect(region).toHaveTextContent("");
    expect(buttons()).toEqual([]);
    cleanup();
    renderStatus(view({ state: "accepted", reconcile: "unavailable" }));
    expect(screen.getByText("Accepted · history pending")).toBeInTheDocument();
    cleanup();
    renderStatus(view({ state: "accepted_review", message: "Saved history needs review." }));
    expect(screen.getByText("Accepted · history not saved")).toBeInTheDocument();
    expect(buttons()).toEqual(["Dismiss"]);
  });

  it("keeps one polite live region mounted across state changes", () => {
    const { rerender } = render(<PendingSmsStatus view={view({})} />);
    const region = screen.getByRole("status");
    rerender(<PendingSmsStatus view={view({ state: "not_sent", message: "No." })} />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Not sent");
  });
});
