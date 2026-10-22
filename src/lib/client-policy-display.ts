import type { Client } from "@/lib/types";
import { normalizeClientPolicies, type NormalizedPolicy } from "@/lib/profile/normalized-policy";

const POLICY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const policyIdOrNull = (raw: unknown) => (typeof raw === "string" && POLICY_ID.test(raw) ? raw : null);
const isEntry = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * A displayed policy plus its stored identity (`clients.primary_policy_id`, or the additional entry's `policyId`)
 * when present and well-formed; `null` for legacy rows. Display-only: the book-of-business canon is unchanged.
 */
export type DisplayedPolicy = NormalizedPolicy & { policyId: string | null };

/** Read-only adapter: use the same stored-policy definition as the book of business. */
export function getClientPolicyDisplay(client: Partial<Client>) {
  const normalized = normalizeClientPolicies({
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
  // The canon lists additional policies in stored order, one per object entry; identities follow the same order.
  const stored = (client.customFields as Record<string, unknown> | undefined)?.additional_policies;
  const entries = Array.isArray(stored) ? stored.filter(isEntry) : [];
  let next = 0;
  const policies: DisplayedPolicy[] = normalized.policies.map((policy) => ({
    ...policy,
    policyId: policy.source === "primary" ? policyIdOrNull(client.primaryPolicyId) : policyIdOrNull(entries[next++]?.policyId),
  }));
  return { ...normalized, policies };
}
