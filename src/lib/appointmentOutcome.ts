import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/** Held / No show for a started appointment (Reports V2 PKG-D, D4 §3.4, §4). The server fails closed. */
export const appointmentOutcomeArgsSchema = z.object({
  requestId: z.string().uuid(), appointmentId: z.string().uuid(), expectedStart: z.string().min(1),
  outcome: z.enum(["held", "no_show"]),
});
export type AppointmentOutcomeArgs = z.infer<typeof appointmentOutcomeArgsSchema>;
export const appointmentOutcomeResultSchema = z.object({
  appointment_id: z.string().uuid(), request_id: z.string().uuid(), outcome: z.enum(["held", "no_show"]),
  status: z.string(), start_time: z.string(),
});
export type AppointmentOutcomeResult = z.infer<typeof appointmentOutcomeResultSchema>;

export const OUTCOME_UNAVAILABLE = "Outcome recording is temporarily unavailable";
export const OUTCOME_NOT_SAVED = "The outcome wasn't saved. Try again.";

export class AppointmentOutcomeError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); this.name = "AppointmentOutcomeError"; }
}
export function appointmentOutcomeMessage(error: { code?: string | null; message?: string | null } | null): string {
  const code = error?.code ?? null;
  if (code === "55P03" || code === "57014") return OUTCOME_NOT_SAVED;
  if (code === "PT409" || code === "42501" || code === "22023" || /permission denied for function/i.test(error?.message ?? "")) return OUTCOME_UNAVAILABLE;
  return OUTCOME_NOT_SAVED;
}

export async function recordAppointmentOutcome(args: AppointmentOutcomeArgs): Promise<AppointmentOutcomeResult> {
  const a = appointmentOutcomeArgsSchema.parse(args);
  let response: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    response = await (supabase as any).rpc("record_appointment_outcome", {
      p_request_id: a.requestId, p_appointment_id: a.appointmentId, p_expected_start: a.expectedStart, p_outcome: a.outcome });
  } catch {
    throw new AppointmentOutcomeError(OUTCOME_NOT_SAVED, null);
  }
  if (response.error) throw new AppointmentOutcomeError(appointmentOutcomeMessage(response.error), response.error.code ?? null);
  const parsed = appointmentOutcomeResultSchema.safeParse(response.data);
  if (!parsed.success) throw new AppointmentOutcomeError(OUTCOME_NOT_SAVED, null);
  return parsed.data;
}
