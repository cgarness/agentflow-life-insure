import { A2pError, type Db } from "../a2p/types.ts";
import { checked } from "../a2p/store.ts";
import { NUMBER_SID } from "./contracts.ts";

type AgencyNumber = { id: string; twilio_sid: string; phone_number: string };
export type TrustResult = { twilio_sid: string; ok: boolean; error?: string };

export function activeTrustAdmin(profile: { role: string | null; status: string | null }) {
  return profile.status === "Active" && (profile.role === "Admin" || profile.role === "Super Admin");
}

/** Resolve every submitted provider SID to active agency inventory before making any provider writes. */
export async function manualTrustScope(db: Db, org: string, input: unknown) {
  if (
    !Array.isArray(input) || input.length === 0 ||
    !input.every((v) => typeof v === "string" && NUMBER_SID.test(v.trim()))
  ) {
    throw new A2pError("INVALID_NUMBERS", "Select active agency phone numbers.", 400);
  }
  const ids = [...new Set(input.map((s: string) => s.trim()))];
  const legacy: AgencyNumber[] = [], excluded: TrustResult[] = [];
  for (let offset = 0; offset < ids.length; offset += 40) {
    const chunk = ids.slice(offset, offset + 40);
    const rows = checked(
      await db.from("phone_numbers").select("id,twilio_sid,phone_number")
        .eq("organization_id", org).in("status", ["active", "Active"]).in("twilio_sid", chunk),
    ) as AgencyNumber[];
    const items = await Promise.all(chunk.map(async (sid) => {
      const own = rows.filter((r) => r.twilio_sid === sid);
      if (own.length !== 1) return { sid, error: "This number is unavailable in your agency." };
      const proof = checked(
        await db.rpc("phone_number_setup_managed", { p_org: org, p_number: own[0].phone_number }),
      ) as { managed?: boolean; owned?: boolean } | null;
      if (typeof proof?.managed !== "boolean") {
        throw new A2pError("UNKNOWN_SETUP", "Could not verify phone number setup.", 503);
      }
      if (proof.managed) {
        return {
          sid,
          error: proof.owned === true
            ? "This purchase is managed automatically. Check its setup in Phone Numbers."
            : "This number is unavailable in your agency.",
        };
      }
      return { sid, number: own[0] };
    }));
    for (const item of items) {
      if (item.number) legacy.push(item.number);
      else excluded.push({ twilio_sid: item.sid, ok: false, error: item.error });
    }
  }
  return { legacy, excluded };
}
