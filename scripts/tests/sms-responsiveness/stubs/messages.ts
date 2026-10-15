// Fixture-only `@/lib/supabase-messages`: the real module, with the sidebar's list and deep-link
// lookup answered from the synthetic contact. The thread read stays real (it uses the stub client).
import * as real from "@fixture-real/supabase-messages";
import { FIXTURE } from "./supabase";

export * from "@fixture-real/supabase-messages";

const contact = {
  contact_id: FIXTURE.contact, contact_name: "Jordan Rivera", contact_type: "lead" as const, contact_phone: FIXTURE.phone,
  contact_email: "jordan@example.test", last_message: "Synthetic history", last_message_at: "2026-10-01T00:00:00Z",
  channel: "sms", direction: "inbound",
};

export const messagesSupabaseApi = {
  ...real.messagesSupabaseApi,
  getRecentConversations: async () => [contact],
  resolveScopedContact: async () => contact,
};
