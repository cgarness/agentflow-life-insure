import type { Db } from "../a2p/types.ts";
import { checked, type Policy } from "./consent.ts";
import { phone, SmsError } from "./wire.ts";

/** Manual texting may use a different sender from the dialer's voice caller ID. */
export async function manualSender(
  db: Db,
  p: Policy,
  preferred: string,
): Promise<string> {
  const registration = checked(
    await db.from("a2p_registrations").select("messaging_service_sid")
      .eq("organization_id", p.organization_id).maybeSingle(),
  );
  if (!registration?.messaging_service_sid) {
    throw new SmsError(
      "A2P_NOT_READY",
      "No registered SMS number is available.",
    );
  }
  const mappings = checked(
    await db.from("a2p_numbers").select("phone_number_id")
      .eq("organization_id", p.organization_id)
      .eq("messaging_service_sid", registration.messaging_service_sid)
      .eq("status", "registered"),
  ) as { phone_number_id: string }[];
  const registeredIds = new Set(mappings.map((item) => item.phone_number_id));
  const ids = p.selected_phone_ids.filter((id) => registeredIds.has(id));
  if (!ids.length) {
    throw new SmsError(
      "SENDER_NOT_SELECTED",
      "No registered SMS number is available.",
    );
  }
  const numbers = checked(
    await db.from("phone_numbers").select("id,phone_number,is_default")
      .eq("organization_id", p.organization_id).eq("assignment_type", "agency")
      .in("status", ["active", "Active"]).in("id", ids)
      .order("is_default", { ascending: false }).order("id"),
  ) as { id: string; phone_number: string; is_default: boolean }[];
  if (!numbers.length) {
    throw new SmsError(
      "SENDER_NOT_SELECTED",
      "No active SMS number is available.",
    );
  }
  let requested: string | undefined;
  try {
    requested = preferred ? phone(preferred) : undefined;
  } catch {
    // A stale voice caller ID must not prevent use of the agency SMS default.
  }
  return numbers.find((number) => number.phone_number === requested)
    ?.phone_number ??
    numbers[0].phone_number;
}
