import { z } from "zod";
import { paymentFrequencySchema } from "./policyPaymentFields";

const optionalIsoDate = z.string().optional().refine((v) => !v ||
  (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v),
"Date must be a valid calendar date");

export const clientSaleFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  state: z.string().length(2, "State must be exactly 2 letters").optional().or(z.literal("")),
  soldDate: optionalIsoDate,
  effectiveDate: optionalIsoDate,
  draftDate: optionalIsoDate,
  paymentFrequency: paymentFrequencySchema.optional().or(z.literal("")),
  carrier: z.string().optional(),
  premiumAmount: z.string().optional(),
  recordSale: z.boolean(),
}).superRefine((value, ctx) => {
  if (!value.recordSale) return;
  if (!value.soldDate || !value.carrier?.trim())
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A new sale requires a Sold Date and carrier" });
  const premium = (value.premiumAmount ?? "").replace(/[,$\s]/g, "");
  if (premium && !/^\d+(\.\d{1,2})?$/.test(premium))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a nonnegative monthly premium with at most two decimal places" });
});
