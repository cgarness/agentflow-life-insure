// onboarding-email-worker — entry point. NOT DEPLOYED. See handler.ts for the gates and
// docs/plans/2026-10-10-onboarding-emails/implementation_plan.md §11 for the approval-gated activation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createResendMailer, createSupabaseStore } from "../_shared/onboardingEmail/delivery.ts";
import { createOnboardingWorkerHandler } from "./handler.ts";

const handler = createOnboardingWorkerHandler({
  getEnv: (name) => Deno.env.get(name),
  createStore: () =>
    createSupabaseStore(
      createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
    ),
  createMailer: (apiKey) => createResendMailer(apiKey),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger: console,
});

Deno.serve(handler);
