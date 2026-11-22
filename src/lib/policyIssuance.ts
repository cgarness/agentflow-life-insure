import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { parseLocalDateInput, todayLocalDateInput } from "@/lib/taskDates";

/**
 * Issuance is its own confirmed fact about one policy. A recorded sale, an effective date or the old
 * issue-date text is never read as issuance here.
 */
const entrySchema = z.object({
  policy_id: z.string(),
  issued_on: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  confirmed_by_name: z.string().nullable(),
  can_confirm: z.boolean(),
});
const confirmedSchema = z.object({
  policy_id: z.string(),
  issued_on: z.string(),
  confirmed_at: z.string(),
  idempotent: z.boolean(),
});
export type PolicyIssuanceEntry = z.infer<typeof entrySchema>;

/** The date field of the confirmation dialog: a real calendar date, today or earlier. */
export const issueDateSchema = z.string()
  .refine(value => parseLocalDateInput(value) !== null, "Enter the date the policy was issued.")
  .refine(value => value <= todayLocalDateInput(), "The issue date cannot be in the future.");

const FAILURES: Record<string, string> = {
  "42501": "You cannot confirm issuance for this client.",
  "22023": "Enter an issue date that is not in the future.",
  PT409: "This policy is already confirmed as issued on a different date.",
  PT404: "This policy is no longer available.",
};

/** One entry per stored policy of a client the signed-in person can see. */
export async function getPolicyIssuance(clientId: string): Promise<PolicyIssuanceEntry[]> {
  const { data, error } = await supabase.rpc("get_policy_issuance", { p_client_id: clientId });
  if (error) throw new Error("Issuance status could not be loaded.");
  return z.array(entrySchema).parse(data);
}

/** The same request ID on a retry is the same confirmation, so a lost reply never confirms twice. */
export async function confirmPolicyIssuance(requestId: string, policyId: string, issuedOn: string) {
  const { data, error } = await supabase.rpc("confirm_policy_issuance", {
    p_request_id: requestId, p_policy_id: policyId, p_issued_on: issuedOn,
  });
  if (error) throw new Error(FAILURES[error.code] ?? "Issuance was not confirmed. Try again.");
  return confirmedSchema.parse(data);
}
