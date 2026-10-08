import { SmsError } from "./wire.ts";
export function confirmationBody(sender: string, purposes: string[]) {
  if (
    sender !== "CG Financial" || !purposes.length ||
    purposes.some((x) => !["informational", "marketing"].includes(x))
  ) {
    throw new SmsError(
      "CONFIRMATION_MAPPING",
      "Confirmation wording needs review.",
    );
  }
  const scope = purposes.length === 2
    ? "informational and marketing"
    : purposes[0];
  return `CG Financial: You're subscribed to ${scope} texts. Message frequency varies. Msg & data rates may apply. Reply HELP for help or call 909-775-6963. Reply STOP to opt out.`;
}
