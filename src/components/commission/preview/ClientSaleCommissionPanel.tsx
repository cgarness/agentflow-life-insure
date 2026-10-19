import type { Client } from "@/lib/types";
import { clientSaleRecordsPolicy } from "@/lib/policySaleRecording";
import type { CommissionSlotInputs } from "@/lib/commission/capture";
import { PolicyCommissionEstimate } from "./PolicyCommissionEstimate";

/**
 * Add/Edit Client: the estimate is offered only when this save records a NEW sale (a new client's policy, or the
 * first policy added to an existing client). The sale credits the signed-in user for a new client and the stored
 * owner for an existing one, exactly as the writers do.
 */
export function ClientSaleCommissionPanel({ form, initial, onCaptureChange }: {
  form: Partial<Client>;
  initial: Partial<Client> | null | undefined;
  onCaptureChange: (inputs: CommissionSlotInputs | null) => void;
}) {
  if (!clientSaleRecordsPolicy(form, initial)) return null;
  return (
    <PolicyCommissionEstimate
      owner={!initial ? { kind: "self" } : initial.id ? { kind: "client", id: initial.id } : null}
      policyType={form.policyType || "Term"}
      carrier={form.carrier || ""}
      monthlyPremium={form.premiumAmount || ""}
      onCaptureChange={onCaptureChange}
    />
  );
}
