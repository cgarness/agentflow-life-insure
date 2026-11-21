import { z } from "zod";
import type { WorkflowStatus } from "./workflow-types";

const switches = z.object({enrollment_enabled:z.boolean(), dispatch_enabled:z.boolean()});
export type ReleaseControls = z.infer<typeof switches>;

export function readReleaseControls(input: unknown): ReleaseControls | null {
  const result = switches.safeParse(input);
  return result.success ? result.data : null;
}

export function sameReleaseControls(a: ReleaseControls | null, b: ReleaseControls | null) {
  return !!a && !!b && a.enrollment_enabled === b.enrollment_enabled && a.dispatch_enabled === b.dispatch_enabled;
}

const admissionByTrigger = new Map([
  ["lead_created","Qualifying new leads can start a run."],
  ["campaign_membership_created","Qualifying new campaign memberships can start a run."],
]);

export function workflowEffects(status: WorkflowStatus, trigger: string | null, controls: ReleaseControls | null) {
  if (status === "draft") return "This draft cannot enroll contacts or hand messages to a provider.";
  if (status === "paused") return "This workflow is paused. New enrollments and provider handoffs are blocked.";
  if (status === "archived") return "This workflow is archived. New enrollments and future provider handoffs are blocked.";
  if (!controls) return "Current enrollment and sending permissions could not be confirmed.";
  const admission = controls.enrollment_enabled
    ? admissionByTrigger.get(trigger ?? "") ?? "The published trigger could not be confirmed."
    : "Agency enrollment is off. New events cannot start a run.";
  const sending = !controls.dispatch_enabled ? "Provider dispatch is off. Messages cannot be handed to a provider." :
    controls.enrollment_enabled ? "Messages may go out after sender, consent, timing and limit checks." :
    "Existing runs may send after sender, consent, timing and limit checks.";
  return admission + " " + sending;
}
