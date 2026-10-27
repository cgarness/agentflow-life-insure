import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import StandardFieldsPanel from "../custom-fields/StandardFieldsPanel";
import MakeAgencyWideDialog from "../custom-fields/MakeAgencyWideDialog";
import { agencyWideConfirmSchema } from "@/lib/standard-lead-fields";

const status = (states: Record<string, string>, lastAttempt: unknown = null) => ({
  status: Object.values(states).includes("would_create") ? "incomplete" : "complete", last_attempt: lastAttempt,
  fields: [["address", "Address"], ["city", "City"], ["zip_code", "ZIP Code"]].map(([key, name]) => ({ key, name, state: states[key] ?? "exists_agency" })),
});
const impact = { field: { id: "f1", name: "Zip Code", type: "Text", applies_to: ["Leads"] }, owner: { id: "u2", name: "Pat Owner" },
  other_personal_rows: 1, leads_with_key: 12, snapshot: "s".repeat(64), applied: false };

beforeEach(() => rpc.mockReset());
afterEach(cleanup);

describe("StandardFieldsPanel", () => {
  it("is hidden when the database functions are not deployed or the viewer may not manage them", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function" }, { code: "42501", message: "not_permitted" }]) {
      rpc.mockResolvedValueOnce({ data: null, error });
      const { container } = render(<StandardFieldsPanel onChanged={vi.fn()} />);
      await waitFor(() => expect(rpc).toHaveBeenCalled());
      await waitFor(() => expect(container).toBeEmptyDOMElement());
      cleanup(); rpc.mockClear();
    }
  });

  it("shows a failed automatic setup and the idempotent retry adds only what is missing", async () => {
    rpc.mockResolvedValueOnce({ data: status({ city: "would_create", zip_code: "exists_personal" }, { status: "failed", last_error: "23505", attempts: 1, at: "" }), error: null });
    const onChanged = vi.fn();
    render(<StandardFieldsPanel onChanged={onChanged} />);
    expect(await screen.findByText(/Automatic setup didn't finish .*code 23505/)).toBeInTheDocument();
    expect(screen.getByText(/Personal — make it agency-wide/)).toBeInTheDocument();
    rpc.mockResolvedValueOnce({ data: status({ city: "created", zip_code: "exists_personal" }), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Add City" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(rpc.mock.calls).toEqual([["provision_standard_lead_fields", { p_dry_run: true }], ["provision_standard_lead_fields", { p_dry_run: false }]]);
    expect(screen.queryByRole("button", { name: /^Add/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Automatic setup didn't finish/)).not.toBeInTheDocument();
  });
});

describe("MakeAgencyWideDialog", () => {
  it("reviews the impact first, needs the exact name, then applies with the reviewed snapshot", async () => {
    rpc.mockResolvedValueOnce({ data: impact, error: null }).mockResolvedValueOnce({ data: { ...impact, applied: true }, error: null });
    const onDone = vi.fn(), onClose = vi.fn();
    render(<MakeAgencyWideDialog field={{ id: "f1", name: "Zip Code" }} currentUserId="u1" onClose={onClose} onDone={onDone} />);
    expect(await screen.findByText(/Today it belongs to Pat Owner/)).toBeInTheDocument();
    expect(screen.getByText(/12 leads already hold a value\. No lead data changes/)).toBeInTheDocument();
    expect(screen.getByText(/1 other personal field with this name stay/)).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Make agency-wide" });
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "zip code" } });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "Zip Code" } });
    fireEvent.click(apply);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(rpc.mock.calls).toEqual([
      ["custom_field_make_agency_wide", { p_field: "f1", p_snapshot: null, p_dry_run: true }],
      ["custom_field_make_agency_wide", { p_field: "f1", p_snapshot: "s".repeat(64), p_dry_run: false }],
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("a field changed after review is refused and the dialog stays open", async () => {
    rpc.mockResolvedValueOnce({ data: impact, error: null }).mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "field_changed" } });
    const onDone = vi.fn();
    render(<MakeAgencyWideDialog field={{ id: "f1", name: "Zip Code" }} currentUserId="u2" onClose={vi.fn()} onDone={onDone} />);
    expect(await screen.findByText(/Today it belongs to you/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: "Zip Code" } });
    fireEvent.click(screen.getByRole("button", { name: "Make agency-wide" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This field changed after you reviewed it. Review it again.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a refused review never offers the apply", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_permitted" } });
    render(<MakeAgencyWideDialog field={{ id: "f1", name: "Zip Code" }} currentUserId="u1" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an Admin can do this for your agency.");
    expect(screen.getByRole("button", { name: "Make agency-wide" })).toBeDisabled();
  });

  it("the confirmation schema matches the exact name (surrounding spaces ignored)", () => {
    expect(agencyWideConfirmSchema("Zip Code").safeParse({ confirm: " Zip Code " }).success).toBe(true);
    expect(agencyWideConfirmSchema("Zip Code").safeParse({ confirm: "ZIP Code" }).success).toBe(false);
  });
});
