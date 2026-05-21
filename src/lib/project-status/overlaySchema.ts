import { z } from "zod";

export const overlayEditSchema = z.object({
  status: z.string().optional().or(z.literal("")),
  note: z.string().max(4000).optional().or(z.literal("")),
});

export type OverlayEditForm = z.infer<typeof overlayEditSchema>;

export const MODULE_STATUS_OPTIONS = ["LIVE", "NEEDS_WORK", "PLACEHOLDER", "BROKEN"] as const;
export const TECH_DEBT_PRIORITY_OPTIONS = ["HIGH", "MEDIUM", "LOW"] as const;
export const BUILD_QUEUE_MODE_OPTIONS = ["THINK", "BUILD", "DEBUG"] as const;
export const BUILD_QUEUE_STATUS_OPTIONS = ["IN PROGRESS", "DONE", "OPEN"] as const;

export const UI_SURFACE_STATUS_OPTIONS = [
  "LIVE",
  "NEEDS_WORK",
  "PLACEHOLDER",
  "BROKEN",
  "NOT_STARTED",
] as const;

export function statusOptionsForSection(section: string): readonly string[] {
  switch (section) {
    case "ui_surface":
      return UI_SURFACE_STATUS_OPTIONS;
    case "module":
      return MODULE_STATUS_OPTIONS;
    case "tech_debt":
      return TECH_DEBT_PRIORITY_OPTIONS;
    case "build_queue":
      return [...BUILD_QUEUE_MODE_OPTIONS, ...BUILD_QUEUE_STATUS_OPTIONS];
    case "feature_gap":
      return ["OPEN", "IN_PROGRESS", "DONE", "PLACEHOLDER"];
    default:
      return ["OPEN", "IN_PROGRESS", "DONE"];
  }
}
