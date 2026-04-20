import { z } from "zod";

export const twilioCredentialsFormSchema = z.object({
  accountSid: z
    .string()
    .min(1, "Account SID is required")
    .regex(/^AC[a-zA-Z0-9]{32}$/, "Use a valid Twilio Account SID (starts with AC)"),
  authToken: z.string().min(1, "Auth token is required"),
  apiKeySid: z
    .string()
    .min(1, "API Key SID is required")
    .regex(/^SK[a-zA-Z0-9]{32}$/, "Use a valid API Key SID (starts with SK)"),
  apiKeySecret: z.string().min(1, "API Key secret is required"),
  applicationSid: z
    .string()
    .min(1, "TwiML App SID is required")
    .regex(/^AP[a-zA-Z0-9]{32}$/, "Use a valid TwiML App SID (starts with AP)"),
});

export type TwilioCredentialsFormValues = z.infer<typeof twilioCredentialsFormSchema>;
