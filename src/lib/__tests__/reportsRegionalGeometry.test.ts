/**
 * Regional map geometry (D5 §5, §8): the generated module has the 51 jurisdictions, stays inside its viewBox and
 * size budget, carries the full ISC notice and the Census source, and is imported only by the lazy StateMap.
 */
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { US_STATE_GEOMETRY } from "@/components/reports/regional/usStatePaths";
import { US_STATE_CODES } from "@/lib/reports-regional";

const ROOT = join(__dirname, "..", "..", "..");
const MODULE = join(ROOT, "src/components/reports/regional/usStatePaths.ts");
const ISC = "Permission to use, copy, modify, and/or distribute this software for any purpose";
const sources = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return f === "__tests__" ? [] : sources(p);
  return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe("Regional map geometry", () => {
  it("has exactly the 51 jurisdictions of the state list, each a non-empty path", () => {
    expect(Object.keys(US_STATE_GEOMETRY.paths).sort()).toEqual([...US_STATE_CODES].sort());
    expect(US_STATE_CODES).toHaveLength(51);
    for (const d of Object.values(US_STATE_GEOMETRY.paths)) expect(d).toMatch(/^M[-\d]/);
  });
  it("keeps every absolute move inside the viewBox, Alaska and Hawaii included", () => {
    const [x0, y0, w, h] = US_STATE_GEOMETRY.viewBox.split(" ").map(Number);
    for (const [code, d] of Object.entries(US_STATE_GEOMETRY.paths)) {
      for (const m of d.matchAll(/M(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)) {
        const [x, y] = [Number(m[1]), Number(m[2])];
        expect(x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h, `${code} ${x},${y}`).toBe(true);
      }
    }
  });
  it("keeps the path data within D5's budget (at most 48,000 B raw and 11,000 B gzip); the whole module stays under 48,000 B", () => {
    const paths = Buffer.from(JSON.stringify(US_STATE_GEOMETRY.paths));
    expect(paths.length).toBeLessThanOrEqual(48_000);
    expect(gzipSync(paths).length).toBeLessThanOrEqual(11_000);
    expect(readFileSync(MODULE).length).toBeLessThanOrEqual(48_000);
  });
  it("carries the full ISC notice (preserved comment and exported fields) and the 2017 Census source", () => {
    const text = readFileSync(MODULE, "utf8");
    expect(text.startsWith("/*!")).toBe(true);
    expect(text).toContain(ISC);
    expect(US_STATE_GEOMETRY.license).toContain("Copyright 2013-2019 Michael Bostock");
    expect(US_STATE_GEOMETRY.license).toContain(ISC);
    expect(US_STATE_GEOMETRY.notice).toContain("us-atlas 3.0.1 (ISC licence)");
    expect(US_STATE_GEOMETRY.source).toContain("2017 edition");
    expect(readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain("us-atlas");
  });
  it("is imported only by StateMap, which Regional performance loads lazily", () => {
    const importers = sources(join(ROOT, "src")).filter(f => /from\s+["'][^"']*usStatePaths["']/.test(readFileSync(f, "utf8")));
    expect(importers.map(f => f.slice(ROOT.length + 1))).toEqual(["src/components/reports/regional/StateMap.tsx"]);
    const regional = readFileSync(join(ROOT, "src/components/reports/regional/RegionalPerformance.tsx"), "utf8");
    expect(regional).toContain('React.lazy(() => import("./StateMap"))');
    expect(regional).not.toMatch(/^import StateMap from/m);
  });
});
