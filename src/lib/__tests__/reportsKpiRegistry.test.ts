import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRIP_KPIS, HIGHLIGHT_KPIS, KPI_REGISTRY, PRODUCTION_KPIS, sqlFields } from "@/lib/reports-kpi-registry";
import { READER_KPI_IDS, REPORT_V3_KPI_IDS } from "@/lib/reports-v3-schemas";

const foundation = readFileSync("supabase/migrations/20261101000010_reports_v3_foundation.sql", "utf8");
const sqlRegistry = JSON.parse(foundation.match(/\$registry\$([\s\S]*?)\$registry\$/)![1]);

describe("KPI registry", () => {
  it("equals private.report_v3_metric_registry() field for field", () => {
    expect(KPI_REGISTRY.map(sqlFields)).toEqual(sqlRegistry);
  });
  it("holds exactly the 23 selected KPIs", () => {
    expect(KPI_REGISTRY.map(k => k.id)).toEqual([...REPORT_V3_KPI_IDS]);
    expect(new Set(Object.values(READER_KPI_IDS).flat()).size).toBe(23);
  });
  it("pins the percent-unit and 30-day sets", () => {
    expect(KPI_REGISTRY.filter(k => k.unit === "percent").map(k => k.id)).toEqual([8, 17, 18, 19, 38]);
    expect(KPI_REGISTRY.filter(k => k.cohort_30d).map(k => k.id)).toEqual([12, 18, 19]);
    expect(KPI_REGISTRY.filter(k => k.label.endsWith("rate")).map(k => k.id)).toEqual([8, 17, 18, 19]);
  });
  it("renders each KPI exactly once: 4 production + 4 highlights + strip + More = 23", () => {
    expect(KPI_REGISTRY.filter(k => k.placement === "production").map(k => k.id)).toEqual([...PRODUCTION_KPIS]);
    expect(KPI_REGISTRY.filter(k => k.placement === "highlight").map(k => k.id)).toEqual([...HIGHLIGHT_KPIS]);
    expect(KPI_REGISTRY.filter(k => k.placement === "strip").map(k => k.id)).toEqual([...DEFAULT_STRIP_KPIS]);
    expect(KPI_REGISTRY.filter(k => k.placement === "more")).toHaveLength(10);
    expect(KPI_REGISTRY.every(k => !/conversion rate/i.test(k.label))).toBe(true);
  });
});
