// Pure, dependency-free routing/missed-call decision helpers for twilio-voice-inbound.
// Kept Deno-free so they are unit-tested under vitest (see src/lib/__tests__/inboundRouting.test.ts).
// Plan rev5: T17, T18, T21, T22, R14, D8 (all-ring now requires status='Active', superseding the
// 2026-05-19 scope freeze by explicit approval).

export interface RingTargets {
  identities: string[];
  agentIds: string[];
}

export const EMPTY_RING_TARGETS: RingTargets = { identities: [], agentIds: [] };

export interface ProfileRingRow {
  id: string;
  organization_id?: string | null;
  status?: string | null;
  twilio_client_identity?: string | null;
}

/**
 * T17/T18: the one eligibility rule for every wave — same organization, status='Active', and a
 * non-blank twilio_client_identity. Applied uniformly to all-ring, assigned/direct-line validation
 * results, and every fallback tier's collected rows (defense in depth for tier-collected ids).
 */
export function filterActiveRingTargets(
  rows: ProfileRingRow[] | null | undefined,
  organizationId: string,
): RingTargets {
  const eligible = (rows || []).filter(
    (r) =>
      !!r &&
      typeof r.id === "string" &&
      r.id.length > 0 &&
      (r.organization_id ?? null) === organizationId &&
      (r.status ?? "") === "Active" &&
      !!(r.twilio_client_identity || "").trim(),
  );
  return {
    identities: eligible.map((r) => (r.twilio_client_identity as string).trim()),
    agentIds: eligible.map((r) => r.id),
  };
}

/** T21: agents rung in an earlier wave (persisted routed_agent_ids) are never re-rung. */
export function excludeAlreadyRoutedAgents(
  targets: RingTargets,
  alreadyRouted: string[] | null | undefined,
): RingTargets {
  const seen = new Set((alreadyRouted || []).filter(Boolean));
  if (seen.size === 0) return targets;
  const identities: string[] = [];
  const agentIds: string[] = [];
  targets.agentIds.forEach((id, i) => {
    if (!seen.has(id)) {
      agentIds.push(id);
      identities.push(targets.identities[i]);
    }
  });
  return { identities, agentIds };
}

/** T18: assigned/direct-line owner must be a same-org Active profile with an identity — else null. */
export function validateAssignedProfile(
  row: ProfileRingRow | null | undefined,
  organizationId: string,
): string | null {
  const t = filterActiveRingTargets(row ? [row] : [], organizationId);
  return t.identities.length === 1 ? t.identities[0] : null;
}

export function isAnsweredDialStatus(dialCallStatus: string): boolean {
  const d = (dialCallStatus || "").trim().toLowerCase();
  return d === "completed" || d === "answered";
}

/** T22: a call is missed on a dial/forward return ONLY when that attempt was not answered. */
export function shouldMarkMissedOnDialReturn(dialCallStatus: string): boolean {
  return !isAnsweredDialStatus(dialCallStatus);
}

export type WavePlan =
  | { action: "ring"; targets: RingTargets }
  | { action: "voicemail" }
  | { action: "hangup" }
  | { action: "none" };

/**
 * R14: routed-agent persistence must PRECEDE ringing. A wave rings only when its exact agent ids were
 * durably persisted (append_call_routed_agents returned true). On persistence failure the wave is
 * suppressed and the caller takes the deterministic safe path — voicemail when enabled, else the
 * documented terminal infrastructure-failure path (hangup) — with actionable telemetry.
 */
export function buildWavePlan(
  targets: RingTargets,
  routedPersisted: boolean,
  opts: { voicemailEnabled: boolean },
): WavePlan {
  if (targets.identities.length === 0) return { action: "none" };
  if (routedPersisted) return { action: "ring", targets };
  return opts.voicemailEnabled ? { action: "voicemail" } : { action: "hangup" };
}
