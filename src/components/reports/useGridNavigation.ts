import { useCallback, useRef, useState } from "react";

/** Roving focus over a rows × cols grid with one tab stop (D6 §4.7): arrows, Home/End and PageUp/PageDown move;
 * Enter or Space pins the focused cell; Escape clears the pin. */
export function useGridNavigation(rows: number, cols: number) {
  const [focus, setFocus] = useState({ r: 0, c: 0 });
  const [pinned, setPinned] = useState<{ r: number; c: number } | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const move = useCallback((r: number, c: number) => {
    const next = { r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) };
    setFocus(next);
    cells.current.get(`${next.r}:${next.c}`)?.focus();
  }, [rows, cols]);
  const onKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(r, c + 1), ArrowLeft: () => move(r, c - 1), ArrowDown: () => move(r + 1, c), ArrowUp: () => move(r - 1, c),
      Home: () => move(r, 0), End: () => move(r, cols - 1), PageUp: () => move(0, c), PageDown: () => move(rows - 1, c),
      Enter: () => setPinned({ r, c }), " ": () => setPinned({ r, c }), Escape: () => setPinned(null),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  };
  const cellProps = (r: number, c: number) => ({
    role: "gridcell" as const,
    tabIndex: focus.r === r && focus.c === c ? 0 : -1,
    "aria-selected": pinned?.r === r && pinned?.c === c,
    ref: (el: HTMLElement | null) => { if (el) cells.current.set(`${r}:${c}`, el); else cells.current.delete(`${r}:${c}`); },
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, r, c),
    onFocus: () => setFocus({ r, c }),
    onClick: () => setPinned({ r, c }),
  });
  return { focus, pinned, cellProps };
}
