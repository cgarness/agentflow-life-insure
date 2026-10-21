/**
 * "Hide amounts" in the Commissions Center: a display preference for screen sharing, kept only in this browser and
 * scoped to the signed-in user and organization. It stores one flag, never a financial value, and it is not an
 * authorization boundary (the amounts are still sent to this authorized browser). Storage that is unavailable or
 * throws simply means "shown"; the toggle then lasts for the page only.
 */
const PREFIX = "agentflow.commissions.hideAmounts.v1";

export const amountsPreferenceKey = (userId: string, organizationId: string) => `${PREFIX}:${userId}:${organizationId}`;

export function readAmountsHidden(key: string | null): boolean {
  if (!key) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeAmountsHidden(key: string | null, hidden: boolean): void {
  if (!key) return;
  try {
    if (hidden) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* unavailable storage: the choice lasts for this page only */
  }
}

/** Other tabs of this browser changing the same identity's preference. */
export function onAmountsHiddenChange(key: string | null, listener: (hidden: boolean) => void): () => void {
  if (!key) return () => {};
  const handle = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener(readAmountsHidden(key));
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
