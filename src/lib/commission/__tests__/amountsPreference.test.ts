import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { amountsPreferenceKey, onAmountsHiddenChange, readAmountsHidden, writeAmountsHidden } from "../amountsPreference";

const A = amountsPreferenceKey("user-a", "org-1");
beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Hide amounts preference", () => {
  it("is one flag per user and organization in this browser, never a financial value", () => {
    expect(A).toBe("agentflow.commissions.hideAmounts.v1:user-a:org-1");
    expect(readAmountsHidden(A)).toBe(false);
    writeAmountsHidden(A, true);
    expect(window.localStorage.getItem(A)).toBe("1");
    expect(readAmountsHidden(A)).toBe(true);
    expect(readAmountsHidden(amountsPreferenceKey("user-b", "org-1"))).toBe(false);
    expect(readAmountsHidden(amountsPreferenceKey("user-a", "org-2"))).toBe(false);
    writeAmountsHidden(A, false);
    expect(window.localStorage.getItem(A)).toBeNull();
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it("without an identity nothing is read or written", () => {
    writeAmountsHidden(null, true);
    expect(window.localStorage.length).toBe(0);
    expect(readAmountsHidden(null)).toBe(false);
  });

  it("unavailable storage means shown, and never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readAmountsHidden(A)).toBe(false);
    expect(() => writeAmountsHidden(A, true)).not.toThrow();
  });

  it("follows another tab's change for the same identity only", () => {
    const seen: boolean[] = [];
    const stop = onAmountsHiddenChange(A, (hidden) => seen.push(hidden));
    window.localStorage.setItem(A, "1");
    window.dispatchEvent(new StorageEvent("storage", { key: A }));
    window.dispatchEvent(new StorageEvent("storage", { key: amountsPreferenceKey("user-b", "org-1") }));
    window.localStorage.removeItem(A);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key: A }));
    expect(seen).toEqual([true, false]);
  });
});
