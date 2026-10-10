import { useCallback, useSyncExternalStore } from "react";

/**
 * True while the viewport is at least `px` wide. Mounts exactly one layout (no CSS-hidden
 * duplicate tree). Server rendering and environments without matchMedia report false.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      mql.addListener?.(onChange);
      return () => mql.removeListener?.(onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
