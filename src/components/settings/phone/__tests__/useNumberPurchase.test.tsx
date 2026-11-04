// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNumberPurchase } from "../useNumberPurchase";
import { formatNumberPrice, getNumberPurchaseScope, monthlyNumberTotals, type AvailablePhoneNumber, type PurchaseScope } from "@/lib/phone-number-purchase";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
const scope: PurchaseScope = { actor_id: "00000000-0000-4000-8000-000000000001", organization_id: "00000000-0000-4000-8000-000000000002", view_as: false };
const otherScope = { ...scope, organization_id: "00000000-0000-4000-8000-000000000003" };
const quoteId = "00000000-0000-4000-8000-000000000004";
const rowId = "00000000-0000-4000-8000-000000000005";
const number: AvailablePhoneNumber = { phone_number: "+18005550123", number_type: "toll_free", country: "US", monthly_price: "2.15", currency: "USD", friendly_name: "Toll-free", locality: null, region: null, postal_code: null };
const local: AvailablePhoneNumber = { ...number, phone_number: "+12135550123", number_type: "local", locality: "Los Angeles", region: "CA" };
const reply = (data: object) => ({ data: { protocol_version: 1, ...data }, error: null });
const quoted = (overrides: object = {}) => reply({ quote: { id: quoteId, ...number, inbound_per_minute: "0.022", expires_at: new Date(Date.now() + 300_000).toISOString(), ...overrides } });
const operation = (state: string, overrides: object = {}) => reply({ operation: { id: quoteId, phone_number: number.phone_number, state, ...(state === "completed" ? { phone_number_id: rowId } : {}), ...overrides } });
const defer = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; };
const calls = (action: string) => invoke.mock.calls.filter(([, options]) => options.body.action === action);

function mount() {
  const onCompleted = vi.fn(async () => undefined);
  const hook = renderHook((props: { scope: PurchaseScope | null; open: boolean }) => useNumberPurchase({ ...props, onCompleted }), { initialProps: { scope, open: true } });
  return { ...hook, onCompleted };
}
async function review(hook: ReturnType<typeof mount>, selected = number) {
  act(() => hook.result.current.add(selected));
  await act(async () => { await hook.result.current.review(); });
}

