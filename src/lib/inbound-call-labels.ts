/**
 * Inbound Calling v2 — D13 reader labels (implementation_plan.md rev 3 §3.2). ONE helper for every
 * surface that describes an inbound call's outcome (contact history, dashboard, notifications), so the
 * "Missed in AgentFlow — forwarded to mobile" classification reads the same everywhere and a mobile
 * conversation is never presented as an AgentFlow answer.
 */

export interface InboundCallOutcomeRow {
  direction?: string | null;
  is_missed?: boolean | null;
  missed_reason?: string | null;
  outcome?: string | null;
  agent_id?: string | null;
  answered_by_agent_id?: string | null;
  status?: string | null;
  voicemail_id?: string | null;
}

export type InboundOutcomeTone = "missed" | "answered" | "neutral";

export interface InboundCallOutcome {
  label: string;
  tone: InboundOutcomeTone;
  /** true when the call was classified missed in AgentFlow (D13), regardless of the mobile outcome. */
  missedInAgentFlow: boolean;
  /** true when the parent call was answered on the agent's mobile after the AgentFlow miss. */
  answeredOnMobile: boolean;
}

export const D13_LABEL_FORWARDED = "Missed in AgentFlow — forwarded to mobile";

const REASON_LABELS: Record<string, string> = {
  forwarded_to_mobile: D13_LABEL_FORWARDED,
  dnd: "Missed in AgentFlow — On Break / Do Not Disturb",
  busy: "Missed in AgentFlow — on another call",
  offline_no_mobile: "Missed in AgentFlow — offline, no mobile number",
  group_empty: "Missed in AgentFlow — no group member available",
  no_answer: "Missed in AgentFlow — not answered",
};

function isInbound(direction: string | null | undefined): boolean {
  const d = (direction || "").trim().toLowerCase();
  return d === "inbound" || d === "incoming";
}

export function describeInboundCallOutcome(row: InboundCallOutcomeRow): InboundCallOutcome {
  if (!isInbound(row.direction)) {
    return { label: "Outbound call", tone: "neutral", missedInAgentFlow: false, answeredOnMobile: false };
  }
  const missed = row.is_missed === true;
  const reason = (row.missed_reason || "").trim();
  const answeredOnMobile = (row.outcome || "").trim() === "forwarded_answered" && reason === "forwarded_to_mobile";
  if (missed) {
    const base = REASON_LABELS[reason] ?? "Missed call";
    const label = answeredOnMobile
      ? `${base} · answered on mobile`
      : row.voicemail_id
        ? `${base} · voicemail`
        : base;
    return { label, tone: "missed", missedInAgentFlow: true, answeredOnMobile };
  }
  if ((row.agent_id || "").trim()) {
    return { label: "Answered in AgentFlow", tone: "answered", missedInAgentFlow: false, answeredOnMobile: false };
  }
  if ((row.outcome || "").trim() === "forwarded_answered") {
    return { label: "Answered on forwarded number", tone: "answered", missedInAgentFlow: false, answeredOnMobile: false };
  }
  return { label: "Inbound call", tone: "neutral", missedInAgentFlow: false, answeredOnMobile: false };
}
