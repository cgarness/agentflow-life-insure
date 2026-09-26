/**
 * Whether this tab may send requests right now: it is visible AND online.
 * Checked right before every leaderboard and Dashboard request is dispatched
 * (queued work included), so a hidden or offline tab sends nothing and loads
 * once it is visible and online again.
 */
export function isPageActive(): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

/**
 * Thrown by a load before a FOLLOW-ON read (one sent after an earlier read of the
 * same load returned) when the tab has gone hidden or offline meanwhile: the load
 * is deferred until the tab is visible and online again — not failed.
 */
export class PageInactiveError extends Error {
  constructor() {
    super("The page is hidden or offline");
    this.name = "PageInactiveError";
  }
}

/** Re-check before a follow-on read; throws PageInactiveError when hidden or offline. */
export function assertPageActive(): void {
  if (!isPageActive()) throw new PageInactiveError();
}

/** The browser reports it is offline. */
export function isPageOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Calls `listener` when visibility or connectivity changes; returns the unsubscribe. */
export function onPageActivityChange(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
