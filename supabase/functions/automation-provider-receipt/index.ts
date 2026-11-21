import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleReceipt } from "../_shared/automations/receiptHandler.ts";

Deno.serve((req) =>
  handleReceipt(
    req,
    createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    ),
    Deno.env.get("AUTOMATION_RESEND_WEBHOOK_SECRET"),
  )
);
