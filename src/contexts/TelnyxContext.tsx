// DEPRECATED — replaced by TwilioContext.tsx in Phase 7 (Twilio migration). Will be deleted in Phase 13 cleanup.
// Use `import { useTwilio, TwilioProvider } from "@/contexts/TwilioContext"` in new code.

export type {
  TwilioContextValue as TelnyxContextValue,
  MakeCallOptions,
  IdentifiedContact,
  CallState,
  SmartCallerIdOptions,
} from "./TwilioContext";

export { TwilioProvider as TelnyxProvider, useTwilio as useTelnyx } from "./TwilioContext";
