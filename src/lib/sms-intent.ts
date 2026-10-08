/** Reuse the same intent after a timeout/error. A confirmed acceptance completes it. */
export class SmsIntent {
  private pending = new Map<string, string>();
  id(payload: unknown) {
    const key = JSON.stringify(payload);
    let id = this.pending.get(key);
    if (!id) { id = crypto.randomUUID(); this.pending.set(key,id); }
    return id;
  }
  accepted(payload: unknown) { this.pending.delete(JSON.stringify(payload)); }
}
export type SmsPurpose = "" | "informational" | "marketing";
