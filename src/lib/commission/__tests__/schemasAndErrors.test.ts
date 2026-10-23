import { describe, expect, it } from "vitest";
import { toCommissionError } from "../errors";
import { parseCalculatorContext, parseCalculatorStatus, validateCalculatorForm, type CalculatorFormValues } from "../schemas";

const gridId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000101";
const variantId = "00000000-0000-4000-8000-000000000201";

const readyPayload = {
  status: "ready",
  commission_level: "120%",
  grid: { id: gridId, name: "Synthetic Test Grid", effective_date: "2025-03-01", contract_levels: [120, 100], revision: 2 },
  products: [{ id: productId, category: "whole_life", carrier: "Synthetic Carrier North", product_name: "North Final Plan" }],
  variants: [{ id: variantId, product_id: productId, label: "", min_age: null, max_age: 85, term_years: null }],
  rates: [
    { variant_id: variantId, contract_level: 120, rate_percent: "87.50" },
    { variant_id: variantId, contract_level: 100, rate_percent: "0" },
  ],
};

describe("server payload validation", () => {
  it("maps the status payload", () => {
    expect(parseCalculatorStatus({ status: "not_configured" })).toEqual({ status: "not_configured" });
    expect(parseCalculatorStatus({ status: "ready", grid_id: gridId, revision: 4 })).toEqual({ status: "ready", gridId, revision: 4 });
    expect(() => parseCalculatorStatus({ status: "maybe" })).toThrow();
  });
  it("maps the context payload and keeps rate text and the raw level exactly", () => {
    const ctx = parseCalculatorContext(readyPayload);
    expect(ctx.status).toBe("ready");
    if (ctx.status !== "ready") return;
    expect(ctx.commissionLevel).toBe("120%");
    expect(ctx.rates.map((r) => r.ratePercent)).toEqual(["87.50", "0"]);
    expect(ctx.variants[0]).toEqual({ id: variantId, productId, label: "", minAge: null, maxAge: 85, termYears: null });
  });
  it.each([
    ["a rate with three decimals", { rates: [{ variant_id: variantId, contract_level: 120, rate_percent: "87.555" }] }],
    ["a rate above 300", { rates: [{ variant_id: variantId, contract_level: 120, rate_percent: "300.01" }] }],
    ["a numeric (float) rate", { rates: [{ variant_id: variantId, contract_level: 120, rate_percent: 87.5 }] }],
    ["an empty term list", { variants: [{ ...readyPayload.variants[0], term_years: [] }] }],
    ["an unknown category", { products: [{ ...readyPayload.products[0], category: "annuity" }] }],
  ])("rejects %s instead of guessing", (_, patch) => {
    expect(() => parseCalculatorContext({ ...readyPayload, ...patch })).toThrow();
  });
});

describe("calculator form validation", () => {
  const base: CalculatorFormValues = { category: "whole_life", carrier: "Synthetic Carrier North", productId, age: "0", monthlyPremium: "125.50", term: "" };

  it("keeps the Calculator age-required by default, and permits explicit age independence only", () => {
    const blank = { ...base, age: "" };
    expect(validateCalculatorForm(blank, []).ok).toBe(false);
    expect(validateCalculatorForm(blank, [], true)).toEqual({ ok: true, productId, age: null, term: null, monthlyPremium: "125.50" });
    expect(validateCalculatorForm({ ...base, age: "101" }, [], true).ok).toBe(false);
  });

  it("accepts age 0 and a premium with cents", () => {
    expect(validateCalculatorForm(base, [])).toEqual({ ok: true, productId, age: 0, term: null, monthlyPremium: "125.50" });
  });
  it.each([
    [{ age: "" }, "age", "Enter the client's age."],
    [{ age: "101" }, "age", "Enter a whole-number age from 0 to 100."],
    [{ age: "45.5" }, "age", "Enter a whole-number age from 0 to 100."],
    [{ age: "-1" }, "age", "Enter a whole-number age from 0 to 100."],
    [{ monthlyPremium: "" }, "monthlyPremium", "Enter the monthly premium."],
    [{ monthlyPremium: "0" }, "monthlyPremium", "Monthly premium must be greater than $0."],
    [{ monthlyPremium: "0.00" }, "monthlyPremium", "Monthly premium must be greater than $0."],
    [{ monthlyPremium: "1e3" }, "monthlyPremium", "Enter the monthly premium as a number, like 125 or 125.50."],
    [{ monthlyPremium: "12.345" }, "monthlyPremium", "Enter the monthly premium as a number, like 125 or 125.50."],
    [{ monthlyPremium: "Infinity" }, "monthlyPremium", "Enter the monthly premium as a number, like 125 or 125.50."],
    [{ productId: "" }, "productId", "Choose a product."],
    [{ carrier: "" }, "carrier", "Choose a carrier."],
    [{ category: "" }, "category", "Choose a policy type."],
  ])("rejects %j", (patch, field, message) => {
    const result = validateCalculatorForm({ ...base, ...patch }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field as keyof CalculatorFormValues]).toBe(message);
  });
  it("requires a supported term length only when the product uses term lengths", () => {
    expect(validateCalculatorForm({ ...base, term: "" }, [10, 20]).ok).toBe(false);
    expect(validateCalculatorForm({ ...base, term: "15" }, [10, 20]).ok).toBe(false);
    expect(validateCalculatorForm({ ...base, term: "20" }, [10, 20])).toMatchObject({ ok: true, term: 20 });
    expect(validateCalculatorForm({ ...base, term: "20" }, [])).toMatchObject({ ok: true, term: null });
  });
});

describe("error mapping", () => {
  it("shows our own server sentences and hides PostgreSQL wording", () => {
    expect(toCommissionError({ code: "PT409", message: "This grid was changed by someone else. Reload to see the latest version." }))
      .toMatchObject({ kind: "conflict", message: "This grid was changed by someone else. Reload to see the latest version." });
    expect(toCommissionError({ code: "42501", message: "permission denied for function comp_enable_shared_grid" }))
      .toMatchObject({ kind: "forbidden", message: "You don't have permission to do that." });
    expect(toCommissionError({ code: "PT404", message: "That grid is not available" })).toMatchObject({ kind: "not_found", message: "That grid is not available" });
    expect(toCommissionError({ code: "23P01", message: "Two variants of this product would match the same age and term" }))
      .toMatchObject({ kind: "validation", message: "Two variants of this product would match the same age and term" });
  });
  it("maps constraint names to plain language", () => {
    expect(toCommissionError({ code: "23514", message: 'new row for relation "comp_rates" violates check constraint "comp_rates_rate_valid"' }))
      .toMatchObject({ kind: "validation", message: "Rates must be between 0 and 300 with at most two decimal places." });
    expect(toCommissionError({ code: "23505", message: 'duplicate key value violates unique constraint "comp_products_identity"' }))
      .toMatchObject({ message: "That carrier already has a product with this name in this category." });
    expect(toCommissionError({ code: "23503", message: 'insert or update on table "x" violates foreign key constraint "y"' }))
      .toMatchObject({ kind: "validation", message: "Some values aren't valid. Check the highlighted fields." });
  });
  it("falls back to a generic message for anything unknown", () => {
    expect(toCommissionError({ code: "57014", message: "canceling statement due to statement timeout" }))
      .toMatchObject({ kind: "failed", message: "Something went wrong. Try again." });
    expect(toCommissionError(null)).toMatchObject({ kind: "failed" });
  });
});
