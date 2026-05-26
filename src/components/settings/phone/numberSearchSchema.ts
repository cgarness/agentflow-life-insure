import { z } from "zod";

export const numberSearchSchema = z
  .object({
    areaCode: z
      .string()
      .trim()
      .regex(/^\d{0,3}$/, "Area code must be 1–3 digits")
      .optional()
      .or(z.literal("")),
    state: z
      .string()
      .trim()
      .regex(/^[A-Z]{0,2}$/i, "Use a 2-letter state code (e.g. CA)")
      .optional()
      .or(z.literal("")),
    locality: z.string().trim().max(100, "City too long").optional().or(z.literal("")),
  })
  .refine(
    (v) =>
      (v.areaCode?.length ?? 0) > 0 ||
      (v.state?.length ?? 0) > 0 ||
      (v.locality?.length ?? 0) > 0,
    {
      message: "Enter an area code, state, or city to search.",
    },
  );

export type NumberSearchValues = z.infer<typeof numberSearchSchema>;
