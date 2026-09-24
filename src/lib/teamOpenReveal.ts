/**
 * teamOpenReveal — the Team / Open Pool staged-reveal gate, as pure functions.
 *
 * Personal campaigns never reach this module (they always receive "connected"). For Team/Open the
 * existing stages are preserved — idle → skeleton, ringing → partial `LeadCardBlurred`, connected →
 * full card — and the server-confirmed lock requirement is unchanged. Display-state corrections
 * only (plan §4.3-5, D-8); no queue, lock or ownership behaviour changes here:
 *
 *   1. Full details show only for the lead THIS agent dialled in the current outbound session
 *      (`dialSession.campaignLeadId === displayed campaign_leads.id`). A lock-loss reload that
 *      swaps in another lead mid-call or mid-wrap-up can therefore never reveal it.
 *   2. Inbound activity never satisfies the outbound gate.
 *   3. An unanswered outbound call never flashes full details at `ended`.
 *
 * "Answered" reuses the dialer's existing definition (outbound reached `active` — the same signal
 * `callWasAnswered` uses to choose wrap-up over the silent No Answer path).
 */
export type CallStatus = "idle" | "ringing" | "connected";

export interface TeamOpenDialSession {
  /** `campaign_leads.id` dialled by this agent (queue / lock identity). */
  campaignLeadId: string;
  /** True once that outbound call reached `active`. */
  answered: boolean;
}

export interface TeamOpenRevealInput {
  currentCampaignLeadId: string | null;
  confirmedLockLeadId: string | null;
  callState: string;
  inboundActive: boolean;
  dialSession: TeamOpenDialSession | null;
  showWrapUp: boolean;
}

export function computeTeamOpenCallStatus(i: TeamOpenRevealInput): CallStatus {
  if (!i.currentCampaignLeadId) return "idle";
  // Unchanged strict gate: never reveal unless this lead's lock is server-confirmed for this agent.
  if (i.confirmedLockLeadId !== i.currentCampaignLeadId) return "idle";
  if (i.inboundActive) return "idle";
  const session = i.dialSession;
  if (!session || session.campaignLeadId !== i.currentCampaignLeadId) return "idle";
  if (i.callState === "dialing") return "ringing";
  if (i.callState === "active") return session.answered ? "connected" : "ringing";
  if (i.callState === "ended") return session.answered ? "connected" : "idle";
  if (i.showWrapUp && session.answered) return "connected";
  return "idle";
}

/** An outbound dial started for `dialledCampaignLeadId` (null when no campaign lead was dialled). */
export function dialSessionOnDialing(dialledCampaignLeadId: string | null): TeamOpenDialSession | null {
  return dialledCampaignLeadId ? { campaignLeadId: dialledCampaignLeadId, answered: false } : null;
}

/** The outbound call reached `active`; only the session for that same dialled lead is marked. */
export function dialSessionOnAnswered(
  prev: TeamOpenDialSession | null,
  dialledCampaignLeadId: string | null,
): TeamOpenDialSession | null {
  if (!prev || prev.answered || prev.campaignLeadId !== dialledCampaignLeadId) return prev;
  return { ...prev, answered: true };
}

/** The confirmed lock changed: a session for any other lead (or a lost lock) is dropped at once. */
export function dialSessionOnLockChange(
  prev: TeamOpenDialSession | null,
  confirmedLockLeadId: string | null,
): TeamOpenDialSession | null {
  if (!prev) return prev;
  return prev.campaignLeadId === confirmedLockLeadId ? prev : null;
}

/** Inbound activity: an incoming ring, or any non-idle state while the live/last call is inbound. */
export function isInboundActivity(callState: string, lastCallDirection: string, callIsInbound: boolean): boolean {
  if (callState === "incoming") return true;
  if (callState === "idle") return false;
  return lastCallDirection === "inbound" || callIsInbound;
}
