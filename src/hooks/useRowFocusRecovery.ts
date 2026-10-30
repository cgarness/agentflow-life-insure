import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps keyboard focus useful when a row leaves a list (plan §3.8).
 *
 * Call `remember(index)` when an action that may remove row `index` starts. When the rendered rows
 * change (`rowsKey`) and focus was lost to `<body>`, focus moves to the primary action
 * (`[data-row-focus]`) of the row now at that position, else the previous one, else the list's
 * fallback (`[data-list-focus-fallback]`), else the container. Focus the user moved elsewhere
 * (for example to the toast's Undo) is never taken away.
 */
export function useRowFocusRecovery<T extends HTMLElement = HTMLDivElement>(rowsKey: string) {
  const containerRef = useRef<T>(null);
  const pending = useRef<number | null>(null);

  const remember = useCallback((index: number) => {
    pending.current = index;
  }, []);

  useEffect(() => {
    const index = pending.current;
    const root = containerRef.current;
    if (index === null || !root) return;
    const active = document.activeElement;
    // Focus survived inside the list (the row stayed, e.g. the action failed): keep watching.
    if (active && active !== document.body && root.contains(active)) return;
    pending.current = null;
    // The user put focus somewhere else on purpose.
    if (active && active !== document.body) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-row-focus]"));
    const target =
      targets[Math.min(index, targets.length - 1)] ??
      root.querySelector<HTMLElement>("[data-list-focus-fallback]") ??
      root;
    if (target === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    target.focus();
  }, [rowsKey]);

  return { containerRef, remember };
}
