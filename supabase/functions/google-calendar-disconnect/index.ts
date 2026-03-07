import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const decodeBase64 = (value: string | null) => {
  if (!value) return null;
  try {
    return atob(value);
  } catch {
    return null;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) {
      return json({ error: "Missing Authorization header", provider: "google" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "SUPABASE_URL or SUPABASE_ANON_KEY is not configured", provider: "google" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Unable to verify authenticated user", provider: "google" }, 401);
    }

    const { data: integration, error: integrationError } = await supabase
      .from("calendar_integrations")
      .select("id, access_token, refresh_token")
      .eq("user_id", userData.user.id)
      .eq("provider", "google")
      .maybeSingle();

    if (integrationError) {
      return json(
        {
          error: "Failed to load existing Google integration",
          details: integrationError.message,
          provider: "google",
        },
        500,
      );
    }

    if (!integration) {
      return json({ success: true, provider: "google", message: "Google Calendar is already disconnected" });
    }

    const revokeToken = decodeBase64(integration.refresh_token) ?? decodeBase64(integration.access_token);

    if (revokeToken) {
      const revokeResponse = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: revokeToken }),
      });

      if (!revokeResponse.ok) {
        const rawBody = await revokeResponse.text();
        const isInvalidGrant = rawBody.includes("invalid_grant") || rawBody.includes("invalid_token");

        if (isInvalidGrant) {
          return json(
            {
              error: "Google grant is invalid or expired. Disconnect locally to clear stale integration.",
              details: rawBody,
              provider: "google",
            },
            400,
          );
        }

        return json(
          {
            error: "Failed to revoke Google token",
            details: rawBody,
            provider: "google",
          },
          502,
        );
      }
    }

    const { error: deleteError } = await supabase
      .from("calendar_integrations")
      .delete()
      .eq("user_id", userData.user.id)
      .eq("provider", "google");

    if (deleteError) {
      return json(
        {
          error: "Failed to remove Google integration row",
          details: deleteError.message,
          provider: "google",
        },
        500,
      );
    }

    return json({
      success: true,
      provider: "google",
      message: "Google Calendar disconnected successfully",
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        provider: "google",
      },
      500,
    );
  }
});
