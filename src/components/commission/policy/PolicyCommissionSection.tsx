import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useClientPolicyCommissions } from "@/hooks/useClientPolicyCommissions";
import { isOpenPolicy, type OpenPolicyCommission } from "@/lib/commission/trackingSchemas";
import { CaptureAttentionNotice } from "./CaptureAttentionNotice";
import { PolicyCommissionDetail } from "./PolicyCommissionDetail";
import { PolicyCommissionSummary } from "./PolicyCommissionSummary";
import { RecordEstimateDialog } from "./RecordEstimateDialog";

/** A commission problem must never break the contact view, so it renders nothing. */
class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[policy commission] hidden after an error", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Saved commission for one policy in the contact view (Phase 2A). Shows nothing unless the server lets the real
 * signed-in user see this policy's commission; read-only for Team Leaders.
 */
export function PolicyCommissionSection(props: { clientId: string; policyId: string | null; compact?: boolean }) {
  return (
    <SectionBoundary>
      <SectionBody {...props} />
    </SectionBoundary>
  );
}

function SectionBody({ clientId, policyId, compact = false }: { clientId: string; policyId: string | null; compact?: boolean }) {
  const query = useClientPolicyCommissions(policyId ? clientId : null);
  const policy = policyId ? query.data?.policies.find((candidate) => candidate.policy_id === policyId) : undefined;
  // A policy saved after the last read (e.g. just recorded) is fetched once instead of waiting for staleness.
  const refetched = useRef<string | null>(null);
  const missing = !!policyId && !!query.data && !policy && !query.isFetching;
  const { refetch } = query;
  useEffect(() => {
    if (missing && refetched.current !== policyId) {
      refetched.current = policyId;
      void refetch();
    }
  }, [missing, policyId, refetch]);
  if (!policy || !isOpenPolicy(policy)) return null;
  return <OpenSection policy={policy} compact={compact} />;
}

/** The one explanation of what the figures and dates are (opens on click or tap). */
function EstimateNote() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="About this estimate"
          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="h-3 w-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-2.5 text-xs leading-relaxed">
        AgentFlow estimate. Expected dates assume payment 1–3 business days after each premium date. Not carrier-verified.
      </PopoverContent>
    </Popover>
  );
}

function OpenSection({ policy, compact }: { policy: OpenPolicyCommission; compact: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [recording, setRecording] = useState(false);
  const canWrite = policy.access === "write";

  let body: ReactNode;
  if (policy.state === "recorded" && policy.estimate) {
    body = (
      <>
        <button
          type="button"
          aria-expanded={expanded}
          className="flex w-full min-w-0 items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded((open) => !open)}
        >
          <PolicyCommissionSummary estimate={policy.estimate} />
          <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {expanded && <PolicyCommissionDetail policy={policy} />}
      </>
    );
  } else if ((policy.state === "awaiting_confirmation" || policy.state === "needs_attention") && policy.capture) {
    body = <CaptureAttentionNotice policy={policy} onRecordLater={() => setRecording(true)} />;
  } else if (canWrite) {
    body = (
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
        <span>No commission estimate recorded.</span>
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setRecording(true)}>Record estimate</button>
      </div>
    );
  } else {
    return null;
  }

  return (
    <section aria-label="Commission" className={`min-w-0 space-y-1.5 border-t ${compact ? "mt-2.5 border-border/60 pt-2" : "border-border pt-3"}`}>
      <div className="flex items-center gap-1">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Commission</h4>
        {policy.state === "recorded" && <EstimateNote />}
      </div>
      {body}
      {canWrite && <RecordEstimateDialog open={recording} onOpenChange={setRecording} policy={policy} replace={false} />}
    </section>
  );
}
