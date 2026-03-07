import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const decodeBase64 = (value: string | null) => {
  if (!value) return null;
  try {
    return atob(value);
  } catch {
    return null;
  }
};

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

    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "SUPABASE_URL or SUPABASE_ANON_KEY is not configured" }, 500);
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
      .select("calendar_id, access_token, sync_enabled")
      .eq("user_id", userData.user.id)
      .eq("provider", "google")
      .maybeSingle();

    if (integrationError) {
      return json({ error: integrationError.message }, 500);
    }

    if (!integration?.sync_enabled || !integration.access_token) {
      return json({ success: true, skipped: true, reason: "integration_disabled" });
    }

    const googleAccessToken = decodeBase64(integration.access_token);
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
        return json({ error: "Failed to create Google event", details: googleData }, 502);
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
        return json({ error: "Failed to update Google event", details: googleData }, 502);
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

      if (!googleResponse.ok && googleResponse.status !== 404) {
        const details = await googleResponse.text();
        return json({ error: "Failed to delete Google event", details }, 502);
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
