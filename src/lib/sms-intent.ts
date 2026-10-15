/** Reuse the same intent after a timeout/error. A confirmed acceptance completes it. */
export class SmsIntent {
  private pending = new Map<string, string>();
  id(payload: unknown) {
    const key = JSON.stringify(payload);
    let id = this.pending.get(key);
    if (!id) { id = crypto.randomUUID(); this.pending.set(key,id); }
    return id;
  }
  /** The unresolved request ID for this payload, without creating one. */
  peek(payload: unknown): string | undefined { return this.pending.get(JSON.stringify(payload)); }
  /** Completing an older attempt never removes a newer intent: pass its ID to delete only that one. */
  accepted(payload: unknown, id?: string) {
    const key = JSON.stringify(payload);
    if (id === undefined || this.pending.get(key) === id) this.pending.delete(key);
  }
  clear() { this.pending.clear(); }
  get size() { return this.pending.size; }
}
export type SmsPurpose = "" | "informational" | "marketing";
