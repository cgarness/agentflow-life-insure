import { z } from "zod";
import type { CalculatorContext, CalculatorStatus } from "./types";

/** Server payload validation for the calculator reads (never trusted blindly) and the calculator form. */
export const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const categorySchema = z.enum(["term", "whole_life", "iul"]);
/** Exact stored rate text: 0-300 with at most two decimals (the database CHECK, mirrored). */
export const rateTextSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/)
  .refine((text) => Number(text) <= 300);
export const levelSchema = z.number().int().min(1).max(999);
const ageBound = z.number().int().min(0).max(100).nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const statusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("no_access") }),
  z.object({ status: z.literal("not_configured") }),
  z.object({ status: z.literal("ready"), grid_id: idSchema, revision: z.number().int().positive() }),
]);

const contextSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("no_access") }),
  z.object({ status: z.literal("not_configured") }),
  z.object({
    status: z.literal("ready"),
    commission_level: z.string().nullable(),
    grid: z.object({
      id: idSchema,
      name: z.string().min(1),
      effective_date: isoDate,
      contract_levels: z.array(levelSchema).min(1),
      revision: z.number().int().positive(),
    }),
    products: z.array(z.object({ id: idSchema, category: categorySchema, carrier: z.string(), product_name: z.string() })),
    variants: z.array(
      z.object({
        id: idSchema,
        product_id: idSchema,
        label: z.string(),
        min_age: ageBound,
        max_age: ageBound,
        term_years: z.array(z.number().int().min(1).max(100)).min(1).nullable(),
      }),
    ),
    rates: z.array(z.object({ variant_id: idSchema, contract_level: levelSchema, rate_percent: rateTextSchema })),
  }),
]);

export function parseCalculatorStatus(payload: unknown): CalculatorStatus {
  const parsed = statusSchema.parse(payload);
  return parsed.status === "ready"
    ? { status: "ready", gridId: parsed.grid_id, revision: parsed.revision }
    : { status: parsed.status };
}

export function parseCalculatorContext(payload: unknown): CalculatorContext {
  const parsed = contextSchema.parse(payload);
  if (parsed.status !== "ready") return { status: parsed.status };
  return {
    status: "ready",
    commissionLevel: parsed.commission_level,
    grid: {
      id: parsed.grid.id,
      name: parsed.grid.name,
      effectiveDate: parsed.grid.effective_date,
      contractLevels: parsed.grid.contract_levels,
      revision: parsed.grid.revision,
    },
    products: parsed.products.map((p) => ({ id: p.id, category: p.category, carrier: p.carrier, productName: p.product_name })),
    variants: parsed.variants.map((v) => ({
      id: v.id,
      productId: v.product_id,
      label: v.label,
      minAge: v.min_age,
      maxAge: v.max_age,
      termYears: v.term_years,
    })),
    rates: parsed.rates.map((r) => ({ variantId: r.variant_id, contractLevel: r.contract_level, ratePercent: r.rate_percent })),
  };
}

// ── Calculator form ────────────────────────────────────────────────────────────────────────────────
export const AGE_MESSAGE = "Enter a whole-number age from 0 to 100.";
export const PREMIUM_MESSAGE = "Enter the monthly premium as a number, like 125 or 125.50.";

export interface CalculatorFormValues {
  category: string;
  carrier: string;
  productId: string;
  age: string;
  monthlyPremium: string;
  term: string;
}

const formSchema = z
  .object({
    category: categorySchema.or(z.literal("")).refine((value) => value !== "", "Choose a policy type."),
    carrier: z.string().min(1, "Choose a carrier."),
    productId: z.string().min(1, "Choose a product."),
    age: z
      .string()
      .trim()
      .regex(/^\d{0,3}$/, AGE_MESSAGE)
      .refine((value) => value === "" || Number(value) <= 100, AGE_MESSAGE),
    monthlyPremium: z
      .string()
      .trim()
      .min(1, "Enter the monthly premium.")
      .regex(/^\d{1,9}(\.\d{1,2})?$/, PREMIUM_MESSAGE)
      .refine((value) => /[1-9]/.test(value), "Monthly premium must be greater than $0."),
    term: z.string(),
    supportedTerms: z.array(z.number()),
    ageOptional: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.ageOptional && value.age === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["age"], message: "Enter the client's age." });
    }
    if (value.supportedTerms.length > 0 && !value.supportedTerms.includes(Number(value.term))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["term"], message: "Choose a term length." });
    }
  });

export type CalculatorFormResult =
  | { ok: true; productId: string; age: number | null; term: number | null; monthlyPremium: string; errors?: undefined }
  | { ok: false; errors: Partial<Record<keyof CalculatorFormValues, string>> };

/** Validate the form against the chosen product's supported term lengths (empty = terms do not apply). */
export function validateCalculatorForm(values: CalculatorFormValues, supportedTerms: number[], ageOptional = false): CalculatorFormResult {
  const parsed = formSchema.safeParse({ ...values, supportedTerms, ageOptional });
  if (!parsed.success) {
    const errors: Partial<Record<keyof CalculatorFormValues, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof CalculatorFormValues;
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  return {
    ok: true,
    productId: parsed.data.productId,
    age: parsed.data.age === "" ? null : Number(parsed.data.age),
    term: supportedTerms.length > 0 ? Number(parsed.data.term) : null,
    monthlyPremium: parsed.data.monthlyPremium,
  };
}
