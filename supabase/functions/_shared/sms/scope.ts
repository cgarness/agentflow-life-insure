import type { Db } from "../a2p/types.ts";
import { checked, type Policy } from "./consent.ts";
import { phone, SmsError, UUID } from "./wire.ts";
import { manualSender } from "./manual.ts";
export async function contactScope(
  caller: Db,
  org: string,
  id: unknown,
  type: unknown,
  recipient?: string,
) {
  const table = type === "lead"
    ? "leads"
    : type === "client"
    ? "clients"
    : type === "recruit"
    ? "recruits"
    : null;
  if (typeof id !== "string" || !UUID.test(id) || !table) {
    throw new SmsError("CONTACT_SCOPE", "Select an accessible contact.", 403);
  }
  const contact = checked(
    await caller.from(table).select("id,phone,organization_id").eq("id", id).eq(
      "organization_id",
      org,
    ).maybeSingle(),
  );
  if (!contact || (recipient && phone(contact.phone) !== phone(recipient))) {
    throw new SmsError(
      "CONTACT_CHANGED",
      "Contact access or phone changed. Reload before sending.",
      403,
    );
  }
  return contact;
}
export async function selectedSender(db: Db, p: Policy): Promise<string> {
  return await manualSender(db, p, "");
}
