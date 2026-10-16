import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

type Navigator = { push: (...args: unknown[]) => void; replace: (...args: unknown[]) => void; go: (delta: number) => void };

/**
 * While `active`, holds every way of leaving an unsaved editor until the person confirms:
 *  - in-app navigation (sidebar links, settings-section changes, `navigate()`): the router navigator's
 *    push / replace / go are intercepted — the standard BrowserRouter blocker technique;
 *  - browser back / forward: a capture-phase `popstate` listener runs before the router's own listener,
 *    stops it, and returns the browser to the current entry (React Router keeps `idx` in history.state);
 *  - reload / close: `beforeunload` (the browser shows its own wording).
 * Nothing is persisted. `confirm()` performs the held navigation; `cancel()` stays.
 */
export function useUnsavedNavigationGuard(active: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (!active) return;
    const nav = navigator as unknown as Navigator;
    const original = { push: nav.push, replace: nav.replace, go: nav.go };
    const hold = (proceed: () => void) => setPending(() => proceed);
    nav.push = (...args) => (bypass.current ? original.push.apply(nav, args) : hold(() => original.push.apply(nav, args)));
    nav.replace = (...args) => (bypass.current ? original.replace.apply(nav, args) : hold(() => original.replace.apply(nav, args)));
    nav.go = (delta) => (bypass.current ? original.go.call(nav, delta) : hold(() => original.go.call(nav, delta)));

    let currentIdx: number | null = window.history.state?.idx ?? null;
    let reverting = false;
    const onPopState = (event: PopStateEvent) => {
      if (bypass.current) return;
      event.stopImmediatePropagation();
      if (reverting) {
        reverting = false;
        return;
      }
      const nextIdx: number | null = event.state?.idx ?? null;
      const delta = currentIdx !== null && nextIdx !== null ? nextIdx - currentIdx : -1;
      reverting = true;
      window.history.go(-delta);
      hold(() => {
        bypass.current = true;
        window.history.go(delta);
      });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("popstate", onPopState, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      Object.assign(nav, original);
      window.removeEventListener("popstate", onPopState, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      currentIdx = null;
    };
  }, [active, navigator]);

  useEffect(() => {
    if (!active) {
      bypass.current = false;
      setPending(null);
    }
  }, [active]);

  const confirm = useCallback(() => {
    const proceed = pending;
    setPending(null);
    bypass.current = true;
    proceed?.();
  }, [pending]);
  const cancel = useCallback(() => setPending(null), []);

  return { blocked: pending !== null, confirm, cancel };
}
