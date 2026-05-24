import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Disposition form schema. Validate raw form state, then normalize via
 * `normalizeDisposition()` before persisting. We avoid mutating values inside
 * `superRefine` (Zod treats those mutations as undefined behavior) — all
 * derived/normalized values are produced post-parse.
 */
export const dispositionSchema = z
  .object({
    name: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "Name is required").max(30, "Max 30 characters")),
    color: z.string().regex(HEX_COLOR, "Choose a 6-digit hex color (e.g. #3B82F6)"),
    requireNotes: z.boolean(),
    minNoteChars: z.number().int("Whole number").min(0, "Min 0").max(500, "Max 500"),
    callbackScheduler: z.boolean(),
    appointmentScheduler: z.boolean(),
    automationTrigger: z.boolean(),
    automationId: z.string().nullable().optional(),
    automationName: z.string().nullable().optional(),
    campaignAction: z.enum(["none", "remove_from_queue", "remove_from_campaign"]),
    dncAutoAdd: z.boolean(),
    pipelineStageId: z
      .union([z.string().regex(UUID, "Invalid pipeline stage"), z.literal(""), z.null()])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.requireNotes && v.minNoteChars < 1) {
      ctx.addIssue({ code: "custom", path: ["minNoteChars"], message: "Must be at least 1 when notes are required" });
    }
    if (v.automationTrigger && (!v.automationId || v.automationId.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["automationId"], message: "Choose an automation" });
    }
  });

export type DispositionFormValues = z.infer<typeof dispositionSchema>;

/**
 * Apply business-rule normalization post-parse:
 * - `minNoteChars` collapses to 0 when notes aren't required.
 * - `automationId` / `automationName` collapse to null when trigger is off.
 * - `pipelineStageId` collapses empty string / undefined to null.
 */
export interface NormalizedDisposition {
  name: string;
  color: string;
  requireNotes: boolean;
  minNoteChars: number;
  callbackScheduler: boolean;
  appointmentScheduler: boolean;
  automationTrigger: boolean;
  automationId: string | null;
  automationName: string | null;
  campaignAction: DispositionFormValues["campaignAction"];
  dncAutoAdd: boolean;
  pipelineStageId: string | null;
}

export function normalizeDisposition(v: DispositionFormValues): NormalizedDisposition {
  return {
    name: v.name,
    color: v.color,
    requireNotes: v.requireNotes,
    minNoteChars: v.requireNotes ? v.minNoteChars : 0,
    callbackScheduler: v.callbackScheduler,
    appointmentScheduler: v.appointmentScheduler,
    automationTrigger: v.automationTrigger,
    automationId: v.automationTrigger ? (v.automationId ?? null) : null,
    automationName: v.automationTrigger ? (v.automationName ?? null) : null,
    campaignAction: v.campaignAction,
    dncAutoAdd: v.dncAutoAdd,
    pipelineStageId: v.pipelineStageId && v.pipelineStageId.length > 0 ? v.pipelineStageId : null,
  };
}
