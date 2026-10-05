import type { BookingPayload } from "@/lib/appointmentPersistence";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const persistedSchema = z.object({
  id: z.string().nullable().optional(),
  call_id: z.string().nullable(),
  contact_id: z.string().nullable(),
  contact_type: z.string(),
  status: z.string().nullable().optional(),
  call_attempts: z.number().nullable().optional(),
  last_called_at: z.string().nullable().optional(),
  retry_eligible_at: z.string().nullable().optional(),
  callback_due_at: z.string().nullable().optional(),
  scheduled_callback_at: z.string().nullable().optional(),
  callback_agent_id: z.string().nullable().optional(),
  callback_note: z.string().nullable().optional(),
  disposition: z.string().nullable().optional(),
  disposition_version: z.number().nullable().optional(),
  claimed_lead_id: z.string().nullable().optional(),
  dnc_suppressed: z.boolean(),
  lock_released: z.boolean(),
  replayed: z.boolean(),
}).passthrough();
export type PersistedDisposition = z.infer<typeof persistedSchema>;
export interface DispositionInput {
  appointment?: BookingPayload | null;
  campaignLeadId: string | null;
  callId?: string | null;
  dispositionId?: string | null;
  callbackDueAt?: string | null;
  callbackNote?: string | null;
  releaseLock?: boolean;
  operationId: string;
  notes?: string;
  convertedClientId?: string | null;
  expectedVersion?: number | null;
  action?: "disposition" | "skip";
}

/** ONE write path. Disposition behavior and organization authority stay on the server. */
export async function persistDisposition(input: DispositionInput): Promise<PersistedDisposition> {
  const { data, error } = await (supabase as any).rpc("save_disposition_with_booking", { p_appointment: input.appointment ?? null, p_input: {
    p_campaign_lead_id: input.campaignLeadId,
    p_call_id: input.callId ?? null,
    p_disposition_id: input.dispositionId ?? null,
    p_callback_due_at: input.callbackDueAt ?? null,
    p_callback_note: input.callbackNote ?? null,
    p_release_lock: input.releaseLock ?? true,
    p_operation_id: input.operationId,
    p_notes: input.notes ?? "",
    p_converted_client_id: input.convertedClientId ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_action: input.action ?? "disposition",
  } });
  if (error) throw new Error(error.message);
  const parsed = persistedSchema.safeParse(data);
  if (!parsed.success) throw new Error("Disposition save was not confirmed. Keep this lead open and retry.");
  if (input.campaignLeadId && parsed.data.id !== input.campaignLeadId) {
    throw new Error("Disposition response did not match this lead.");
  }
  if (input.releaseLock !== false && !parsed.data.lock_released) throw new Error("Lead lock release was not confirmed.");
  return parsed.data;
}

export function applyPersistedDisposition<T extends { id: string }>(queue: T[], id: string, result: PersistedDisposition): T[] {
  return queue.map((lead) => lead.id === id ? { ...lead, ...result, id: lead.id } : lead);
}
export function removeQueueLead<T extends { id: string }>(queue: T[], id: string): T[] {
  return queue.filter((lead) => lead.id !== id);
}

/** Unknown admission is not No Answer. The caller must retain wrap-up for retry. */
export async function verifyOutboundAdmission(callId: string): Promise<void> {
  const { data, error } = await (supabase as any).rpc("get_outbound_admission", { p_call_id: callId });
  if (error || data?.admitted !== true) {
    throw new Error(data?.admitted === false
      ? "Call was blocked before dialing. No campaign attempt was recorded."
      : "Unable to verify whether this call started. Disposition was not saved.");
  }
}
