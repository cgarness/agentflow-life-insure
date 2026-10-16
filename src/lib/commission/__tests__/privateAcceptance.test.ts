import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateEstimate, resolveLevel } from "../calculator";
import { formatUsd } from "../money";
import type { CompCategory, ReadyCalculatorContext } from "../types";

/**
 * Source-backed acceptance (decision D4), PRIVATE and skipped unless COMMISSION_PRIVATE_DIR names the
 * private directory holding the import artifact (ffl.comp_reference_grid.json) and the expectations
 * (acceptance.json). Nothing private is in this file; it reports only each case's name. Real-data results
 * are kept apart from the synthetic CI results (C5). See reference-import-runbook.md §3.
 */
const privateDir = process.env.COMMISSION_PRIVATE_DIR;
const artifactPath = privateDir ? join(privateDir, "ffl.comp_reference_grid.json") : "";
const expectationsPath = privateDir ? join(privateDir, "acceptance.json") : "";
const available = Boolean(privateDir && existsSync(artifactPath) && existsSync(expectationsPath));

interface AcceptanceCase {
  name: string;
  category?: CompCategory;
  carrier: string;
  product: string;
  age?: number;
  term?: number;
  level: string;
  monthly_premium?: string;
  expect: { status: string; rate_percent?: string; total?: string; advance?: string; month?: string };
}

function contextFromArtifact(level: string): ReadyCalculatorContext {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return {
    status: "ready",
    commissionLevel: level,
    grid: {
      id: artifact.grid.id,
      name: artifact.grid.name,
      effectiveDate: artifact.grid.effective_date,
      contractLevels: artifact.grid.contract_levels,
      revision: 1,
    },
    products: artifact.products.map((p: Record<string, string>) => ({ id: p.id, category: p.category, carrier: p.carrier, productName: p.product_name })),
    variants: artifact.variants.map((v: Record<string, never>) => ({
      id: v.id, productId: v.product_id, label: v.label, minAge: v.min_age, maxAge: v.max_age, termYears: v.term_years,
    })),
    rates: artifact.rates.map((r: Record<string, never>) => ({ variantId: r.variant_id, contractLevel: r.contract_level, ratePercent: r.rate_percent })),
  };
}

describe.skipIf(!available)("private source-backed acceptance (COMMISSION_PRIVATE_DIR)", () => {
  const cases: AcceptanceCase[] = available ? JSON.parse(readFileSync(expectationsPath, "utf8")) : [];
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const context = contextFromArtifact(c.level);
    const level = resolveLevel(context);
    if (c.expect.status === "level_not_on_grid") {
      expect(level.kind).toBe("not_on_grid");
      return;
    }
    expect(level.kind).toBe("valid");
    if (level.kind !== "valid") return;
    const products = context.products.filter(
      (p) => p.carrier === c.carrier && p.productName === c.product && (!c.category || p.category === c.category),
    );
    expect(products).toHaveLength(1);
    const result = calculateEstimate(context, level.level, {
      productId: products[0].id,
      age: c.age ?? 0,
      term: c.term ?? null,
      monthlyPremium: c.monthly_premium ?? "100",
    });
    if (c.expect.status === "estimate") {
      expect(result.kind).toBe("estimate");
      if (result.kind !== "estimate") return;
      if (c.expect.rate_percent) expect(result.estimate.ratePercent).toBe(c.expect.rate_percent);
      if (c.expect.total) expect(formatUsd(result.estimate.firstYearCommission)).toBe(c.expect.total);
      if (c.expect.advance) expect(formatUsd(result.estimate.advance)).toBe(c.expect.advance);
      if (c.expect.month) expect(formatUsd(result.estimate.monthlyRemainder)).toBe(c.expect.month);
    } else {
      expect(result).toMatchObject({ kind: "unavailable" });
      if (result.kind === "unavailable") expect(result.message).toBe(c.expect.status);
    }
  });
});
