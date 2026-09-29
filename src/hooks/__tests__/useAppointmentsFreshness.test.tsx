/**
 * useAppointmentsFreshness — the bounded background refresh that lets an assignee's ReminderPopup
 * learn of appointments someone else booked for them (`appointments` is not realtime-published).
 *
 * Contract (implementation plan §5.3, D-3 option C):
 *   - every 5 minutes, only while the tab is visible AND online — re-checked each time the timer fires;
 *   - on `visibilitychange` → visible, only when the last refresh is more than 2 minutes old;
 *   - disabled (no signed-in user) → never refreshes;
 *   - unmount clears the interval and the listener; there is no retry loop.
 *
 * The hook imports only React, so this file is provably free of the Supabase client import graph.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPOINTMENTS_REFOCUS_MIN_AGE_MS,
  APPOINTMENTS_REFRESH_INTERVAL_MS,
  useAppointmentsFreshness,
} from "@/hooks/useAppointmentsFreshness";

const MIN = 60 * 1000;

const env = { visibility: "visible" as "visible" | "hidden", online: true };

/** Sets the page visibility; `dispatch` fires the `visibilitychange` event the hook listens to. */
const setVisibility = (state: "visible" | "hidden", dispatch = true) => {
  env.visibility = state;
  if (dispatch) document.dispatchEvent(new Event("visibilitychange"));
};
const setOnline = (online: boolean) => {
  env.online = online;
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T21:00:00.000Z"));
  env.visibility = "visible";
  env.online = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => env.visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => env.online });
});

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useAppointmentsFreshness — constants", () => {
  it("refreshes every 5 minutes and re-checks on focus only after 2 minutes", () => {
    expect(APPOINTMENTS_REFRESH_INTERVAL_MS).toBe(5 * MIN);
    expect(APPOINTMENTS_REFOCUS_MIN_AGE_MS).toBe(2 * MIN);
  });
});

describe("useAppointmentsFreshness — 5-minute interval", () => {
  it("does not refresh on mount; refreshes once per 5 minutes while visible and online", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    expect(refresh).not.toHaveBeenCalled();
    await advance(5 * MIN - 1);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(2);
    await advance(10 * MIN);
    expect(refresh).toHaveBeenCalledTimes(4);
    // The hook passes nothing itself; ReminderPopup's callback supplies `{ silent: true }`.
    expect(refresh).toHaveBeenLastCalledWith();
  });

  it("skips every tick while the tab is hidden, and resumes on the next tick once visible again", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    setVisibility("hidden");
    await advance(30 * MIN);
    expect(refresh).not.toHaveBeenCalled();

    // Visibility is re-checked when the timer fires — no event needed.
    setVisibility("visible", false);
    await advance(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips every tick while offline, and resumes on the next tick once online again", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    setOnline(false);
    await advance(15 * MIN);
    expect(refresh).not.toHaveBeenCalled();

    setOnline(true);
    await advance(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("has no retry loop: a failed refresh is not re-invoked before the next 5-minute tick", async () => {
    const refresh = vi.fn(() => {
      const failed = Promise.reject(new Error("network down"));
      failed.catch(() => {}); // the real caller (CalendarContext) never rejects; keep this one handled
      return failed;
    });
    renderHook(() => useAppointmentsFreshness(refresh, true));
    await advance(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(5 * MIN - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("always calls the LATEST refresh callback (no stale closure across re-renders)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAppointmentsFreshness(cb, true), {
      initialProps: { cb: first as () => void },
    });
    rerender({ cb: second });
    await advance(5 * MIN);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("useAppointmentsFreshness — becoming visible", () => {
  it("does NOT refresh when the tab returns within 2 minutes of mount", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    await advance(1 * MIN);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();

    await advance(1 * MIN - 1); // still under 2 minutes since mount
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes immediately when the tab returns more than 2 minutes after the last refresh — and not again right after", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    setVisibility("hidden");
    await advance(3 * MIN);
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);

    // The focus refresh counts as the last refresh: a quick hide/show does not repeat it.
    await advance(30 * 1000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("measures the 2-minute age from the last INTERVAL refresh too", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    await advance(5 * MIN); // interval refresh at t = 5 min
    expect(refresh).toHaveBeenCalledTimes(1);

    await advance(1 * MIN); // t = 6 min, 1 minute after the last refresh
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);

    await advance(1 * MIN + 1); // t = 7 min + 1 ms, > 2 minutes after the last refresh
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a visibilitychange to HIDDEN never refreshes", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    await advance(4 * MIN);
    setVisibility("hidden");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("becoming visible while offline does not refresh", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, true));

    setVisibility("hidden");
    await advance(3 * MIN);
    setOnline(false);
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("useAppointmentsFreshness — disabled and unmount", () => {
  it("enabled = false never refreshes: no timer, no focus refresh", async () => {
    const refresh = vi.fn();
    renderHook(() => useAppointmentsFreshness(refresh, false));

    expect(vi.getTimerCount()).toBe(0);
    await advance(30 * MIN);
    setVisibility("hidden");
    setVisibility("visible");
    await advance(30 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("starts when enabled flips to true, and stops again when it flips back to false", async () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ on }) => useAppointmentsFreshness(refresh, on), {
      initialProps: { on: false },
    });
    await advance(10 * MIN);
    expect(refresh).not.toHaveBeenCalled();

    rerender({ on: true });
    await advance(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ on: false });
    expect(vi.getTimerCount()).toBe(0);
    await advance(20 * MIN);
    setVisibility("hidden");
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("unmount clears the interval and the visibilitychange listener", async () => {
    const refresh = vi.fn();
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    try {
      const { unmount } = renderHook(() => useAppointmentsFreshness(refresh, true));
      expect(vi.getTimerCount()).toBe(1);
      const added = addSpy.mock.calls.find(([type]) => type === "visibilitychange");
      expect(added).toBeDefined();

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(removeSpy.mock.calls.some(([type, fn]) => type === "visibilitychange" && fn === added![1])).toBe(true);

      await advance(30 * MIN);
      setVisibility("hidden");
      setVisibility("visible");
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
