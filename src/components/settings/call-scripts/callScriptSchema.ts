import { z } from "zod";

export const PRODUCT_TYPES = [
  "Term Life",
  "Whole Life",
  "IUL",
  "Final Expense",
  "Annuities",
  "Custom",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export const productTypeSchema = z.enum(PRODUCT_TYPES);

const nameSchema = z
  .string()
  .trim()
  .min(1, "Script name is required")
  .max(60, "Max 60 characters");

const contentSchema = z
  .string()
  .max(50_000, "Content too long (50,000 character max)")
  .default("");

export const callScriptBaseSchema = z.object({
  name: nameSchema,
  product_type: productTypeSchema,
  active: z.boolean(),
  content: contentSchema,
});

export const callScriptInsertSchema = callScriptBaseSchema.extend({
  organization_id: z.string().uuid("Organization is required"),
});

export const callScriptRenameSchema = z.object({ name: nameSchema });

export const callScriptSaveSchema = z.object({
  name: nameSchema,
  product_type: productTypeSchema,
  content: contentSchema,
});

export type CallScriptInsert = z.infer<typeof callScriptInsertSchema>;
export type CallScriptSave = z.infer<typeof callScriptSaveSchema>;
