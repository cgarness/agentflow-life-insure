import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type GoogleEventDateTime = {
  dateTime?: string;
  date?: string;
};

type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
};

type GoogleEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  error?: { message?: string };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

const toIso = (input?: GoogleEventDateTime, fallback?: string) => {
  if (!input) return fallback ?? new Date().toISOString();

  if (input.dateTime) {
    const parsed = new Date(input.dateTime);
    return Number.isNaN(parsed.getTime()) ? fallback ?? new Date().toISOString() : parsed.toISOString();
  }

  if (input.date) {
    const parsed = new Date(`${input.date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? fallback ?? new Date().toISOString() : parsed.toISOString();
  }

  return fallback ?? new Date().toISOString();
};

const refreshGoogleToken = async (params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error_description ?? payload?.error ?? "Failed to refresh Google token");
  }

  if (!payload?.access_token || !payload?.expires_in) {
    throw new Error("Google refresh response is missing access_token or expires_in");
  }

  return {
    accessToken: payload.access_token as string,
    expiresAt: new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString(),
  };
};

const listGoogleEvents = async (params: {
  calendarId: string;
  accessToken: string;
  lastSyncToken: string | null;
  pageToken: string | null;
}) => {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
  );

  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("showDeleted", "true");
  url.searchParams.set("maxResults", "250");

  if (params.pageToken) {
    url.searchParams.set("pageToken", params.pageToken);
  }

  if (params.lastSyncToken) {
    url.searchParams.set("syncToken", params.lastSyncToken);
  } else {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    url.searchParams.set("timeMin", ninetyDaysAgo);
    url.searchParams.set("orderBy", "updated");
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  const payload = (await response.json()) as GoogleEventsResponse;

  if (!response.ok) {
    const details = payload?.error?.message || JSON.stringify(payload);
    const error = new Error(`Google events API failed (${response.status}): ${details}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return payload;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const requiredCronSecret = Deno.env.get("GOOGLE_SYNC_CRON_SECRET");
    if (requiredCronSecret) {
      const incomingSecret = req.headers.get("x-cron-secret");
      if (incomingSecret !== requiredCronSecret) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);
    }

    if (!googleClientId || !googleClientSecret) {
      return json({ error: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: integrations, error: integrationsError } = await supabase
      .from("calendar_integrations")
      .select("id, user_id, provider, calendar_id, access_token, refresh_token, token_expires_at, last_sync_token")
      .eq("provider", "google")
      .eq("sync_enabled", true);

    if (integrationsError) {
      return json({ error: integrationsError.message }, 500);
    }

    const summary = {
      users_scanned: integrations?.length ?? 0,
      users_synced: 0,
      imported: 0,
      updated: 0,
      cancelled: 0,
      errors: [] as string[],
      conflict_strategy: "google_wins",
    };

    for (const integration of integrations ?? []) {
      try {
        let accessToken = decodeBase64(integration.access_token);
        const refreshToken = decodeBase64(integration.refresh_token);

        const expiresAtMs = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
        const isExpiredOrMissing = !accessToken || !expiresAtMs || expiresAtMs <= Date.now() + 60_000;

        if (isExpiredOrMissing) {
          if (!refreshToken) {
            throw new Error("Missing refresh token for expired Google integration");
          }

          const refreshed = await refreshGoogleToken({
            refreshToken,
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          });

          accessToken = refreshed.accessToken;

          const { error: refreshPersistError } = await supabase
            .from("calendar_integrations")
            .update({
              access_token: btoa(refreshed.accessToken),
              token_expires_at: refreshed.expiresAt,
            })
            .eq("id", integration.id);

          if (refreshPersistError) {
            throw new Error(`Failed to persist refreshed token: ${refreshPersistError.message}`);
          }
        }

        if (!accessToken) {
          throw new Error("Google access token is missing or invalid");
        }

        const calendarId = integration.calendar_id || "primary";
        let pageToken: string | null = null;
        let nextSyncToken: string | null = null;

        do {
          let eventsPage: GoogleEventsResponse;

          try {
            eventsPage = await listGoogleEvents({
              calendarId,
              accessToken,
              lastSyncToken: integration.last_sync_token,
              pageToken,
            });
          } catch (error) {
            const status = (error as Error & { status?: number }).status;

            // Incremental token is stale/invalid. Fall back to a full sync window.
            if (status === 410 && integration.last_sync_token) {
              integration.last_sync_token = null;
              pageToken = null;
              eventsPage = await listGoogleEvents({
                calendarId,
                accessToken,
                lastSyncToken: null,
                pageToken: null,
              });
            } else {
              throw error;
            }
          }

          for (const event of eventsPage.items ?? []) {
            if (!event.id) continue;

            const { data: existingAppointment, error: existingError } = await supabase
              .from("appointments")
              .select("id")
              .eq("user_id", integration.user_id)
              .eq("external_provider", "google")
              .eq("external_event_id", event.id)
              .maybeSingle();

            if (existingError) {
              throw new Error(`Failed lookup for event ${event.id}: ${existingError.message}`);
            }

            const syncTime = new Date().toISOString();

            if (event.status === "cancelled") {
              if (!existingAppointment?.id) continue;

              const { error: cancelError } = await supabase
                .from("appointments")
                .update({
                  status: "Cancelled",
                  sync_source: "external",
                  external_provider: "google",
                  external_last_synced_at: syncTime,
                })
                .eq("id", existingAppointment.id);

              if (cancelError) {
                throw new Error(`Failed to mark cancelled event ${event.id}: ${cancelError.message}`);
              }

              summary.cancelled += 1;
              continue;
            }

            const startTime = toIso(event.start);
            const endTime = toIso(event.end, startTime);

            const appointmentPayload = {
              user_id: integration.user_id,
              title: event.summary || "Google Calendar Event",
              notes: event.description ?? null,
              type: "Other",
              status: "Scheduled",
              start_time: startTime,
              end_time: endTime,
              external_provider: "google",
              external_event_id: event.id,
              external_last_synced_at: syncTime,
              sync_source: "external",
            };

            // Conflict strategy: Google wins. Existing rows linked to Google are overwritten with Google values.
            if (existingAppointment?.id) {
              const { error: updateError } = await supabase
                .from("appointments")
                .update(appointmentPayload)
                .eq("id", existingAppointment.id);

              if (updateError) {
                throw new Error(`Failed to update appointment for event ${event.id}: ${updateError.message}`);
              }

              summary.updated += 1;
            } else {
              const { error: insertError } = await supabase.from("appointments").insert([appointmentPayload]);

              if (insertError) {
                throw new Error(`Failed to insert appointment for event ${event.id}: ${insertError.message}`);
              }

              summary.imported += 1;
            }
          }

          pageToken = eventsPage.nextPageToken ?? null;
          nextSyncToken = eventsPage.nextSyncToken ?? nextSyncToken;
        } while (pageToken);

        if (nextSyncToken) {
          const { error: syncTokenUpdateError } = await supabase
            .from("calendar_integrations")
            .update({
              last_sync_token: nextSyncToken,
              last_sync_at: new Date().toISOString(),
            })
            .eq("id", integration.id);

          if (syncTokenUpdateError) {
            throw new Error(`Failed to persist sync token: ${syncTokenUpdateError.message}`);
          }
        }

        summary.users_synced += 1;
      } catch (error) {
        summary.errors.push(`user=${integration.user_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const statusCode = summary.errors.length > 0 ? 207 : 200;
    return json({ success: summary.errors.length === 0, ...summary }, statusCode);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
