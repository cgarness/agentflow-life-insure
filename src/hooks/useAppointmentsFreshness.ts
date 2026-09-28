import { useEffect, useRef } from "react";

export const APPOINTMENTS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const APPOINTMENTS_REFOCUS_MIN_AGE_MS = 2 * 60 * 1000;

function pageIsActive(): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

/**
 * Bounded background refresh of the calendar list so personal reminders reach an assignee for
 * appointments someone else booked (`appointments` is not realtime-published).
 *
 * - every 5 minutes, only while the tab is visible and online (re-checked when the timer fires);
 * - on becoming visible again, only when the last refresh is older than 2 minutes;
 * - no retry loop; the refresh itself is silent and single-flight (CalendarContext).
 *
 * Mounted only by ReminderPopup, which AppLayout does not mount under "View As", so no query runs
 * while impersonating.
 */
export function useAppointmentsFreshness(refresh: () => void | Promise<void>, enabled: boolean = true): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let lastRefreshAt = Date.now();

    const run = () => {
      if (!pageIsActive()) return;
      lastRefreshAt = Date.now();
      void refreshRef.current();
    };

    const timer = window.setInterval(run, APPOINTMENTS_REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshAt < APPOINTMENTS_REFOCUS_MIN_AGE_MS) return;
      run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
