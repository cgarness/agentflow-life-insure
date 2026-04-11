export interface RoutingSettings {
  id: string;
  organization_id: string;
  routing_mode: string;
  auto_create_lead: boolean;
  after_hours_sms_enabled: boolean;
  after_hours_sms: string;
  contacts_only: boolean;
  voicemail_greeting_url: string | null;
  ring_timeout_seconds: number;
}
