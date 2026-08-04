import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  QUICK_CALL_EVENT,
  dispatchQuickCall,
  hasDialablePhone,
  type QuickCallDetail,
} from "@/lib/quick-call";

/**
 * These tests pin the CANONICAL dialer contract.
 *
 * The Dashboard shipped an `agentflow:open-dialer` event that no listener anywhere
 * subscribes to, carrying a `contactName` field the real listener never reads and no
 * `type` at all. The assertions below are written against what `FloatingDialer.tsx`
 * actually consumes, so a future rename cannot silently break every call button again.
 */

let received: CustomEvent[] = [];
const capture = (e: Event) => received.push(e as CustomEvent);

beforeEach(() => {
  received = [];
  window.addEventListener(QUICK_CALL_EVENT, capture);
});

afterEach(() => {
  window.removeEventListener(QUICK_CALL_EVENT, capture);
  vi.restoreAllMocks();
});

const VALID: QuickCallDetail = {
  contactId: "11111111-1111-1111-1111-111111111111",
  name: "Pat Lee",
  phone: "5551112222",
  type: "lead",
};

describe("quick-call canonical contract", () => {
  it("uses the exact event name FloatingDialer listens for", () => {
    expect(QUICK_CALL_EVENT).toBe("quick-call");
  });

  it("emits exactly { contactId, name, phone, type } — the fields the listener reads", () => {
    expect(dispatchQuickCall(VALID)).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0].detail).toEqual({
      contactId: "11111111-1111-1111-1111-111111111111",
      name: "Pat Lee",
      phone: "5551112222",
      type: "lead",
    });
  });

  it("never emits a `contactName` key (the listener ignores it, losing the name)", () => {
    dispatchQuickCall(VALID);
    expect(Object.keys(received[0].detail)).not.toContain("contactName");
    expect(Object.keys(received[0].detail)).toContain("name");
  });

  it("preserves a client contact type instead of letting it default to lead", () => {
    dispatchQuickCall({ ...VALID, type: "client" });
    expect(received[0].detail.type).toBe("client");
  });

  it("preserves a recruit contact type", () => {
    dispatchQuickCall({ ...VALID, type: "recruit" });
    expect(received[0].detail.type).toBe("recruit");
  });

  it("includes fromNumber only when supplied", () => {
    dispatchQuickCall(VALID);
    expect("fromNumber" in received[0].detail).toBe(false);

    dispatchQuickCall({ ...VALID, fromNumber: "5559998888" });
    expect(received[1].detail.fromNumber).toBe("5559998888");
  });
});

describe("quick-call refuses to report a call it cannot start", () => {
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["no digits", "not-a-number"],
  ])("returns false and dispatches nothing for %s", (_label, phone) => {
    expect(dispatchQuickCall({ ...VALID, phone })).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("returns false for a null/undefined phone without throwing", () => {
    expect(dispatchQuickCall({ ...VALID, phone: null as unknown as string })).toBe(false);
    expect(dispatchQuickCall({ ...VALID, phone: undefined as unknown as string })).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("accepts a formatted number that contains digits", () => {
    expect(dispatchQuickCall({ ...VALID, phone: "+1 (555) 111-2222" })).toBe(true);
    expect(received[0].detail.phone).toBe("+1 (555) 111-2222");
  });
});

describe("hasDialablePhone", () => {
  it.each([
    ["5551112222", true],
    ["+1 (555) 111-2222", true],
    ["", false],
    ["   ", false],
    ["abc", false],
    [null, false],
    [undefined, false],
  ])("hasDialablePhone(%s) === %s", (input, expected) => {
    expect(hasDialablePhone(input as string | null | undefined)).toBe(expected);
  });
});
