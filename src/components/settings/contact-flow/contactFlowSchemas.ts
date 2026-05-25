import { z } from "zod";

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid #RRGGBB hex value");

export const pipelineStageSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(30, "Name must be 30 characters or less"),
  color: hexColorSchema,
  convertToClient: z.boolean(),
});

export const leadSourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(30, "Name must be 30 characters or less"),
  color: hexColorSchema,
  active: z.boolean(),
});

export type PipelineStageFormValues = z.infer<typeof pipelineStageSchema>;
export type LeadSourceFormValues = z.infer<typeof leadSourceSchema>;

// Custom fields — Build 4. Ownership model in AGENT_RULES.md §5.
// Enforcement of `required` on contact forms lands in Build 5.
export const customFieldTypeSchema = z.enum(["Text", "Number", "Date", "Dropdown", "Email", "Phone"]);
export const customFieldAppliesToSchema = z
  .array(z.enum(["Leads", "Clients", "Recruits"]))
  .min(1, "Select at least one Applies To");

export const customFieldSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(40, "Name must be 40 characters or less"),
    type: customFieldTypeSchema,
    appliesTo: customFieldAppliesToSchema,
    required: z.boolean(),
    active: z.boolean(),
    defaultValue: z.string().max(200, "Default must be 200 characters or less").optional(),
    dropdownOptions: z.array(z.string()).optional(),
    orgWide: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.type !== "Dropdown") return;
    const cleaned = (val.dropdownOptions ?? []).map((o) => o.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Add at least 2 options" });
    }
    if (cleaned.length > 20) {
      ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Maximum 20 options" });
    }
    if (cleaned.some((o) => o.length > 50)) {
      ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Each option must be 50 characters or less" });
    }
    const lower = cleaned.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      ctx.addIssue({ code: "custom", path: ["dropdownOptions"], message: "Options must be unique (case-insensitive)" });
    }
  });

export type CustomFieldFormValues = z.infer<typeof customFieldSchema>;
