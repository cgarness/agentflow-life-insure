import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ response: null as unknown, calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (_n: string, a: Record<string, unknown>) => { h.calls.push(a); return Promise.resolve(h.response); } } }));
import { AppointmentOutcomePanel } from "../AppointmentOutcomePanel";

const ID = "00000000-0000-4000-8000-0000000000a1";
afterEach(cleanup);
describe("AppointmentOutcomePanel (D4 §4)", () => {
  it("renders only for a started open slot and records Held with one request id per open", async () => {
    const onRecorded = vi.fn();
    h.response = { data: null, error: { code: "55P03" } };
    render(<AppointmentOutcomePanel appointment={{ id: ID, status: "Scheduled", startTime: "2026-01-01T00:00:00Z" }} onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole("button", { name: "Held" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The outcome wasn't saved. Try again.");
    h.response = { data: { appointment_id: ID, request_id: ID, outcome: "held", status: "Completed", start_time: "2026-01-01T00:00:00Z" }, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Held" }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(h.calls[0].p_request_id).toBe(h.calls[1].p_request_id);
    expect(h.calls[1]).toMatchObject({ p_appointment_id: ID, p_expected_start: "2026-01-01T00:00:00Z", p_outcome: "held" });
  });
  it("renders nothing for a future or already resolved slot", () => {
    const a = render(<AppointmentOutcomePanel appointment={{ id: ID, status: "Scheduled", startTime: "2999-01-01T00:00:00Z" }} onRecorded={vi.fn()} />);
    expect(a.container).toBeEmptyDOMElement(); cleanup();
    const b = render(<AppointmentOutcomePanel appointment={{ id: ID, status: "Completed", startTime: "2026-01-01T00:00:00Z" }} onRecorded={vi.fn()} />);
    expect(b.container).toBeEmptyDOMElement();
  });
});
