/**
 * `phone_settings.api_secret` is a TEXT column used as a JSON bundle for org-level
 * phone flags. Twilio API Key Secret is stored here under `twilio_api_key_secret`
 * so it coexists with local presence and routing toggles (see TODO in PhoneSettings).
 */
export const TWILIO_API_KEY_SECRET_JSON_KEY = "twilio_api_key_secret" as const;

export type InboundRoutingStrategy = "assigned" | "all-ring" | "round-robin";

export type PhoneSettingsSecretBundle = {
  local_presence_enabled?: boolean;
  inbound_routing?: InboundRoutingStrategy;
  voicemail_enabled?: boolean;
  [TWILIO_API_KEY_SECRET_JSON_KEY]?: string;
};

const DEFAULT_ROUTING: InboundRoutingStrategy = "assigned";

export function parsePhoneSettingsSecretBundle(
  raw: string | null | undefined,
): PhoneSettingsSecretBundle {
  if (!raw?.trim()) {
    return {
      local_presence_enabled: true,
      inbound_routing: DEFAULT_ROUTING,
      voicemail_enabled: true,
    };
  }
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const b = o as PhoneSettingsSecretBundle;
      const rawRoute = b.inbound_routing ?? DEFAULT_ROUTING;
      const routing: InboundRoutingStrategy =
        rawRoute === "round-robin" ? DEFAULT_ROUTING : rawRoute === "all-ring" ? "all-ring" : "assigned";
      return {
        local_presence_enabled: b.local_presence_enabled !== false,
        inbound_routing: routing,
        voicemail_enabled: b.voicemail_enabled !== false,
        [TWILIO_API_KEY_SECRET_JSON_KEY]: b[TWILIO_API_KEY_SECRET_JSON_KEY] ?? "",
      };
    }
  } catch {
    /* legacy non-JSON value */
  }
  return {
    local_presence_enabled: true,
    inbound_routing: DEFAULT_ROUTING,
    voicemail_enabled: true,
  };
}

export function stringifyPhoneSettingsSecretBundle(bundle: PhoneSettingsSecretBundle): string {
  return JSON.stringify(bundle);
}
