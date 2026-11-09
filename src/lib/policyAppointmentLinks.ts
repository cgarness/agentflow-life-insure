import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

/** Closing-appointment attributions (Reports V2 PKG-D, D4 §3.5, §4). Post-commit only: never part of a sale. */
export const closingAppointmentChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not_recorded") }),
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("appointment"), appointmentId: z.string().uuid(), occurrenceStart: z.string().min(1) }),
]);
export type ClosingAppointmentChoice = z.infer<typeof closingAppointmentChoiceSchema>;
export const NOT_RECORDED: ClosingAppointmentChoice = Object.freeze({ kind: "not_recorded" });

export const linkSourceSchema = z.enum(["sale_entry", "outcome_entry", "policy_entry"]);
export type LinkSource = z.infer<typeof linkSourceSchema>;
export const linkResultSchema = z.object({
  status: z.enum(["linked", "declared_none", "unchanged", "rejected"]),
  reason: z.string().nullable(),
  attribution_id: z.string().uuid().nullable(),
});
export type LinkResult = z.infer<typeof linkResultSchema>;
export const policyAppointmentLinksSchema = z.object({
  policies: z.array(z.object({
    win_id: z.string().uuid(), policy_id: z.string().uuid(), sold_date: z.string().nullable(),
    carrier: z.string().nullable(), policy_type: z.string().nullable(),
    link: z.object({ attribution_id: z.string().uuid(), declaration: z.enum(["appointment", "none"]),
                     appointment_id: z.string().uuid().optional(), occurrence_start: z.string().optional() }).nullable(),
  })),
});
export type PolicyAppointmentLinks = z.infer<typeof policyAppointmentLinksSchema>;

export const LINK_REASON_TEXT: Record<string, string> = {
  appointment_not_found: "the appointment is not available",
  occurrence_not_found: "the appointment time changed",
  not_held: "the appointment is not marked held",
  not_a_sales_appointment: "it is not a sales appointment",
  different_contact: "the appointment is for another contact",
  sale_before_appointment: "the sale is dated before the appointment",
  already_linked: "this policy already has a closing appointment",
};

/** A transport or unreadable outcome: the link may or may not have saved; retrying with the same request id is safe. */
export class LinkTransportError extends Error {
  constructor() { super("The closing appointment link could not be confirmed"); this.name = "LinkTransportError"; }
}

export async function linkPolicyAppointment(requestId: string, winId: string, choice: ClosingAppointmentChoice,
                                            source: LinkSource): Promise<LinkResult> {
  if (choice.kind === "not_recorded") throw new Error("Nothing to link");
  let response: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    response = await (supabase as any).rpc("link_policy_appointment", {
      p_request_id: requestId, p_win_id: winId,
      p_appointment_id: choice.kind === "appointment" ? choice.appointmentId : null,
      p_occurrence_start: choice.kind === "appointment" ? choice.occurrenceStart : null,
      p_declaration: choice.kind === "appointment" ? "appointment" : "none", p_source: source });
  } catch {
    throw new LinkTransportError();
  }
  if (response.error) {
    // 42501 and 22023 are definite refusals; anything else proves nothing.
    if (response.error.code === "42501" || response.error.code === "22023") {
      return { status: "rejected", reason: response.error.code === "42501" ? "policy_not_available" : "invalid_link", attribution_id: null };
    }
    throw new LinkTransportError();
  }
  const parsed = linkResultSchema.safeParse(response.data);
  if (!parsed.success) throw new LinkTransportError();
  return parsed.data;
}

export async function fetchPolicyAppointmentLinks(clientId: string, signal?: AbortSignal): Promise<PolicyAppointmentLinks> {
  let request = (supabase as any).rpc("get_policy_appointment_links", { p_client_id: clientId });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new Error(error.message || "Closing appointments unavailable");
  return policyAppointmentLinksSchema.parse(data);
}
