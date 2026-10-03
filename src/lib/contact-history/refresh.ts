/** A successful persisted mutation invalidates readers; it never manufactures an event. */
export interface HistoryInvalidation { organizationId: string; contactId?: string | null; contactType?: string | null }
const subscribers = new Set<(scope: HistoryInvalidation) => void>();
export function invalidateContactHistory(scope: HistoryInvalidation) {
  if (!scope.organizationId) return;
  for (const subscriber of subscribers) {
    try { subscriber(scope); } catch { /* A reader failure must never fail the saved mutation. */ }
  }
}
export function subscribeContactHistory(subscriber: (scope: HistoryInvalidation) => void) {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
