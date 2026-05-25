import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken, encodeToken, refreshGoogleAccessToken } from "../_shared/google-token.ts";

type SyncAction = "create" | "update" | "delete";

interface SyncPayload {
  action: SyncAction;
  appointment_id: string;
  title?: string;
  notes?: string | null;
  start_time?: string;
  end_time?: string | null;
  attendee_email?: string | null;
  external_event_id?: string | null;
}

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

const buildGoogleEventPayload = (payload: SyncPayload) => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return {
    summary: payload.title,
    description: payload.notes ?? undefined,
    start: {
      dateTime: payload.start_time,
      timeZone,
    },
    end: {
      dateTime: payload.end_time,
      timeZone,
    },
    attendees: payload.attendee_email ? [{ email: payload.attendee_email }] : undefined,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ error: "SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Unable to verify authenticated user" }, 401);
    }

    const body = (await req.json()) as SyncPayload;

    if (!body?.action || !body?.appointment_id) {
      return json({ error: "Missing action or appointment_id" }, 400);
    }

    // Pass 1a RLS gates this SELECT — caller can only see appointments in their org
    // they're authorized for. Org/user authorization is therefore enforced by RLS, not
    // duplicated in code here.
    const { data: localAppointment, error: localAppointmentError } = await supabase
      .from("appointments")
      .select("id, sync_source, external_provider, external_event_id")
      .eq("id", body.appointment_id)
      .maybeSingle();

    if (localAppointmentError) {
      return json({ error: `Failed to load appointment metadata: ${localAppointmentError.message}` }, 500);
    }

    if (!localAppointment?.id) {
      return json({ error: "Appointment not found" }, 404);
    }

    if (
      localAppointment.sync_source === "external" &&
      localAppointment.external_provider === "google" &&
      (body.action === "create" || !body.external_event_id || localAppointment.external_event_id === body.external_event_id)
    ) {
      return json({ success: true, skipped: true, reason: "loop_prevention_external_source" });
    }

    const { data: integration, error: integrationError } = await supabase
      .from("calendar_integrations")
      .select("id, calendar_id, access_token, refresh_token, token_expires_at, sync_enabled")
      .eq("user_id", userData.user.id)
      .eq("provider", "google")
      .maybeSingle();

    if (integrationError) {
      return json({ error: integrationError.message }, 500);
    }

    if (!integration?.sync_enabled || !integration.access_token) {
      return json({ success: true, skipped: true, reason: "integration_disabled" });
    }

    // Calendar Pass 3 (B3): standardized token envelope. decodeToken tolerates legacy
    // raw tokens (Codex-era rows) and current base64-encoded ones. Refresh path mirrors
    // inbound-sync so a near-expired token gets refreshed before the outbound call —
    // previously this function would call Google with whatever was in the DB and 401.
    let googleAccessToken = decodeToken(integration.access_token);
    const refreshToken = decodeToken(integration.refresh_token);
    const expiresAtMs = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
    const isExpiredOrMissing = !googleAccessToken || !expiresAtMs || expiresAtMs <= Date.now() + 60_000;

    if (isExpiredOrMissing) {
      if (!refreshToken || !googleClientId || !googleClientSecret) {
        return json({ error: "Google integration token is invalid or refresh credentials are unavailable" }, 400);
      }

      try {
        const refreshed = await refreshGoogleAccessToken({
          refreshToken,
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        });
        googleAccessToken = refreshed.accessToken;

        const serviceClient = createClient(supabaseUrl, serviceRoleKey);
        await serviceClient
          .from("calendar_integrations")
          .update({
            access_token: encodeToken(refreshed.accessToken),
            token_expires_at: refreshed.expiresAt,
          })
          .eq("id", integration.id);
      } catch (refreshError) {
        return json(
          { error: refreshError instanceof Error ? refreshError.message : "Failed to refresh Google token" },
          400,
        );
      }
    }

    if (!googleAccessToken) {
      return json({ error: "Google integration token is invalid" }, 400);
    }

    const calendarId = integration.calendar_id || "primary";
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    if (body.action === "create") {
      if (!body.title || !body.start_time || !body.end_time) {
        return json({ error: "Missing create payload fields" }, 400);
      }

      const googleResponse = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${googleAccessToken}`,
        },
        body: JSON.stringify(buildGoogleEventPayload(body)),
      });

      const googleData = await googleResponse.json();
      if (!googleResponse.ok) {
        return json({ error: "Failed to create Google event", details: googleData?.error?.message ?? googleResponse.statusText }, 502);
      }

      const { error: updateError } = await supabase
        .from("appointments")
        .update({
          external_provider: "google",
          external_event_id: googleData.id,
          external_last_synced_at: new Date().toISOString(),
          sync_source: "internal",
        })
        .eq("id", body.appointment_id);

      if (updateError) {
        return json({ error: "Google event created but appointment metadata update failed", details: updateError.message }, 500);
      }

      return json({ success: true, action: "create", external_event_id: googleData.id });
    }

    if (body.action === "update") {
      const eventId = body.external_event_id;
      if (!eventId || !body.title || !body.start_time || !body.end_time) {
        return json({ error: "Missing update payload fields" }, 400);
      }

      const googleResponse = await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${googleAccessToken}`,
        },
        body: JSON.stringify(buildGoogleEventPayload(body)),
      });

      const googleData = await googleResponse.json();
      if (!googleResponse.ok) {
        return json({ error: "Failed to update Google event", details: googleData?.error?.message ?? googleResponse.statusText }, 502);
      }

      const { error: updateError } = await supabase
        .from("appointments")
        .update({
          external_last_synced_at: new Date().toISOString(),
          sync_source: "internal",
        })
        .eq("id", body.appointment_id);

      if (updateError) {
        return json({ error: "Google event updated but appointment metadata update failed", details: updateError.message }, 500);
      }

      return json({ success: true, action: "update", external_event_id: eventId });
    }

    if (body.action === "delete") {
      const eventId = body.external_event_id;
      if (!eventId) {
        return json({ success: true, skipped: true, reason: "missing_external_event_id" });
      }

      const googleResponse = await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      });

      if (!googleResponse.ok && googleResponse.status !== 404 && googleResponse.status !== 410) {
        return json({ error: "Failed to delete Google event", details: `HTTP ${googleResponse.status}` }, 502);
      }

      const { error: updateError } = await supabase
        .from("appointments")
        .update({
          external_last_synced_at: new Date().toISOString(),
          external_event_id: null,
          sync_source: "internal",
        })
        .eq("id", body.appointment_id);

      if (updateError) {
        return json({ error: "Google event deleted but appointment metadata update failed", details: updateError.message }, 500);
      }

      return json({ success: true, action: "delete" });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
