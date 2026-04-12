/**
 * Live browser ring test: POST /v2/calls → sip:{profile.sip_username}@sip.telnyx.com
 *
 * Prerequisites:
 * - Agent logged into AgentFlow with dialer/WebRTC connected (same sip_username as DB).
 * - `.env` with VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_SERVICE_ROLE_KEY).
 *
 * Run: cd agentflow-life-insure && npx tsx scratch/test_webrtc_ring.ts
 *
 * Uses call_control_app_id in JSON `connection_id` (Telnyx requires Call Control App for POST /v2/calls).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const PROFILE_EMAIL = "cgarness.ffl@gmail.com";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey =
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing VITE_SUPABASE_URL and a service role key (VITE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY)."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: settings, error: settingsError } = await supabase
    .from("telnyx_settings")
    .select("api_key, call_control_app_id")
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (settingsError) {
    console.error("telnyx_settings fetch error:", settingsError);
    process.exit(1);
  }
  if (!settings?.api_key || !settings?.call_control_app_id) {
    console.error(
      "Missing api_key or call_control_app_id in telnyx_settings for org",
      ORG_ID,
    );
    process.exit(1);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("sip_username")
    .eq("email", PROFILE_EMAIL)
    .maybeSingle();

  if (profileError) {
    console.error("profiles fetch error:", profileError);
    process.exit(1);
  }
  if (!profile?.sip_username) {
    console.error("Missing sip_username for", PROFILE_EMAIL);
    process.exit(1);
  }

  const sipTo = `sip:${profile.sip_username}@sip.telnyx.com`;
  const payload = {
    connection_id: settings.call_control_app_id,
    to: sipTo,
    from: "+18005550199",
    audio: true,
  };

  console.log("Ring test — ensure WebRTC is connected in the browser, then watch for incoming call.");
  console.log("Dial payload:", payload);

  const res = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.api_key}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    parsed = rawText;
  }

  console.log("HTTP status:", res.status, res.statusText);
  console.log("Raw body:", rawText);
  console.log("Parsed JSON:", JSON.stringify(parsed, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
