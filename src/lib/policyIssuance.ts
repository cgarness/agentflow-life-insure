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

/** The earliest issue date the server accepts. */
export const EARLIEST_ISSUE_DATE = "1900-01-01";

/** The date field of the confirmation dialog: a real calendar date from 1900 on, today or earlier. */
export const issueDateSchema = z.string()
  .refine(value => parseLocalDateInput(value) !== null, "Enter the date the policy was issued.")
  .refine(value => value >= EARLIEST_ISSUE_DATE, "Enter an issue date on or after January 1, 1900.")
  .refine(value => value <= todayLocalDateInput(), "The issue date cannot be in the future.");

const FAILURES: Record<string, string> = {
  "42501": "You cannot confirm issuance for this client.",
  // The server also uses this code for a date before 1900 and for a reused request, so the wording stays general.
  "22023": "Enter a valid issue date that is not in the future.",
  PT409: "This policy is already confirmed as issued on a different date.",
  PT404: "This policy is no longer available.",
};

/** A refused confirmation. `code` is the server's error code, so the caller can tell a stale status from a failure. */
export class PolicyIssuanceError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

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
  if (error) {
    // A refusal that signing in again fixes (a session whose mode the server cannot verify) keeps the server's wording.
    const own = error.hint === "automation_session_reauth" ? error.message?.trim() : "";
    throw new PolicyIssuanceError(own || (FAILURES[error.code] ?? "Issuance was not confirmed. Try again."), error.code ?? "");
  }
  return confirmedSchema.parse(data);
}
