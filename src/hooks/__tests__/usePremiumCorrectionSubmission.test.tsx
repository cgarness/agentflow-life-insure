import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  responses: [] as Array<{ data?: unknown; error?: unknown; throws?: boolean }>,
  calls: [] as Array<[string, unknown]>,
  toasts: [] as string[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      h.calls.push([name, args]);
      const next = h.responses.shift() ?? { error: { code: "XX000" } };
      return next.throws ? Promise.reject(new Error("network")) : Promise.resolve({ data: next.data ?? null, error: next.error ?? null });
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.toasts.push(m), error: (m: string) => h.toasts.push(`error:${m}`) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000a1" } }) }));

import { CORRECTION_SAVED_TOAST, usePremiumCorrectionSubmission } from "@/hooks/usePremiumCorrectionSubmission";
import type { CorrectionArgs } from "@/lib/policySaleCorrection";

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const args: CorrectionArgs = Object.freeze({
  p_request_id: "00000000-0000-4000-8000-0000000000f1", p_policy_id: "00000000-0000-4000-8000-0000000000d1",
  p_expected_revision: 0, p_expected_effective_monthly: 100, p_expected_book_amount: 100, p_corrected_monthly: 120,
  p_reason_code: "entry_error", p_note: "Entered wrong at sale", p_book_mode: "match_sale",
});
const result = {
  policy_id: args.p_policy_id, win_id: "00000000-0000-4000-8000-0000000000e1", request_id: args.p_request_id, revision: 1,
  previous_effective_monthly: 100, corrected_monthly: 120, effective_annual: 1440, book_action: "updated", freeze: false,
  sold_date: "2026-03-10", seller_id: "00000000-0000-4000-8000-0000000000a2", corrected_at: "2026-11-04T10:00:00Z", idempotent: false,
};
let client: QueryClient;
let invalidated: unknown[][];
function setup(onSaved?: (r: unknown) => void) {
  client = new QueryClient();
  invalidated = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters: { queryKey: unknown[] }) => { invalidated.push(filters.queryKey); return original(filters); }) as typeof client.invalidateQueries;
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => usePremiumCorrectionSubmission(CLIENT, onSaved), { wrapper });
}
beforeEach(() => { h.responses = []; h.calls = []; h.toasts = []; });
afterEach(cleanup);

describe("usePremiumCorrectionSubmission (D2 §5, §6.4)", () => {
  it("success: shows the RL-16 toast and invalidates exactly the two keys", async () => {
    const saved = vi.fn();
    h.responses.push({ data: result });
    const { result: hook } = setup(saved);
    await act(async () => { await hook.current.submit(args); });
    expect(hook.current.phase).toBe("saved");
    expect(h.toasts).toEqual(["Sale premium corrected. Performance totals show the new amount on their next refresh."]);
    expect(CORRECTION_SAVED_TOAST).toBe(h.toasts[0]);
    expect(invalidated).toEqual([["policy-sale-premiums", CLIENT], ["policy-commissions"]]);
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ book_action: "updated", revision: 1 }));
    expect(h.calls).toEqual([["correct_policy_sale_premium", args]]);
  });

  it("an unknown outcome freezes; Retry resends the identical call under the same request id", async () => {
    h.responses.push({ throws: true }, { data: { ...result, idempotent: true } });
    const { result: hook } = setup();
    await act(async () => { await hook.current.submit(args); });
    expect(hook.current.phase).toBe("frozen");
    expect(hook.current.message).toBe("We couldn't confirm the correction. Retry sends exactly the same correction.");
    expect(await act(async () => hook.current.submit({ ...args, p_corrected_monthly: 130 }))).toBeNull();  // refused while frozen
    await act(async () => { await hook.current.retry(); });
    expect(hook.current.phase).toBe("saved");
    expect(h.calls).toHaveLength(2);
    expect(JSON.stringify(h.calls[1][1])).toBe(JSON.stringify(h.calls[0][1]));
    expect(h.calls[1][1]).toBe(args);
  });

  it("a stale sale or record is 'stale' and re-reads the premiums; a reused request id is 'conflict'", async () => {
    h.responses.push({ error: { code: "PT409", details: "policy_changed" } }, { error: { code: "PT409", details: "request_conflict" } });
    const { result: hook } = setup();
    await act(async () => { await hook.current.submit(args); });
    expect([hook.current.phase, hook.current.message]).toEqual(["stale", "The policy record changed since you opened it. Reload and try again."]);
    expect(invalidated).toEqual([["policy-sale-premiums", CLIENT]]);
    await act(async () => { await hook.current.submit(args); });
    expect(hook.current.phase).toBe("conflict");
    expect(h.toasts).toEqual([]);
  });

  it("a refusal that proves nothing was saved returns to editing with its message", async () => {
    h.responses.push({ error: { code: "42501" } });
    const { result: hook } = setup();
    await act(async () => { await hook.current.submit(args); });
    expect([hook.current.phase, hook.current.message]).toEqual(["editing", "Only an Admin can correct a sale premium."]);
  });

  it("drops a response that arrives after a reset (generation guard)", async () => {
    let resolve!: (v: unknown) => void;
    h.responses = [];
    const { result: hook } = setup();
    const pending = new Promise((r) => { resolve = r; });
    const mod = await import("@/integrations/supabase/client");
    const rpc = vi.spyOn(mod.supabase as { rpc: (...a: unknown[]) => unknown }, "rpc").mockReturnValueOnce(pending);
    let sent!: Promise<unknown>;
    act(() => { sent = hook.current.submit(args) as Promise<unknown>; });
    act(() => hook.current.reset());
    await act(async () => { resolve({ data: result, error: null }); await sent; });
    expect(hook.current.phase).toBe("editing");
    expect(h.toasts).toEqual([]);
    rpc.mockRestore();
  });
});
