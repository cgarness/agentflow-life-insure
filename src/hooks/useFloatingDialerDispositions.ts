import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";

export interface FloatingDisposition {
  id: string;
  name: string;
  color: string;
  require_notes: boolean;
  min_note_chars: number;
  callback_scheduler: boolean;
  automation_trigger: boolean;
  automation_id: string | null;
  pipeline_stage_id: string | null;
}

type Status = "unresolved" | "loading" | "ready" | "empty" | "error";
type Stage = { id: string; convert_to_client: boolean };
type Snapshot = {
  version: object;
  status: Status;
  dispositions: FloatingDisposition[];
  stages: Stage[];
};
const EMPTY_DISPOSITIONS: FloatingDisposition[] = [];
const EMPTY_STAGES: Stage[] = [];

/** Configuration is usable only when BOTH reads belong to the current identity/request. */
export function useFloatingDialerDispositions(organizationId: string | null, userId: string | null) {
  const scopeKey = organizationId && userId ? JSON.stringify([organizationId, userId]) : null;
  const [attempt, setAttempt] = useState(0);
  // A -> B -> A creates a new token even if the original A read is still pending.
  const version = useMemo(() => ({ scopeKey, attempt }), [scopeKey, attempt]);
  const currentVersion = useRef<object | null>(version);
  currentVersion.current = version;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    currentVersion.current = version;
    let active = true;
    if (organizationId && userId) {
      void Promise.allSettled([
        dispositionsSupabaseApi.getAll(organizationId),
        pipelineSupabaseApi.getLeadStages(organizationId),
      ]).then(([dispositions, stages]) => {
        if (!active || currentVersion.current !== version) return;
        if (dispositions.status === "rejected" || stages.status === "rejected") {
          setSnapshot({ version, status: "error", dispositions: [], stages: [] });
          return;
        }
        setSnapshot({
          version,
          status: dispositions.value.length ? "ready" : "empty",
          dispositions: dispositions.value.map(d => ({
            id: d.id, name: d.name, color: d.color,
            require_notes: d.requireNotes, min_note_chars: d.minNoteChars,
            callback_scheduler: d.callbackScheduler,
            automation_trigger: d.automationTrigger, automation_id: d.automationId ?? null,
            pipeline_stage_id: d.pipelineStageId ?? null,
          })),
          stages: stages.value.map(s => ({ id: s.id, convert_to_client: s.convertToClient })),
        });
      });
    }
    return () => {
      active = false;
      if (currentVersion.current === version) currentVersion.current = null;
    };
  }, [organizationId, userId, version]);

  // Withhold the previous snapshot during render, before effect cleanup/loading runs.
  const current = scopeKey && snapshot?.version === version ? snapshot : null;
  const status: Status = !scopeKey ? "unresolved" : current?.status ?? "loading";
  const isCurrent = useCallback(
    () => status === "ready" && currentVersion.current === version,
    [status, version],
  );
  const retry = useCallback(() => setAttempt(n => n + 1), []);

  return {
    scopeKey, version, status, isCurrent, retry,
    dispositions: current?.dispositions ?? EMPTY_DISPOSITIONS,
    pipelineStages: current?.stages ?? EMPTY_STAGES,
  };
}
