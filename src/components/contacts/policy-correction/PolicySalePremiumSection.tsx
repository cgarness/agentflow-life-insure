import { Component, useState, type ReactNode } from "react";
import { usePolicySalePremiums } from "@/hooks/usePolicySalePremiums";
import { sameAmount, type CorrectionResult } from "@/lib/policySaleCorrection";
import { CorrectSalePremiumDialog } from "./CorrectSalePremiumDialog";
import { SalePremiumHistory } from "./SalePremiumHistory";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** A sale premium problem must never break the contact view, so it renders nothing. */
class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn("[sale premium] hidden after an error", error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * The sale premium of one policy next to its current premium (D2 §6.2). Renders only for a policy the server returns:
 * "Sale premium $X/mo (as sold)" when it differs from the current premium (whole cents; known vs unknown differs), a
 * Corrected badge when a revision exists, History (n), and Correct sale premium for Admins. Hidden under View As,
 * without identity and on error.
 */
export function PolicySalePremiumSection(props: {
  clientId: string; policyId: string; currentMonthly: number | null; formatDate: (value: string) => string;
  onPolicyRecordChanged?: () => void;
}) {
  return <SectionBoundary><SectionBody {...props} /></SectionBoundary>;
}

function SectionBody({ clientId, policyId, currentMonthly, formatDate, onPolicyRecordChanged }: {
  clientId: string; policyId: string; currentMonthly: number | null; formatDate: (value: string) => string;
  onPolicyRecordChanged?: () => void;
}) {
  const query = usePolicySalePremiums(clientId);
  const [showHistory, setShowHistory] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const sale = query.isError ? undefined : query.data?.policies.find((policy) => policy.policy_id === policyId);
  if (!query.enabled || !sale) return null;
  const canCorrect = query.data!.can_correct;
  const differs = !sameAmount(sale.effective.monthly, currentMonthly);
  const corrected = sale.effective.revision > 0;
  if (!differs && !corrected && !canCorrect) return null;
  const saved = (result: CorrectionResult) => { if (result.book_action === "updated") onPolicyRecordChanged?.(); };

  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="sale-premium-section">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {differs && (
          <span className="text-foreground">
            {sale.effective.monthly === null ? "Sale premium unknown (as sold)" : `Sale premium ${money.format(sale.effective.monthly)}/mo (as sold)`}
          </span>
        )}
        {corrected && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Corrected</span>}
        {sale.history.length > 0 && (
          <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory((open) => !open)}
            className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            History ({sale.history.length})
          </button>
        )}
        {canCorrect && (
          <button type="button" onClick={() => setCorrecting(true)}
            className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Correct sale premium
          </button>
        )}
      </div>
      {showHistory && <SalePremiumHistory history={sale.history} formatDate={formatDate} />}
      {canCorrect && (
        <CorrectSalePremiumDialog open={correcting} onOpenChange={setCorrecting} clientId={clientId} sale={sale}
          currentMonthly={currentMonthly} onSaved={saved} />
      )}
    </div>
  );
}
