// email-unsubscribe — entry point. NOT DEPLOYED. See handler.ts for behaviour and
// docs/plans/2026-10-10-onboarding-emails/implementation_plan.md §11 for the approval-gated activation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createUnsubscribeHandler } from "./handler.ts";

const handler = createUnsubscribeHandler({
  getEnv: (name) => Deno.env.get(name),
  recordOptOut: async (userId) => {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await db.rpc("record_onboarding_email_opt_out", {
      p_user_id: userId,
      p_source: "unsubscribe_link",
    });
    if (error) throw new Error(`record_onboarding_email_opt_out: ${error.message}`);
    return data === true;
  },
  logger: console,
});

Deno.serve(handler);
