/**
 * Contacts Build 6 — DeleteConfirmModal contract.
 *
 * Guards the shared destructive-confirmation dialog extracted from Contacts.tsx:
 * closed → renders nothing; default pluralized title + irreversible warning;
 * the optional description slot replaces the default warning (powers the cleaner
 * import-undo copy); Cancel → onClose; confirm → onConfirm then onClose.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import DeleteConfirmModal from "@/components/contacts/DeleteConfirmModal";

const baseProps = {
  open: true,
  count: 3,
  onConfirm: vi.fn(async () => {}),
  onClose: vi.fn(),
};

describe("DeleteConfirmModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<DeleteConfirmModal {...baseProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a default pluralized title and the irreversible-action warning", () => {
    render(<DeleteConfirmModal {...baseProps} />);
    expect(screen.getByText("Delete 3 contacts?")).toBeTruthy();
    expect(screen.getByText("This action cannot be undone.")).toBeTruthy();
  });

  it("singularizes the default title for a single contact", () => {
    render(<DeleteConfirmModal {...baseProps} count={1} />);
    expect(screen.getByText("Delete 1 contact?")).toBeTruthy();
  });

  it("renders a custom title, description, and confirm label; description replaces the default warning", () => {
    render(
      <DeleteConfirmModal
        {...baseProps}
        title="Undo this import? 5 leads will be removed."
        description="Removes the leads created by this import."
        confirmLabel="Undo Import"
      />,
    );
    expect(screen.getByText("Undo this import? 5 leads will be removed.")).toBeTruthy();
    expect(screen.getByText("Removes the leads created by this import.")).toBeTruthy();
    expect(screen.getByText("Undo Import")).toBeTruthy();
    expect(screen.queryByText("This action cannot be undone.")).toBeNull();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<DeleteConfirmModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs onConfirm then onClose when the confirm button is clicked", async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<DeleteConfirmModal {...baseProps} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
