import type { Db } from "../a2p/types.ts";
import { checked } from "./consent.ts";
import { SmsError } from "./wire.ts";
export type AffinityMode = "off" | "shadow" | "enforced" | "guard_only";
export const isGuarded = (mode: AffinityMode) => mode === "enforced" || mode === "guard_only";
/** A failed/missing guard read is an error, never legacy-send authority. */
export async function affinityGuard(db: Db, org: string): Promise<{ voice: AffinityMode; sms: AffinityMode }> {
  const result = checked(await db.rpc("sticky_number_guard", { p_org: org }));
  const modes = ["off", "shadow", "enforced", "guard_only"];
  if (!result || !modes.includes(result.voice) || !modes.includes(result.sms)) {
    throw new SmsError("AFFINITY_UNAVAILABLE", "Number settings could not be verified. Try again after refreshing.", 503);
  }
  return result;
}
export async function cancelPrepared(db: Db, org: string, key: string) {
  // A false CAS means an attempt may already have started. Never overwrite that state.
  return checked(await db.rpc("sms_cancel_prepared_dispatch", { p_org: org, p_key: key }));
}
