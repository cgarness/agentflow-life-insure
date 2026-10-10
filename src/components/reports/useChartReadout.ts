import { useCallback, useState } from "react";

/** What recharts passes to onMouseMove, for the pointer and, with accessibilityLayer, for the arrow keys. */
interface ChartPointerState {
  activeTooltipIndex?: number;
}

/**
 * The spoken readout of a focusable trend panel. recharts' arrow-key readout is a visual tooltip only, so a
 * screen reader would hear the chart's name and never a value; the panel also renders the active period's
 * values as text in a polite live region (TrendPanel `readout`). Returns the chart handlers and that text
 * ("" while no period is active).
 */
export function useChartReadout<T>(rows: readonly T[], describe: (row: T) => string) {
  const [index, setIndex] = useState<number | null>(null);
  const onMouseMove = useCallback((state: ChartPointerState | null) => {
    setIndex(typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null);
  }, []);
  const onMouseLeave = useCallback(() => setIndex(null), []);
  const row = index === null ? undefined : rows[index];
  return { handlers: { onMouseMove, onMouseLeave }, readout: row === undefined ? "" : describe(row) };
}
