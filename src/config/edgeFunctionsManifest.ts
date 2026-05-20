export type EdgeFunctionCategory =
  | "Voice"
  | "SMS"
  | "Email"
  | "Workflows"
  | "Agency Groups"
  | "Google Calendar"
  | "Auth & Users"
  | "AI Testing"
  | "Admin";

export interface EdgeFunctionEntry {
  name: string;
  category: EdgeFunctionCategory;
  description?: string;
}

export const EDGE_FUNCTIONS_MANIFEST: EdgeFunctionEntry[] = [
  { name: "twilio-token", category: "Voice", description: "Voice JWT for WebRTC Device" },
  { name: "twilio-voice-webhook", category: "Voice" },
  { name: "twilio-voice-inbound", category: "Voice" },
  { name: "twilio-voice-status", category: "Voice" },
  { name: "twilio-recording-status", category: "Voice" },
  { name: "twilio-buy-number", category: "Voice" },
  { name: "twilio-search-numbers", category: "Voice" },
  { name: "twilio-trust-hub", category: "Voice" },
  { name: "twilio-reputation-check", category: "Voice" },
  { name: "inbound-call-claim", category: "Voice" },
  { name: "recording-retention-purge", category: "Voice" },
  { name: "twilio-sms", category: "SMS" },
  { name: "twilio-sms-webhook", category: "SMS" },
  { name: "update-sms-urls", category: "SMS", description: "Super Admin webhook patch" },
  { name: "email-connect-start", category: "Email" },
  { name: "email-connect-callback", category: "Email" },
  { name: "email-disconnect", category: "Email" },
  { name: "email-sync-incremental", category: "Email" },
  { name: "email-send-contact-message", category: "Email" },
  { name: "workflow-executor", category: "Workflows" },
  { name: "workflow-trigger-evaluator", category: "Workflows" },
  { name: "workflow-time-based-trigger", category: "Workflows" },
  { name: "workflow-resume-paused", category: "Workflows" },
  { name: "invite-to-agency-group", category: "Agency Groups" },
  { name: "accept-agency-group-invite", category: "Agency Groups" },
  { name: "leave-agency-group", category: "Agency Groups" },
  { name: "remove-from-agency-group", category: "Agency Groups" },
  { name: "google-oauth-start", category: "Google Calendar" },
  { name: "google-oauth-callback", category: "Google Calendar" },
  { name: "google-calendar-configure", category: "Google Calendar" },
  { name: "google-calendar-disconnect", category: "Google Calendar" },
  { name: "google-calendar-list", category: "Google Calendar" },
  { name: "google-calendar-status", category: "Google Calendar" },
  { name: "google-calendar-sync-appointment", category: "Google Calendar" },
  { name: "google-calendar-inbound-sync", category: "Google Calendar" },
  { name: "create-user", category: "Auth & Users" },
  { name: "create-organization", category: "Auth & Users" },
  { name: "accept-invite", category: "Auth & Users" },
  { name: "invite-user", category: "Auth & Users" },
  { name: "send-invite-email", category: "Auth & Users" },
  { name: "send-welcome-email", category: "Auth & Users" },
  { name: "import-contacts", category: "Auth & Users" },
  { name: "provision-twilio-subaccount", category: "Admin" },
  { name: "retry-twilio-provisioning", category: "Admin" },
  { name: "daily-briefing", category: "Admin" },
  { name: "daily-tip", category: "Admin" },
  { name: "ai-testing-place-call", category: "AI Testing" },
  { name: "ai-testing-end-call", category: "AI Testing" },
  { name: "ai-testing-status", category: "AI Testing" },
  { name: "ai-testing-twiml", category: "AI Testing" },
  { name: "ai-testing-recording-status", category: "AI Testing" },
  { name: "ai-testing-relay-ws", category: "AI Testing" },
  { name: "ai-testing-stream-ws", category: "AI Testing" },
];
