import type { Client } from "@/lib/types";

/** A default policy type alone does not turn a contact into a policy. */
export function hasClientPolicyEvidence(client: Partial<Client>): boolean {
  const amountEvidence = (value?: string) => {
    if (!value?.trim()) return false;
    const numeric = Number(value.replace(/[,$\s]/g, ""));
    return !Number.isFinite(numeric) || numeric !== 0;
  };
  return Boolean(client.carrier?.trim() || client.policyNumber?.trim() || client.soldDate?.trim() ||
    amountEvidence(client.premiumAmount) || amountEvidence(client.faceAmount));
}
