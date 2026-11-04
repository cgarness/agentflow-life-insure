import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { policySalePremiumKeys } from "@/hooks/usePolicySalePremiums";
import { CorrectionError, submitCorrection, type CorrectionArgs, type CorrectionResult } from "@/lib/policySaleCorrection";

export type CorrectionPhase = "editing" | "sending" | "frozen" | "stale" | "conflict" | "saved";
export const CORRECTION_SAVED_TOAST = "Sale premium corrected. Performance totals show the new amount on their next refresh.";

/**
 * One correction submission (D2 §5). Phases:
 * - editing: the form can change; a refusal that proves nothing was saved returns here with its message.
 * - sending: one call in flight.
 * - frozen: the outcome is unknown; Retry resends the identical frozen call (same request id), never a new one.
 * - stale: the sale or its policy record changed (PT409 stale_revision / policy_changed); reload, then start again.
 * - conflict: the request id was used for a different correction (PT409 request_conflict).
 * - saved: success; the toast is shown and exactly ['policy-sale-premiums', clientId] and ['policy-commissions'] are
 *   invalidated. No other cache, poll or channel is touched.
 * A generation guard drops responses that arrive after a reset, an identity change or unmount.
 */
export function usePremiumCorrectionSubmission(clientId: string, onSaved?: (result: CorrectionResult) => void) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [phase, setPhase] = useState<CorrectionPhase>("editing");
  const [message, setMessage] = useState<string | null>(null);
  const frozen = useRef<CorrectionArgs | null>(null);
  const generation = useRef(0);
  const saved = useRef(onSaved);
  saved.current = onSaved;

  const reset = useCallback(() => {
    generation.current += 1;
    frozen.current = null;
    setPhase("editing");
    setMessage(null);
  }, []);
  // Unmount drops any late response. A frozen call is not kept across unmount: a new attempt carries the old expected
  // revision, so if the unknown call did save, the server refuses the new one as stale instead of applying it twice.
  useEffect(() => () => { generation.current += 1; }, []);
  const identity = user?.id ?? null;
  const seen = useRef(identity);
  useEffect(() => {
    if (seen.current !== identity) { seen.current = identity; reset(); }
  }, [identity, reset]);

  const send = useCallback(async (args: CorrectionArgs) => {
    const mine = ++generation.current;
    frozen.current = args;
    setPhase("sending");
    setMessage(null);
    try {
      const result = await submitCorrection(args);
      if (generation.current !== mine) return null;
      setPhase("saved");
      toast.success(CORRECTION_SAVED_TOAST);
      void queryClient.invalidateQueries({ queryKey: policySalePremiumKeys.invalidate(clientId) });
      void queryClient.invalidateQueries({ queryKey: ["policy-commissions"] });
      saved.current?.(result);
      return result;
    } catch (error) {
      if (generation.current !== mine) return null;
      const e = error instanceof CorrectionError ? error : null;
      setMessage(e?.message ?? "We couldn't confirm the correction. Retry sends exactly the same correction.");
      if (!e || e.errorClass === "unknown") {
        setPhase("frozen");
      } else if (e.errorClass === "conflict") {
        frozen.current = null;
        setPhase(e.detail === "request_conflict" ? "conflict" : "stale");
        if (e.detail !== "request_conflict") void queryClient.invalidateQueries({ queryKey: policySalePremiumKeys.invalidate(clientId) });
      } else {
        frozen.current = null;
        setPhase("editing");
      }
      return null;
    }
  }, [clientId, queryClient]);

  /** Submits a new prepared call; refused while an unknown outcome is waiting for its exact retry. */
  const submit = useCallback((args: CorrectionArgs) => (frozen.current && phase === "frozen" ? null : send(args)), [phase, send]);
  /** Resends the frozen call byte for byte (same request id). */
  const retry = useCallback(() => (frozen.current ? send(frozen.current) : null), [send]);

  return { phase, message, submit, retry, reset, frozenArgs: phase === "frozen" ? frozen.current : null };
}
