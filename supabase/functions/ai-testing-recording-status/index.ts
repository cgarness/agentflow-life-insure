// Optional recording callback for AI test calls — ack only (no CRM storage in POC).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSubaccountCreds } from "../_shared/twilioSubaccountCreds.ts";
import {
  twilioFormParams,
  validateTwilioSignature,
} from "../_shared/aiTestingTwilio.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) return new Response("ok");

  const params = await twilioFormParams(req.clone());
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return new Response("ok");

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: session } = await supabase
    .from("ai_test_sessions")
    .select("organization_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session?.organization_id) return new Response("ok");

  const credsResult = await loadSubaccountCreds(supabase, session.organization_id);
  if (!credsResult.ok) return new Response("ok");

  const valid = await validateTwilioSignature(
    req,
    credsResult.creds.authToken,
    params,
    "ai-testing-recording-status",
  );
  if (!valid) return new Response("Forbidden", { status: 403 });

  return new Response("ok");
});
