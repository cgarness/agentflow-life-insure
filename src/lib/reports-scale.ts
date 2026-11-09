// The single report scale (D6 §4.7, D5 §4): five levels plus "no activity", token classes only.
export const SCALE_BG = ["bg-report-scale-1", "bg-report-scale-2", "bg-report-scale-3", "bg-report-scale-4", "bg-report-scale-5"] as const;
export const SCALE_TEXT = ["text-report-scale-1-foreground", "text-report-scale-2-foreground", "text-report-scale-3-foreground",
  "text-report-scale-4-foreground", "text-report-scale-5-foreground"] as const;
export const SCALE_FILL = ["fill-report-scale-1", "fill-report-scale-2", "fill-report-scale-3", "fill-report-scale-4", "fill-report-scale-5"] as const;
export const NO_ACTIVITY_FILL = "fill-muted";

/** Level 0–4 for a positive value against the maximum; null for zero or no value (drawn as "no activity"). */
export function bucketLevel(value: number | null, max: number): number | null {
  if (value === null || value <= 0 || max <= 0) return null;
  return Math.min(4, Math.floor((value / max) * 5 - 1e-9));
}

/** Quintile-like breaks of the positive values, so the legend shows unit-labelled ranges. */
export function buildStateScale(values: (number | null)[]) {
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  const breaks = Array.from({ length: 5 }, (_, i) => [Math.floor((max * i) / 5) + (i === 0 ? 1 : 0), Math.floor((max * (i + 1)) / 5)] as const);
  return { max, breaks, levelOf: (v: number | null) => bucketLevel(v, max) };
}
