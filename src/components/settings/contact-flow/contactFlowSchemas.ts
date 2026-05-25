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
