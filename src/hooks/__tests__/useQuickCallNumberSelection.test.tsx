import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQuickCallNumberSelection } from "@/hooks/useQuickCallNumberSelection";
import type { QuickCallDetail } from "@/lib/quick-call";

type Scope = Parameters<typeof useQuickCallNumberSelection>[0];
const contact = { id: "contact-a", type: "lead" as const, phone: "+15551112222" };
const initial: Scope = { actorId: "actor-a", organizationId: "org-a", isImpersonating: false, contact, open: true };
const detail: QuickCallDetail = {
  contactId: contact.id, type: contact.type, phone: contact.phone, name: "Synthetic Contact",
  fromNumber: "+15559998888", expectedCallerNumber: "+15559998888",
};
afterEach(cleanup);

describe("contact-local quick-call number selection", () => {
  it("keeps an ordinary displayed caller separate from a one-call override", () => {
    const { result } = renderHook(() => useQuickCallNumberSelection(initial));
    act(() => { expect(result.current.capture(detail)).toBe(true); });
    expect(result.current.selection?.expectedCallerNumber).toBe(detail.expectedCallerNumber);
    const attempt = result.current.captureAttempt("(555) 111-2222", contact.id)!;
    expect(attempt.expectedCallerNumber).toBe(detail.expectedCallerNumber);
    expect(attempt.oneCallNumberId).toBeUndefined();
    expect(attempt.isAttemptCurrent()).toBe(true);
  });

  it("captures the explicit number ID and invalidates an older action on a new selection", () => {
    const { result } = renderHook(() => useQuickCallNumberSelection(initial));
    act(() => { result.current.capture({ ...detail, oneCallNumberId: "number-a" }); });
    const first = result.current.captureAttempt(contact.phone, contact.id)!;
    act(() => { result.current.capture({ ...detail, expectedCallerNumber: "+15556667777", oneCallNumberId: "number-b" }); });
    expect(first.expectedCallerNumber).toBe(detail.expectedCallerNumber);
    expect(first.oneCallNumberId).toBe("number-a");
    expect(first.isAttemptCurrent()).toBe(false);
    expect(result.current.captureAttempt(contact.phone, contact.id)?.oneCallNumberId).toBe("number-b");
  });

  it.each([
    ["actor", { ...initial, actorId: "actor-b" }],
    ["organization", { ...initial, organizationId: "org-b" }],
    ["contact", { ...initial, contact: { ...contact, id: "contact-b" } }],
    ["type", { ...initial, contact: { ...contact, type: "client" } }],
    ["phone", { ...initial, contact: { ...contact, phone: "+15553334444" } }],
    ["View As", { ...initial, isImpersonating: true }],
    ["closed panel", { ...initial, open: false }],
  ] as Array<[string, Scope]>)("discards selection on %s change and does not resurrect it on return", (_label, changed) => {
    const { result, rerender } = renderHook((scope: Scope) => useQuickCallNumberSelection(scope), { initialProps: initial });
    act(() => { result.current.capture(detail); });
    const attempt = result.current.captureAttempt(contact.phone, contact.id)!;
    rerender(changed);
    expect(result.current.selection).toBeNull();
    expect(attempt.isAttemptCurrent()).toBe(false);
    rerender(initial);
    expect(result.current.selection).toBeNull();
    expect(attempt.isAttemptCurrent()).toBe(false);
  });

  it("refuses an originating visit or choice that expired without making a global fallback", () => {
    let ownsVisit = true;
    const { result } = renderHook(() => useQuickCallNumberSelection(initial));
    act(() => { result.current.capture({ ...detail, isSelectionCurrent: () => ownsVisit }); });
    const attempt = result.current.captureAttempt(contact.phone, contact.id)!;
    ownsVisit = false;
    expect(attempt.isAttemptCurrent()).toBe(false);
    expect(result.current.selection?.expectedCallerNumber).toBe(detail.expectedCallerNumber);
    expect(result.current.captureAttempt(contact.phone, contact.id)?.isAttemptCurrent()).toBe(false);
  });

  it("invalidates captured work on unmount and explicit clear", () => {
    const { result, unmount } = renderHook(() => useQuickCallNumberSelection(initial));
    act(() => { result.current.capture(detail); });
    const first = result.current.captureAttempt(contact.phone, contact.id)!;
    act(() => result.current.clear());
    expect(first.isAttemptCurrent()).toBe(false);
    act(() => { result.current.capture(detail); });
    const second = result.current.captureAttempt(contact.phone, contact.id)!;
    unmount();
    expect(second.isAttemptCurrent()).toBe(false);
  });

  it("refuses a different destination and rejects incomplete or impersonated capture", () => {
    const { result, rerender } = renderHook((scope: Scope) => useQuickCallNumberSelection(scope), { initialProps: initial });
    act(() => { result.current.capture(detail); });
    expect(result.current.captureAttempt("+15553334444", contact.id)).toBeNull();
    expect(result.current.captureAttempt(contact.phone, "contact-b")).toBeNull();
    act(() => { expect(result.current.capture({ ...detail, expectedCallerNumber: "" })).toBe(false); });
    expect(result.current.selection).toBeNull();
    rerender({ ...initial, isImpersonating: true });
    act(() => { expect(result.current.capture(detail)).toBe(false); });
    expect(result.current.selection).toBeNull();
  });

  it("never invokes an origin callback while merely selecting a number", () => {
    const isSelectionCurrent = vi.fn(() => true);
    const { result } = renderHook(() => useQuickCallNumberSelection(initial));
    act(() => { result.current.capture({ ...detail, isSelectionCurrent }); });
    expect(isSelectionCurrent).not.toHaveBeenCalled();
  });
});
