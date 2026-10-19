import type { Client } from "@/lib/types";
import { getClientPolicyDisplay } from "@/lib/client-policy-display";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PolicyCommissionSection } from "@/components/commission/policy/PolicyCommissionSection";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const amount = (value: number | null) => value === null ? "—" : money.format(value);

export function ClientPolicyCount({ client }: { client: Partial<Client> }) {
  const { policies, malformedAdditionalPolicies } = getClientPolicyDisplay(client);
  if (malformedAdditionalPolicies > 0) {
    return <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Review policies</span>;
  }
  if (policies.length < 2) return null;
  return <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{policies.length} policies</span>;
}

/**
 * Never edits or writes the reserved additional-policy array. Each stored policy can carry its saved commission
 * (Phase 2A); the commission section renders nothing unless the server lets the signed-in user see it.
 */
export function ClientPolicies({ client, formatDate }: {
  client: Partial<Client>;
  formatDate: (value: string) => string;
}) {
  const { policies, malformedAdditionalPolicies } = getClientPolicyDisplay(client);
  const hasAdditional = policies.some(policy => policy.source === "additional");
  if (!hasAdditional && malformedAdditionalPolicies === 0) {
    const primary = policies.find(policy => policy.source === "primary");
    return client.id && primary?.policyId ? <PolicyCommissionSection clientId={client.id} policyId={primary.policyId} /> : null;
  }

  return (
    <section aria-label="Policies" className="min-w-0 border-t border-border pt-3">
      <h3 className="mb-1 text-xs font-semibold text-foreground">Policies ({policies.length})</h3>
      {malformedAdditionalPolicies > 0 && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">Some policy details could not be displayed.</p>
      )}
      <Accordion key={client.id} type="multiple" className="space-y-1">
        {policies.map((policy, index) => {
          const fields = [
            ["Policy type", policy.policyType || "—"],
            ["Carrier", policy.carrier || "—"],
            ["Policy #", policy.policyNumber || "—"],
            ["Monthly premium", amount(policy.premiumMonthly)],
            ["Coverage", amount(policy.faceAmount)],
            ["Sold date", policy.soldDate ? formatDate(policy.soldDate) : "—"],
            ["Effective date", policy.effectiveDate ? formatDate(policy.effectiveDate) : "—"],
          ];
          return (
            <AccordionItem key={`${policy.source}-${index}`} value={`${policy.source}-${index}`} className="border-0">
              <AccordionTrigger className="gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-left text-xs hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{policy.carrier || `Policy ${index + 1}`}</span>
                  <span className="block break-words font-normal text-muted-foreground">{policy.policyType || "Policy"}{policy.source === "primary" ? " · Primary" : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums">{amount(policy.premiumMonthly)}{policy.premiumMonthly !== null ? "/mo" : ""}</span>
              </AccordionTrigger>
              <AccordionContent className="px-2.5 pb-3 pt-2">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {fields.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[10px] text-muted-foreground">{label}</dt>
                      <dd className="break-words text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
                {client.id && policy.policyId && <PolicyCommissionSection clientId={client.id} policyId={policy.policyId} compact />}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </section>
  );
}