beforeEach(() => {
  invoke.mockReset();
  sessionStorage.clear();
  let next = 10;
  vi.stubGlobal("crypto", { randomUUID: () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}` });
  invoke.mockImplementation(async (_name, { body }) => body.action === "quote" ? quoted() : body.action === "search" ? reply({ numbers: [number] }) : operation("completed"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("purchase scope", () => {
  const profile = { id: scope.actor_id, organization_id: scope.organization_id, role: "Admin", status: "Active" };
  it("uses the actual active Admin in the displayed home organization", () => {
    expect(getNumberPurchaseScope(scope.actor_id, profile, scope.organization_id, false)).toEqual(scope);
    expect(getNumberPurchaseScope(scope.actor_id, { ...profile, role: "Super Admin" }, scope.organization_id, false)).toEqual(scope);
  });
  it("refuses impersonation, wrong identity/organization, inactive and non-admin profiles", () => {
    expect(getNumberPurchaseScope(scope.actor_id, profile, scope.organization_id, true)).toBeNull();
    expect(getNumberPurchaseScope("other-user", profile, scope.organization_id, false)).toBeNull();
    expect(getNumberPurchaseScope(scope.actor_id, profile, otherScope.organization_id, false)).toBeNull();
    for (const role of ["Agent", "Team Leader"]) expect(getNumberPurchaseScope(scope.actor_id, { ...profile, role }, scope.organization_id, false)).toBeNull();
    expect(getNumberPurchaseScope(scope.actor_id, { ...profile, status: "Inactive" }, scope.organization_id, false)).toBeNull();
    expect(getNumberPurchaseScope(scope.actor_id, null, scope.organization_id, false)).toBeNull();
  });
});

describe("purchase requests and recovery", () => {
  it("quotes through search and sends only a reviewed quote and stable key to buy", async () => {
    const hook = mount();
    await review(hook);
    expect(calls("quote")[0]).toEqual(["twilio-search-numbers", { body: { ...scope, action: "quote", phone_number: number.phone_number, number_type: "toll_free" } }]);
    expect(calls("purchase")).toHaveLength(0);
    const requestId = hook.result.current.items[0].requestId;
    await act(async () => { await hook.result.current.confirm(); });
    expect(calls("purchase")[0]).toEqual(["twilio-buy-number", { body: { ...scope, action: "purchase", quote_id: quoteId, request_id: requestId } }]);
    expect(hook.result.current.items[0].operation?.state).toBe("completed");
    expect(hook.onCompleted).toHaveBeenCalledWith([number.phone_number], { failedCount: 0, pendingCount: 0 });
  });
  it("synchronously blocks double confirmation and closing while purchase is in flight", async () => {
    const paid = defer<ReturnType<typeof operation>>();
    invoke.mockImplementation((_name, { body }) => body.action === "quote" ? Promise.resolve(quoted()) : paid.promise);
    const hook = mount();
    await review(hook);
    let purchase!: Promise<void>;
    act(() => { purchase = hook.result.current.confirm(); void hook.result.current.confirm(); });
    expect(calls("purchase")).toHaveLength(1);
    expect(hook.result.current.close()).toBe(false);
    await act(async () => { paid.resolve(operation("completed")); await purchase; });
    expect(calls("purchase")).toHaveLength(1);
  });
  it("checks status after a lost response and never buys again on confirm, status or reopen", async () => {
    invoke.mockImplementation(async (_name, { body }) => {
      if (body.action === "quote") return quoted();
      if (body.action === "purchase") throw new TypeError("Network failure");
      return operation("purchased_pending_save");
    });
    const hook = mount();
    await review(hook);
    await act(async () => { await hook.result.current.confirm(); });
    expect(calls("purchase")).toHaveLength(1);
    expect(calls("status")).toHaveLength(1);
    const key = calls("purchase")[0][1].body.request_id;
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => { await hook.result.current.confirm(); await hook.result.current.checkStatus(); });
    hook.rerender({ scope, open: false });
    hook.rerender({ scope, open: true });
    expect(hook.result.current.items[0].requestId).toBe(key);
    await act(async () => { await hook.result.current.checkStatus(); });
    expect(calls("purchase")).toHaveLength(1);
    expect(calls("status").every(([, options]) => options.body.request_id === key && options.body.quote_id === quoteId && !("phone_number" in options.body))).toBe(true);
  });
  it("recovers a request timeout with status only", async () => {
    vi.useFakeTimers();
    invoke.mockImplementation((_name, { body }) => body.action === "quote" ? Promise.resolve(quoted()) : body.action === "purchase" ? new Promise(() => undefined) : Promise.resolve(operation("purchasing")));
    const hook = mount();
    await review(hook);
    await act(async () => {
      const paid = hook.result.current.confirm();
      await vi.advanceTimersByTimeAsync(30_001);
      await paid;
    });
    expect(calls("purchase")).toHaveLength(1);
    expect(calls("status")).toHaveLength(1);
    expect(hook.result.current.pending).toBe(true);
    expect(hook.result.current.canConfirm).toBe(false);
  });
  it("retains pending operation responses for read-only status, including after remount", async () => {
    invoke.mockImplementation(async (_name, { body }) => body.action === "quote" ? quoted() : operation(body.action === "purchase" ? "needs_review" : "completed"));
    const hook = mount();
    await review(hook);
    await act(async () => { await hook.result.current.confirm(); });
    const key = calls("purchase")[0][1].body.request_id;
    hook.unmount();
    const resumed = mount();
    expect(resumed.result.current.items[0].requestId).toBe(key);
    await act(async () => { await resumed.result.current.checkStatus(); });
    expect(calls("purchase")).toHaveLength(1);
    expect(resumed.result.current.items[0].operation?.state).toBe("completed");
  });
  it("stops a partially completed cart at uncertainty and keeps the remaining exact number", async () => {
    const second = { ...number, phone_number: "+18885550123" };
    invoke.mockImplementation(async (_name, { body }) => body.action === "quote"
      ? quoted({ phone_number: body.phone_number, id: body.phone_number === number.phone_number ? quoteId : rowId })
      : operation(body.quote_id === quoteId ? "completed" : "purchased_pending_save", { id: body.quote_id, phone_number: body.quote_id === quoteId ? number.phone_number : second.phone_number }));
    const hook = mount();
    act(() => { hook.result.current.add(number); hook.result.current.add(second); });
    await act(async () => { await hook.result.current.review(); await hook.result.current.confirm(); });
    expect(hook.result.current.items.map((item) => item.operation?.state)).toEqual(["completed", "purchased_pending_save"]);
    expect(hook.onCompleted).toHaveBeenCalledWith([number.phone_number], { failedCount: 0, pendingCount: 1 });
    await act(async () => { await hook.result.current.confirm(); });
    expect(calls("purchase")).toHaveLength(2);
  });
  it("requires a new price review and explicit confirmation after a server price change", async () => {
    let count = 0;
    invoke.mockImplementation(async (_name, { body }) => {
      if (body.action === "quote") return quoted({ monthly_price: ++count === 1 ? "2.15" : "2.25" });
      if (body.action === "purchase") return { data: null, error: { context: { json: async () => ({ protocol_version: 1, code: "PRICE_CHANGED", error: "The price changed. Review current prices." }) } } };
      return operation("failed_before_purchase", { error_code: "PRICE_CHANGED" });
    });
    const hook = mount();
    await review(hook);
    await act(async () => { await hook.result.current.confirm(); });
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => { await hook.result.current.review(); });
    expect(hook.result.current.items[0].quote?.monthly_price).toBe("2.25");
    expect(calls("purchase")).toHaveLength(1);
    expect(hook.result.current.canConfirm).toBe(true);
  });
  it("expires review prices on a timer and rechecks expiry before any paid request", async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue(quoted({ expires_at: new Date(Date.now() + 1_000).toISOString() }));
    const hook = mount();
    await review(hook);
    expect(hook.result.current.canConfirm).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_010); });
    expect(hook.result.current.canConfirm).toBe(false);
    await act(async () => { await hook.result.current.confirm(); });
    expect(calls("purchase")).toHaveLength(0);
  });
  it("does not start a paid request if its recovery key cannot be persisted", async () => {
    const hook = mount();
    await review(hook);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    await act(async () => { await hook.result.current.confirm(); });
    expect(calls("purchase")).toHaveLength(0);
    expect(hook.result.current.error).toContain("could not be started safely");
  });
});

describe("stale requests and version safety", () => {
  it.each(["type change", "close and reopen"])("discards a late search after %s", async (change) => {
    const late = defer<ReturnType<typeof reply>>();
    invoke.mockReturnValue(late.promise);
    const hook = mount();
    act(() => hook.result.current.setFilters({ areaCode: "213" }));
    let search!: Promise<void>;
    act(() => { search = hook.result.current.search(); });
    if (change === "type change") act(() => hook.result.current.setFilters({ numberType: "toll_free" }));
    else {
      act(() => { expect(hook.result.current.close()).toBe(true); });
      hook.rerender({ scope, open: false });
      hook.rerender({ scope, open: true });
    }
    await act(async () => { late.resolve(reply({ numbers: [local] })); await search; });
    expect(hook.result.current.numbers).toEqual([]);
    expect(hook.result.current.searched).toBe(false);
    expect(hook.result.current.busy).toBeNull();
  });
  it("does not restore an old quote or buy when identity changes during review", async () => {
    const late = defer<ReturnType<typeof quoted>>();
    invoke.mockReturnValue(late.promise);
    const hook = mount();
    act(() => hook.result.current.add(number));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.review(); });
    hook.rerender({ scope: otherScope, open: true });
    await act(async () => { late.resolve(quoted()); await pending; await hook.result.current.confirm(); });
    expect(hook.result.current.items).toEqual([]);
    expect(calls("purchase")).toHaveLength(0);
  });
  it("halts the paid queue on identity change and keeps recovery bound to its original scope", async () => {
    const late = defer<ReturnType<typeof operation>>();
    invoke.mockImplementation((_name, { body }) => body.action === "quote" ? Promise.resolve(quoted({ phone_number: body.phone_number })) : late.promise);
    const hook = mount();
    act(() => { hook.result.current.add(number); hook.result.current.add({ ...number, phone_number: "+18885550123" }); });
    await act(async () => { await hook.result.current.review(); });
    let paid!: Promise<void>;
    act(() => { paid = hook.result.current.confirm(); });
    hook.rerender({ scope: otherScope, open: true });
    await act(async () => { late.resolve(operation("completed")); await paid; });
    expect(calls("purchase")).toHaveLength(1);
    expect(hook.onCompleted).not.toHaveBeenCalled();
    expect(hook.result.current.items).toEqual([]);
    hook.rerender({ scope, open: true });
    expect(hook.result.current.items[0].quote?.id).toBe(quoteId);
  });
  it("rejects old or mismatched quote responses without a buy fallback", async () => {
    invoke.mockResolvedValue({ data: { numbers: [number] }, error: null });
    const hook = mount();
    await review(hook);
    expect(hook.result.current.blocked).toBe(true);
    expect(hook.result.current.canConfirm).toBe(false);
    expect(calls("purchase")).toHaveLength(0);
    expect(hook.result.current.items[0].error).toContain("Refresh");
  });
  it("fails closed on a malformed purchase response and never retries the payment", async () => {
    invoke.mockImplementation(async (_name, { body }) => body.action === "quote" ? quoted() : { data: { success: true }, error: null });
    const hook = mount();
    await review(hook);
    await act(async () => { await hook.result.current.confirm(); await hook.result.current.confirm(); });
    expect(hook.result.current.blocked).toBe(true);
    expect(hook.result.current.pending).toBe(true);
    expect(calls("purchase")).toHaveLength(1);
    expect(calls("purchase")[0][1].body).not.toHaveProperty("phone_number");
  });
  it("invalidates all work when access becomes unavailable", async () => {
    const hook = mount();
    await review(hook);
    hook.rerender({ scope: null, open: true });
    await act(async () => { await hook.result.current.confirm(); await hook.result.current.search(); });
    expect(hook.result.current.allowed).toBe(false);
    expect(hook.result.current.items).toEqual([]);
    expect(calls("purchase")).toHaveLength(0);
  });
  it("sums decimal rental amounts by currency without binary rounding", () => {
    expect(monthlyNumberTotals([{ monthly_price: "0.1", currency: "USD" }, { monthly_price: "0.2", currency: "USD" }, { monthly_price: "2.15", currency: "CAD" }]))
      .toEqual([{ currency: "USD", amount: "0.30000000" }, { currency: "CAD", amount: "2.15000000" }]);
    expect(formatNumberPrice("123456789.12345678", "USD")).toBe("USD 123,456,789.12345678");
    expect(formatNumberPrice("0.00850000", "USD")).toBe("USD 0.0085");
  });
});
