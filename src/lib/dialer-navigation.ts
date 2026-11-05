/** Membership identity, not a mutable sorted-array index, owns the contact card. */
export interface QueueMember { id: string; lead_id?: string | null }
export interface DialerSelection<T extends QueueMember> { queue: T[]; selectedId: string | null }
export function selectQueue<T extends QueueMember>(queue: T[], selectedId: string | null): DialerSelection<T> {
  return { queue, selectedId: queue.some(lead => lead.id === selectedId) ? selectedId : null };
}
export function contactKey(lead: QueueMember | null): string {
  return lead ? String(lead.lead_id || lead.id) : "";
}
export function navigationBlockReason(input: {
  busy: boolean; callState: string; saving: boolean; draft: boolean;
}): string | null {
  if (input.busy) return "Please wait for the current action to finish.";
  if (["dialing", "active", "incoming"].includes(input.callState)) return "Finish the current call first.";
  if (input.saving) return "Please wait for the outcome to save.";
  if (input.draft) return "Save the current outcome before leaving this lead.";
  return null;
}
