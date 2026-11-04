import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ responses: [] as Array<unknown>, calls: [] as Array<Record<string, unknown>>, toasts: [] as Array<[string, unknown]> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (_name: string, args: Record<string, unknown>) => {
    h.calls.push(args); const next = h.responses.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? { data: null, error: { code: "XX000" } });
  } },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string, o?: unknown) => h.toasts.push([m, o]), success: vi.fn() } }));
import { LINK_FAILED_TOAST, LINK_RETRY_DELAYS_MS, onSaleSaved, registerClosingAppointmentSelection, resetAppointmentLinkRetry } from "@/lib/appointmentLinkRetry";

const SALE = "00000000-0000-4000-8000-0000000000s1".replace("s", "5");
const LINK = "00000000-0000-4000-8000-0000000000c1";
const APPT = "00000000-0000-4000-8000-0000000000a1";
const WIN = "00000000-0000-4000-8000-0000000000e1";
const linked = { data: { status: "linked", reason: null, attribution_id: LINK }, error: null };
let timers: Array<[() => void, number]>;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
beforeEach(() => { h.responses = []; h.calls = []; h.toasts = []; timers = []; resetAppointmentLinkRetry((fn, ms) => timers.push([fn as () => void, ms])); });
afterEach(() => resetAppointmentLinkRetry());

describe("closing-appointment link delivery (D-A3)", () => {
  it("does nothing when the sale had no registered selection", async () => {
    await onSaleSaved(SALE, [WIN]);
    expect(h.calls).toEqual([]);
  });
  it("sends one link per win with the selection's request id, independent of any component", async () => {
    registerClosingAppointmentSelection(SALE, { kind: "appointment", appointmentId: APPT, occurrenceStart: "2026-10-05T17:00:00Z" }, LINK);
    h.responses.push(linked);
    await onSaleSaved(SALE, [WIN]);
    expect(h.calls).toEqual([{ p_request_id: LINK, p_win_id: WIN, p_appointment_id: APPT, p_occurrence_start: "2026-10-05T17:00:00Z",
                              p_declaration: "appointment", p_source: "sale_entry" }]);
  });
  it("retries transport failures at 1 s, 4 s and 15 s, then shows one global toast whose Retry reuses the request ids", async () => {
    registerClosingAppointmentSelection(SALE, { kind: "none" }, LINK);
    h.responses.push(new Error("net"), new Error("net"), new Error("net"), new Error("net"));
    await onSaleSaved(SALE, [WIN]);
    for (const expected of LINK_RETRY_DELAYS_MS) { const [fn, ms] = timers.shift()!; expect(ms).toBe(expected); fn(); await flush(); }
    expect(h.calls).toHaveLength(4);
    expect(h.toasts.map(([m]) => m)).toEqual([LINK_FAILED_TOAST]);
    expect(LINK_FAILED_TOAST).toBe("Sale saved. Closing appointment not linked — Retry");
    h.responses.push({ data: { status: "declared_none", reason: null, attribution_id: LINK }, error: null });
    (h.toasts[0][1] as { action: { onClick: () => void } }).action.onClick();
    await flush();
    expect(h.calls).toHaveLength(5);
    expect(new Set(h.calls.map((c) => c.p_request_id))).toEqual(new Set([LINK]));
  });
  it("a business rejection is not retried and names its reason", async () => {
    registerClosingAppointmentSelection(SALE, { kind: "appointment", appointmentId: APPT, occurrenceStart: "x" }, LINK);
    h.responses.push({ data: { status: "rejected", reason: "not_held", attribution_id: null }, error: null });
    await onSaleSaved(SALE, [WIN]);
    expect(timers).toEqual([]);
    expect(h.toasts.map(([m]) => m)).toEqual(["Sale saved. The closing appointment wasn't linked: the appointment is not marked held."]);
  });
  it("'Not recorded' unregisters the selection", async () => {
    registerClosingAppointmentSelection(SALE, { kind: "none" }, LINK);
    registerClosingAppointmentSelection(SALE, { kind: "not_recorded" }, LINK);
    await onSaleSaved(SALE, [WIN]);
    expect(h.calls).toEqual([]);
  });
});
