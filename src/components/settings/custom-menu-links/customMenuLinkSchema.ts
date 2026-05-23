import { z } from "zod";
import type { CustomMenuLinkOpenMode } from "@/hooks/useCustomMenuLinks";

const BLOCKED_PROTOCOL_RE = /^(javascript|data|ftp|mailto):/i;

function normalizeMenuLinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (BLOCKED_PROTOCOL_RE.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const menuLinkUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .superRefine((value, ctx) => {
    if (BLOCKED_PROTOCOL_RE.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only http and https links are allowed",
      });
      return;
    }
    const normalized = normalizeMenuLinkUrl(value);
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please enter a valid URL",
      });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only http and https links are allowed",
      });
    }
  })
  .transform((value) => normalizeMenuLinkUrl(value));

const sortOrderSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    if (value === "" || value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n)) return 0;
    return Math.trunc(n);
  });

export const customMenuLinkFormSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  url: menuLinkUrlSchema,
  sort_order: sortOrderSchema,
  open_mode: z.enum(["new_tab", "in_frame"] satisfies [CustomMenuLinkOpenMode, CustomMenuLinkOpenMode]),
});

export type CustomMenuLinkFormValues = z.infer<typeof customMenuLinkFormSchema>;

export type CustomMenuLinkFieldErrors = Partial<
  Record<keyof CustomMenuLinkFormValues, string>
>;

export function parseCustomMenuLinkForm(input: {
  label: string;
  url: string;
  sort_order: string | number;
  open_mode: CustomMenuLinkOpenMode;
}):
  | { success: true; data: CustomMenuLinkFormValues }
  | { success: false; fieldErrors: CustomMenuLinkFieldErrors } {
  const result = customMenuLinkFormSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const flattened = result.error.flatten().fieldErrors;
  const fieldErrors: CustomMenuLinkFieldErrors = {};
  if (flattened.label?.[0]) fieldErrors.label = flattened.label[0];
  if (flattened.url?.[0]) fieldErrors.url = flattened.url[0];
  if (flattened.sort_order?.[0]) fieldErrors.sort_order = flattened.sort_order[0];
  if (flattened.open_mode?.[0]) fieldErrors.open_mode = flattened.open_mode[0];
  return { success: false, fieldErrors };
}
