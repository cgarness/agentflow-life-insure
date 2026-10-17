import type { Client } from "@/lib/types";
import { normalizeClientPolicies } from "@/lib/profile/normalized-policy";

/** Read-only adapter: use the same stored-policy definition as the book of business. */
export function getClientPolicyDisplay(client: Partial<Client>) {
  return normalizeClientPolicies({
    id: client.id ?? "",
    policy_type: client.policyType,
    carrier: client.carrier,
    policy_number: client.policyNumber,
    premium: client.premiumAmount,
    face_amount: client.faceAmount,
    sold_date: client.soldDate,
    effective_date: client.effectiveDate,
    custom_fields: client.customFields,
  });
}
