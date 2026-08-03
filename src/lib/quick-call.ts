/**
 * quick-call — the ONE typed entry point for starting a call from a non-dialer surface.
 *
 * Canonical contract (read from the only listener, `FloatingDialer.tsx`):
 *   window.addEventListener("quick-call", handler)
 *   detail.phone      REQUIRED — the listener no-ops entirely without it
 *   detail.name       split on " " into first_name / last_name
 *   detail.contactId  -> selectedContact.id
 *   detail.type       'lead' | 'client' | 'recruit'; the listener DEFAULTS to 'lead' when omitted
 *   detail.fromNumber optional caller-ID override
 *
 * Why this module exists: three Dashboard widgets were dispatching a
 * `"agentflow:open-dialer"` event that has no listener anywhere, with a
 * `contactName` field the listener never reads and no `type` at all — so every
 * Dashboard call button was a silent no-op, and any that had worked would have
 * mislabelled clients and recruits as leads. Routing every dispatcher through
 * one typed helper makes the event name and the field names impossible to drift.
 *
 * This helper only ever dispatches the canonical browser event. It does NOT talk
 * to Twilio, does not create a `calls` row, and must never grow a second dial
 * path (no REST outbound, no two-legged dialing, no SIP, no `dialer-start-call`).
 * `TwilioContext` owns dialing; see AGENT_RULES §6 and invariant #9.
 */

/** Canonical event name consumed by `FloatingDialer`. */
export const QUICK_CALL_EVENT = "quick-call" as const;

/** Contact kinds the dialer understands — matches the `calls_contact_type_check` CHECK constraint. */
export type QuickCallContactType = "lead" | "client" | "recruit";

/** The exact `event.detail` shape `FloatingDialer` reads. */
export interface QuickCallDetail {
  /** Contact row id (a leads/clients/recruits id — never a `calls` row id). */
  contactId: string;
  /** Display name; the listener splits this on the first space. */
  name: string;
  /** Destination number. REQUIRED — without it the listener does nothing. */
  phone: string;
  /** Real contact kind. Never default a known client or recruit to "lead". */
  type: QuickCallContactType;
  /** Optional caller-ID override, when a surface has already chosen one. */
  fromNumber?: string;
}

/** True when `phone` carries at least one digit — the listener's minimum bar. */
export function hasDialablePhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && /\d/.test(phone);
}

/**
 * Dispatch the canonical `quick-call` event.
 *
 * Returns `true` only when the event was actually dispatched. Returns `false`
 * when `phone` is missing or has no digits — callers MUST surface that to the
 * user rather than reporting a call that never started.
 */
export function dispatchQuickCall(detail: QuickCallDetail): boolean {
  if (!hasDialablePhone(detail.phone)) return false;

  const payload: QuickCallDetail = {
    contactId: detail.contactId,
    name: detail.name,
    phone: detail.phone,
    type: detail.type,
    ...(detail.fromNumber ? { fromNumber: detail.fromNumber } : {}),
  };

  window.dispatchEvent(new CustomEvent(QUICK_CALL_EVENT, { detail: payload }));
  return true;
}
