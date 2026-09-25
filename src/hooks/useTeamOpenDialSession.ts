import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { getCallStatus, type TwilioCall } from "@/lib/twilio-voice";
import { isVoiceSdkInboundDirection } from "@/lib/voiceSdkNotificationBranch";
import type { TeamOpenDialSession } from "@/lib/teamOpenReveal";

/**
 * useTeamOpenDialSession — which campaign lead THIS agent dialled outbound, and whether THAT call
 * attempt was answered. Display state only (Team/Open reveal); TwilioContext, the SDK, webhooks,
 * claim timing and telemetry are untouched.
 *
 * Answer evidence (rev 5 §8.2, verified read-only against @twilio/voice-sdk 2.18.1):
 *   an outbound Call emits `accept` only after the signaling `answer` AND open media
 *   (`_maybeTransitionToOpen`); media alone yields `ringing`. With the repo's
 *   `<Dial answerOnBridge="true">` Twilio sends that `answer` when the destination bridges.
 *   So the evidence is the `accept` of the attempt's OWN Call instance — or, if the hook first
 *   observes that instance already accepted, its SDK status `open`. A provider-level `active`
 *   caused by any other Call instance never counts. Precondition: answerOnBridge TwiML (unverified
 *   on the network; refusal paths that return an empty <Response> are unresolved).
 *
 * Attempt scoping:
 *   - A new attempt starts on every outbound transition into `dialing`; `answered` never carries
 *     over, even for a repeat dial of the same lead.
 *   - `currentCall` arrives after `dialing` (after the calls-row insert). The attempt binds the
 *     first outbound Call that is NOT the one present when the attempt began, and the first
 *     calls-row id that is NOT the previous one — nothing is borrowed from a prior attempt.
 *   - A confirmed-lock change to another lead (or loss) drops the attempt immediately.
 * The only listener added is this hook's own `accept` handler, removed by reference.
 */
interface Attempt extends TeamOpenDialSession {
  id: number;
  call: TwilioCall | null;
  prevCall: unknown;
  callRowId: string | null;
  prevCallRowId: string | null;
}

interface Args {
  enabled: boolean;
  callState: string;
  lastCallDirection: string;
  currentCall: TwilioCall | null | undefined;
  currentCallId: string | null;
  dialledCampaignLeadIdRef: MutableRefObject<string | null>;
  confirmedLockLeadId: string | null;
}

const isOutboundCall = (c: TwilioCall | null | undefined) => !!c && !isVoiceSdkInboundDirection((c as { direction?: string }).direction);
const safeStatus = (c: TwilioCall) => {
  try { return getCallStatus(c); } catch { return ""; }
};

export function useTeamOpenDialSession(a: Args): (TeamOpenDialSession & { attemptId: number; callRowId: string | null }) | null {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const seqRef = useRef(0);
  const prevStateRef = useRef(a.callState);
  const latest = useRef(a);
  latest.current = a;

  // New attempt on each outbound transition into `dialing`.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = a.callState;
    if (!a.enabled || a.callState !== "dialing" || prev === "dialing" || a.lastCallDirection !== "outbound") return;
    const id = latest.current.dialledCampaignLeadIdRef.current;
    setAttempt(id ? {
      id: ++seqRef.current, campaignLeadId: id, answered: false, call: null,
      prevCall: latest.current.currentCall ?? null, callRowId: null, prevCallRowId: latest.current.currentCallId,
    } : null);
  }, [a.enabled, a.callState, a.lastCallDirection]);

  // Bind the attempt's own Call instance (never the previous attempt's).
  useEffect(() => {
    const c = a.currentCall;
    setAttempt((s) => {
      if (!s || s.call || !c || c === s.prevCall || !isOutboundCall(c)) return s;
      return { ...s, call: c, answered: safeStatus(c) === "open" }; // already accepted when observed
    });
  }, [a.currentCall]);

  // Bind the calls-row id for this attempt (never the previous attempt's id).
  useEffect(() => {
    const rowId = a.currentCallId;
    setAttempt((s) => (!s || s.callRowId || !rowId || rowId === s.prevCallRowId ? s : { ...s, callRowId: rowId }));
  }, [a.currentCallId]);

  // Answer evidence: this attempt's Call instance emitting `accept`.
  const boundCall = attempt?.call ?? null;
  const attemptId = attempt?.id ?? 0;
  useEffect(() => {
    if (!boundCall) return;
    const onAccept = () => setAttempt((s) => (s && s.id === attemptId && s.call === boundCall ? { ...s, answered: true } : s));
    const target = boundCall as unknown as { on?: (e: string, f: () => void) => void; removeListener?: (e: string, f: () => void) => void; off?: (e: string, f: () => void) => void };
    target.on?.("accept", onAccept);
    if (safeStatus(boundCall) === "open") onAccept(); // accepted between bind and subscription
    return () => {
      if (target.removeListener) target.removeListener("accept", onAccept);
      else target.off?.("accept", onAccept);
    };
  }, [boundCall, attemptId]);

  // A lock change to another lead, or a lost lock, drops the attempt at once.
  useEffect(() => {
    setAttempt((s) => (s && s.campaignLeadId !== a.confirmedLockLeadId ? null : s));
  }, [a.confirmedLockLeadId]);

  useEffect(() => {
    if (!a.enabled) setAttempt(null);
  }, [a.enabled]);

  if (!attempt || !a.enabled) return null;
  // Render-time masking as well: never report a session for a lead that is not the confirmed lock.
  if (attempt.campaignLeadId !== a.confirmedLockLeadId) return null;
  return { campaignLeadId: attempt.campaignLeadId, answered: attempt.answered, attemptId: attempt.id, callRowId: attempt.callRowId };
}
