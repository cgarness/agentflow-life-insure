import { useCallback, useRef, useState } from "react";
import {
  conflictMessage,
  FROZEN_MESSAGE,
  newSaleAttempt,
  readSaleOperationStatus,
  SaleRequestError,
  type PreparedSale,
  type SaleAttempt,
  type SaleHandoffResult,
} from "@/lib/policySaleOutcome";

/**
 * Operation-aware state for one sale modal (Phase 2A).
 *
 * - editing: nothing sent yet, or the server confirmed nothing committed (fields editable, same request id).
 * - sending: in flight; fields locked, closing blocked by the modal.
 * - frozen: the outcome is unknown. Every field stays locked and Retry replays the identical submission. A failed
 *   retry proves nothing about the earlier attempt, so only a success or a conflict ever leaves this state.
 * - conflict: the server says this operation already committed differently. Closeable, never editable.
 * - saved: the success path ran once.
 *
 * The frozen submission lives only in this hook's memory. Nothing here logs, toasts or stores it.
 */
export type SaleSubmissionPhase = "editing" | "sending" | "frozen" | "conflict" | "saved";

export interface SaleSubmissionState {
  phase: SaleSubmissionPhase;
  /** Message for the current phase (validation, rejection, unknown outcome, conflict). */
  message: string | null;
}

/** `saved` decides whether the modal runs its success path; phase/message describe the state otherwise. */
export interface SaleSubmitOutcome {
  saved: boolean;
  result: SaleHandoffResult | null;
  phase: SaleSubmissionPhase;
  message: string | null;
}

export interface SaleSubmission extends SaleSubmissionState {
  /** True whenever the form must not change (sending, frozen, conflict, saved). */
  locked: boolean;
  /** True while a frozen submission is waiting for a retry. */
  frozen: boolean;
  /**
   * Run one attempt. The callback receives the attempt (send tracker plus the frozen submission on a retry) and
   * must send through it. `saved` is true when the success path should run (result is null when the callback
   * completed without sending, e.g. a declined pre-save check that closes the modal as before).
   */
  submit: (run: (attempt: SaleAttempt) => Promise<SaleHandoffResult | void>) => Promise<SaleSubmitOutcome>;
  /** Back to editing for a newly opened modal (discards any frozen submission). */
  reset: () => void;
}

const INITIAL: SaleSubmissionState = { phase: "editing", message: null };

export function usePolicySaleSubmission(): SaleSubmission {
  const [state, setState] = useState<SaleSubmissionState>(INITIAL);
  const frozen = useRef<PreparedSale | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);

  const reset = useCallback(() => {
    generation.current += 1;
    frozen.current = null;
    busy.current = false;
    setState(INITIAL);
  }, []);

  const submit = useCallback(async (run: (attempt: SaleAttempt) => Promise<SaleHandoffResult | void>): Promise<SaleSubmitOutcome> => {
    if (busy.current) return { saved: false, result: null, phase: "sending", message: null };
    const retry = frozen.current;
    const attempt = newSaleAttempt(retry);
    const mine = generation.current;
    busy.current = true;
    setState({ phase: "sending", message: null });
    const settle = (next: SaleSubmissionState): SaleSubmitOutcome => {
      if (generation.current === mine) {
        busy.current = false;
        setState(next);
      }
      return { saved: false, result: null, phase: next.phase, message: next.message };
    };
    try {
      const returned = await run(attempt);
      const result: SaleHandoffResult | null = returned ? returned : attempt.result;
      if (generation.current !== mine) return { saved: false, result: null, phase: "editing", message: null };
      frozen.current = null;
      settle({ phase: "saved", message: null });
      return { saved: true, result, phase: "saved", message: null };
    } catch (failure) {
      if (generation.current !== mine) return { saved: false, result: null, phase: "editing", message: null };
      if (attempt.result) {
        // The server confirmed the sale; a later client-side failure must never present it as unsaved.
        frozen.current = null;
        settle({ phase: "saved", message: null });
        return { saved: true, result: attempt.result, phase: "saved", message: null };
      }
      const message = failure instanceof Error && failure.message ? failure.message : "Save failed";
      const errorClass = failure instanceof SaleRequestError ? failure.errorClass : attempt.sent ? "unknown" : "not_sent";
      if (errorClass === "conflict") {
        const prepared = attempt.prepared ?? retry;
        frozen.current = null;
        const status = prepared ? await readSaleOperationStatus(prepared) : ({ state: "unreadable" } as const);
        return settle({ phase: "conflict", message: conflictMessage(status) });
      }
      if (retry) {
        // Whatever this retry reports, the first attempt's outcome is still unknown: stay frozen.
        return settle({ phase: "frozen", message: `${FROZEN_MESSAGE} Last retry: ${message}` });
      }
      if (errorClass === "unknown") {
        frozen.current = attempt.prepared;
        return settle(attempt.prepared ? { phase: "frozen", message: `${FROZEN_MESSAGE} (${message})` } : { phase: "editing", message });
      }
      return settle({ phase: "editing", message });
    }
  }, []);

  return {
    ...state,
    locked: state.phase !== "editing",
    frozen: state.phase === "frozen",
    submit,
    reset,
  };
}
