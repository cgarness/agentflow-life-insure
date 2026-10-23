import { Component, useEffect, useRef, type ReactNode } from "react";
import { usePolicyCommissionPreview, usePreviewSelection, type PreviewOwner } from "@/hooks/usePolicyCommissionPreview";
import { captureKey, captureSlotInputs, type CommissionSlotInputs } from "@/lib/commission/capture";
import { ADVANCE_PERCENT } from "@/lib/commission/estimate";
import { formatUsd } from "@/lib/commission/money";
import {
  candidateProducts,
  ageOptionalForProduct,
  NO_MATCHING_PRODUCT_MESSAGE,
  prefillAge,
  previewOutcome,
  productTermLengths,
} from "@/lib/commission/policyPreview";
import { PolicyCommissionInputs } from "./PolicyCommissionInputs";

export interface PolicyCommissionEstimateProps {
  /** Who the sale would credit; null = unresolved (nothing is shown or requested). */
  owner: PreviewOwner | null;
  policyType: string;
  carrier: string;
  /** The policy's existing Monthly Premium field, unchanged. */
  monthlyPremium: string;
  /** Valid-only insured-age prefill (ConvertLeadModal): DOB on the Sold Date, else a stored age. */
  agePrefill?: { dateOfBirth?: string | null; age?: number | null; onDate?: string | null };
  /**
   * Phase 2A: receives the inputs of the estimate currently DISPLAYED (null when none is), so the sale can send
   * them for server re-validation. Never called with anything that was not shown.
   */
  onCaptureChange?: (inputs: CommissionSlotInputs | null) => void;
}

/** A preview failure must never unmount the policy form or block its save, so it renders nothing. */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[commission preview] hidden after an error", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Compact estimate below a policy's details: an estimate only, never saved, earned, booked or paid
 * commission. Reuses the Commission Calculator's grid, matching and exact arithmetic unchanged.
 */
export function PolicyCommissionEstimate(props: PolicyCommissionEstimateProps) {
  return (
    <PreviewBoundary>
      <PreviewPanel {...props} />
    </PreviewBoundary>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-[11px] text-muted-foreground">{children}</p>;

/** Reports the displayed estimate's inputs whenever they change, and null once the panel is gone. */
function useCaptureReport(onCaptureChange: PolicyCommissionEstimateProps["onCaptureChange"], capture: CommissionSlotInputs | null) {
  const report = useRef(onCaptureChange);
  report.current = onCaptureChange;
  const latest = useRef(capture);
  latest.current = capture;
  const key = captureKey(capture);
  useEffect(() => {
    report.current?.(latest.current);
  }, [key]);
  useEffect(() => () => report.current?.(null), []);
}

function PreviewPanel({ owner, policyType, carrier, monthlyPremium, agePrefill, onCaptureChange }: PolicyCommissionEstimateProps) {
  const preview = usePolicyCommissionPreview(owner);
  const ready = preview.status === "ready" ? preview : null;
  const products = ready ? candidateProducts(ready.context, policyType, carrier) : null;
  const [selection, update] = usePreviewSelection(
    preview.identity,
    ready?.context.grid.id ?? null,
    products?.map((product) => product.id) ?? null,
    (productId) => (ready ? productTermLengths(ready.context, productId) : []),
  );

  const visible = preview.status !== "hidden" && !!carrier.trim();
  let body: ReactNode = null;
  let capture: CommissionSlotInputs | null = null;
  if (!visible) {
    body = null;
  } else if (preview.status === "unavailable") {
    body = <Muted>{preview.message}</Muted>;
  } else if (preview.level.kind === "problem") {
    body = <Muted>{preview.level.message}</Muted>;
  } else if (!products?.length) {
    body = <Muted>{NO_MATCHING_PRODUCT_MESSAGE}</Muted>;
  } else {
    const product = products.find((candidate) => candidate.id === selection.productId) ?? null;
    const age = selection.age ?? prefillAge(agePrefill);
    const outcome = previewOutcome(
      preview.context,
      preview.level.level,
      product,
      { term: selection.term, age, monthlyPremium },
      preview.agentName === null,
    );
    if (outcome.kind === "estimate" && preview.creditedAgentId) {
      capture = captureSlotInputs({
        context: preview.context,
        creditedAgentId: preview.creditedAgentId,
        level: preview.level.level,
        ...outcome.basis,
      });
    }
    body = (
      <>
        <PolicyCommissionInputs
          products={products}
          terms={product ? productTermLengths(preview.context, product.id) : []}
          selection={{ productId: selection.productId, term: selection.term, age }}
          ageOptional={product ? ageOptionalForProduct(preview.context, product.id) : false}
          onChange={update}
        />
        {outcome.kind === "estimate" ? (
          <div className="space-y-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <p>
              Estimated first-year commission:{" "}
              <span className="font-semibold tabular-nums">{formatUsd(outcome.firstYearCommission)}</span>
            </p>
            <p>
              Estimated advance ({ADVANCE_PERCENT}%):{" "}
              <span className="font-semibold tabular-nums">{formatUsd(outcome.advance)}</span>
            </p>
          </div>
        ) : (
          <Muted>{outcome.message}</Muted>
        )}
      </>
    );
  }
  useCaptureReport(onCaptureChange, capture);

  if (!visible) return null;

  return (
    <section aria-label="Commission estimate" className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      {ready?.agentName && <p className="truncate text-[11px] font-medium text-foreground">For {ready.agentName}</p>}
      {body}
    </section>
  );
}
