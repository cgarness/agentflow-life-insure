/**
 * Inbound Calling v2 — D13 reader scope for "my missed calls" (implementation_plan.md rev 3 §3.2).
 * Pre-existing defect: readers filtered `agent_id = <me>`, which NEVER matches a missed row (a missed
 * call has no answering agent), so agents saw an empty widget. The scope now matches any of:
 *   agent_id (answered by me — never missed, kept for parity), missed_for_agent_id (the intended
 *   recipient), missed_recipient_ids (the durable snapshot), routed_agent_ids (legacy waves).
 * The user id is validated as a UUID BEFORE interpolation into the PostgREST `or` filter.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Returns the PostgREST `or` expression, or null when the id is not a UUID (caller must return no rows). */
export function buildMyMissedCallsOrFilter(userId: string | null | undefined): string | null {
  if (!isUuidLike(userId)) return null;
  const id = userId.toLowerCase();
  return `agent_id.eq.${id},missed_for_agent_id.eq.${id},missed_recipient_ids.cs.{${id}},routed_agent_ids.cs.{${id}}`;
}
