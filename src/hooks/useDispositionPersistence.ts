import { useCallback, useRef } from "react";
import { persistDisposition, type DispositionInput } from "@/lib/dialer-disposition";

/** Retry the exact operation after a network failure; release choice is not a second save. */
export function useDispositionPersistence() {
  const operations = useRef(new Map<string, { fingerprint: string; operationId: string }>());
  return useCallback(async (input: Omit<DispositionInput, "operationId"> & { visitKey?: string }) => {
    const scope = input.callId ?? input.visitKey ?? input.campaignLeadId ?? "standalone";
    const { releaseLock: _release, expectedVersion: _version, ...payload } = input;
    const fingerprint = JSON.stringify(payload);
    const prior = operations.current.get(scope);
    // A changed draft after a failed (uncommitted) save is a new operation. Server
    // per-call receipts still reject changes after a committed save/ambiguous response.
    const operationId = prior?.fingerprint === fingerprint ? prior.operationId : crypto.randomUUID();
    operations.current.set(scope, { fingerprint, operationId });
    return persistDisposition({ ...input, operationId });
  }, []);
}
