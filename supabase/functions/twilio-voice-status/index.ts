import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { insertMissedCallNotifications } from "../_shared/notifications.ts";
import { chooseDurationToWrite, parseDurationSeconds } from "./duration.ts";
import { applyStatusLadder, shouldEmitMissedCallNotification } from "./terminal-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const twimlHeaders = { ...corsHeaders, "Content-Type": "text/xml" };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function supabasePublicOrigin(): string {
  return (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
}

function edgeFunctionAbsoluteUrl(req: Request, slug: string): string {
  const origin = supabasePublicOrigin();
  const search = new URL(req.url).search;
  return `${origin}/functions/v1/${slug}${search}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validateTwilioSignature(
  req: Request,
  authToken: string,
  params: Record<string, string>,
): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const fullUrl = edgeFunctionAbsoluteUrl(req, "twilio-voice-status");

  const sortedKeys = Object.keys(params).sort();
  let signingString = fullUrl;
  for (const k of sortedKeys) signingString += k + params[k];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingString),
  );
  const expected = bytesToBase64(new Uint8Array(sig));
  return timingSafeEqual(expected, signature);
}

async function parseFormBody(req: Request): Promise<Record<string, string>> {
  const raw = await req.text();
  const params: Record<string, string> = {};
  const search = new URLSearchParams(raw);
  for (const [k, v] of search.entries()) params[k] = v;
  return params;
}

function buildBasicAuth(accountSid: string, authToken: string): string {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

function normalizeStirShakenLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase().trim();
  if (s === "A" || s === "B" || s === "C" || s === "U") return s;
  const token = s.match(/(?:^|[-_\s])([ABCU])(?:$|[-_\s])/);
  if (token?.[1]) return token[1];
  const letters = s.replace(/[^ABCU]/g, "");
  if (letters.includes("A")) return "A";
  if (letters.includes("B")) return "B";
  if (letters.includes("C")) return "C";
  if (letters.includes("U")) return "U";
  return null;
}

async function fetchTwilioStirShakenLevel(
  accountSid: string,
  authToken: string,
  callSid: string,
): Promise<string | null> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: buildBasicAuth(accountSid, authToken),
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const twilioRaw =
    (typeof json.stir_verstat === "string" ? json.stir_verstat : null) ??
    (typeof json.stir_status === "string" ? json.stir_status : null) ??
    (typeof json.stirStatus === "string" ? json.stirStatus : null) ??
    (typeof json.shaken_stir === "string" ? json.shaken_stir : null) ??
    (typeof json.shakenStir === "string" ? json.shakenStir : null);
  return normalizeStirShakenLevel(twilioRaw);
}

/** Twilio <Dial action> posts DialCallStatus, not CallStatus — map into the same terminal handling. */
function mapDialCallStatusToCallStatus(dialCallStatus: string): string | null {
  const d = dialCallStatus.trim().toLowerCase();
  if (!d) return null;
  if (d === "completed" || d === "answered") return "completed";
  if (d === "busy") return "busy";
  if (d === "no-answer") return "no-answer";
  if (d === "failed" || d === "canceled") return d;
  return null;
}

type CallRow = {
  id: string;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  organization_id: string | null;
  agent_id: string | null;
};

// insertMissedCallNotifications is now imported from "../_shared/notifications.ts"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(EMPTY_TWIML, { status: 405, headers: twimlHeaders });
  }

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    if (!authToken) {
      console.error("[twilio-voice-status] Missing TWILIO_AUTH_TOKEN");
      return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
    }

    const params = await parseFormBody(req);

    const valid = await validateTwilioSignature(req, authToken, params);
    if (!valid) {
      console.warn("[twilio-voice-status] Signature validation failed");
      return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
    }

    const parentCallSid = params["CallSid"] ?? "";
    const dialCallSid = params["DialCallSid"] ?? "";
    const dialCallStatus = params["DialCallStatus"] ?? "";
    const callStatusFromForm = params["CallStatus"] ?? "";
    const mappedFromDial = mapDialCallStatusToCallStatus(dialCallStatus);
    const callStatus = mappedFromDial ?? callStatusFromForm;
    const callDuration = parseDurationSeconds(
      params["CallDuration"] ?? params["DialCallDuration"],
    );
    const sipResponseCode = params["SipResponseCode"] ?? "";
    const webhookStirRaw =
      params["StirVerstat"] ??
      params["StirStatus"] ??
      params["StirShakenStatus"] ??
      params["StirShaken"] ??
      "";
    const from = params["From"] ?? "";
    const to = params["To"] ?? "";

    console.log("[twilio-voice-status] event", {
      parentCallSid,
      dialCallSid: dialCallSid || "(none)",
      dialCallStatus: dialCallStatus || "(none)",
      callStatusFromForm: callStatusFromForm || "(none)",
      effectiveCallStatus: callStatus || "(none)",
      callDuration,
      sipResponseCode: sipResponseCode || "(none)",
      stirShaken: webhookStirRaw || "(none)",
      from,
      to,
    });

    if (!parentCallSid && !dialCallSid) {
      console.warn("[twilio-voice-status] Missing CallSid/DialCallSid — acking anyway");
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const nowIso = new Date().toISOString();

    let matchTwilioSid = "";
    let existing:
      | {
          id: string;
          started_at: string | null;
          ended_at: string | null;
          duration: number | null;
          status: string | null;
          contact_id: string | null;
          contact_type: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          organization_id: string | null;
          agent_id: string | null;
        }
      | null = null;

    const tryLookup = async (sid: string) => {
      if (!sid) return;
      const { data, error: selectError } = await supabase
        .from("calls")
        .select(
          "id, started_at, ended_at, duration, status, contact_id, contact_type, contact_name, contact_phone, organization_id, agent_id, is_missed, direction, caller_id_used, routed_agent_ids",
        )
        .eq("twilio_call_sid", sid)
        .maybeSingle();
      if (selectError) {
        console.error(
          `[twilio-voice-status] calls lookup failed for ${sid}:`,
          selectError.message,
        );
        return;
      }
      if (data) {
        existing = data as any;
        matchTwilioSid = sid;
      }
    };

    await tryLookup(parentCallSid);
    if (!existing && dialCallSid && dialCallSid !== parentCallSid) {
      await tryLookup(dialCallSid);
    }

    if (!existing) {
      console.warn(
        `[twilio-voice-status] No calls row matches twilio_call_sid parent=${parentCallSid || "(none)"} dial=${dialCallSid || "(none)"} (effectiveStatus=${callStatus})`,
      );
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const patch: Record<string, unknown> = { updated_at: nowIso };
    const webhookStir = normalizeStirShakenLevel(webhookStirRaw);
    if (webhookStir) patch.shaken_stir = webhookStir;

    // Candidate duration (seconds) to consider writing for this callback. The monotonic
    // guard below decides whether it actually lands, so late/out-of-order callbacks
    // cannot regress a good existing duration. Twilio duration is canonical; browser
    // timers must never write calls.duration.
    let durationCandidate: number | null = null;

    switch (callStatus) {
      case "ringing": {
        patch.status = "ringing";
        if (!existing.started_at) patch.started_at = nowIso;
        break;
      }
      case "in-progress": {
        patch.status = "connected";
        break;
      }
      case "completed": {
        patch.status = "completed";
        if (!existing.ended_at) patch.ended_at = nowIso;
        if (callDuration !== null) {
          durationCandidate = callDuration;
        } else if (existing.started_at) {
          const startMs = new Date(existing.started_at).getTime();
          durationCandidate = Math.max(0, Math.round((Date.now() - startMs) / 1000));
        }
        if (!patch.shaken_stir && accountSid) {
          // PSTN leg (child) usually carries STIR/SHAKEN; parent Voice SDK leg may not.
          const stirSid = dialCallSid || parentCallSid;
          let fetched = await fetchTwilioStirShakenLevel(accountSid, authToken, stirSid);
          if (!fetched && dialCallSid && parentCallSid && stirSid === dialCallSid) {
            fetched = await fetchTwilioStirShakenLevel(accountSid, authToken, parentCallSid);
          }
          if (fetched) patch.shaken_stir = fetched;
        }
        break;
      }
      case "busy": {
        patch.status = "completed";
        patch.outcome = "busy";
        if (!existing.ended_at) patch.ended_at = nowIso;
        durationCandidate = callDuration ?? 0;
        break;
      }
      case "no-answer": {
        patch.status = "no-answer";
        if (!existing.ended_at) patch.ended_at = nowIso;
        durationCandidate = callDuration ?? 0;
        break;
      }
      case "failed":
      case "canceled": {
        patch.status = "failed";
        if (!existing.ended_at) patch.ended_at = nowIso;
        if (callStatus === "canceled") {
          patch.is_missed = true;
        }
        if (sipResponseCode) patch.provider_error_code = sipResponseCode;
        durationCandidate = callDuration ?? 0;
        break;
      }
      default: {
        console.log(
          `[twilio-voice-status] Unhandled effectiveCallStatus=${callStatus} (form CallStatus=${callStatusFromForm}, DialCallStatus=${dialCallStatus}) for parent=${parentCallSid} — no DB write`,
        );
        return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
      }
    }

    // R7 full monotonic status ladder (terminal-guard.ts): ringing → connected → terminal.
    // A late/replayed callback can never move status backwards; a terminal state is frozen (the first
    // accepted terminal stands). Suppressed writes drop the status-coupled fields but still permit
    // monotonic enrichment: duration (guard below), ended_at only when NULL, shaken_stir.
    const ladder = applyStatusLadder(existing.status, String(patch.status ?? ""));
    if (!ladder.writeStatus) {
      delete patch.status;
      delete patch.started_at;
      delete patch.outcome;
      delete patch.is_missed;
      delete patch.provider_error_code;
    }

    // Monotonic guard: only persist duration when it improves on the stored value.
    // Prevents a retried/late non-answer/busy/canceled/failed callback (candidate 0)
    // from overwriting an already-recorded positive Twilio duration.
    const durToWrite = chooseDurationToWrite(existing.duration, durationCandidate);
    if (durToWrite !== null) patch.duration = durToWrite;

    // C7 (rev 6): the update is EXACT-ROW (the row resolved by the SID lookup) and its outcome is
    // verified — a failed or zero-row write must never be followed by a notification. When the
    // ladder ACCEPTED a status write, the update is additionally an atomic compare-and-swap on the
    // status we evaluated the ladder against: a concurrent writer (finalize_inbound_call_terminal,
    // another callback) that landed a terminal in between wins, and this callback becomes a no-op
    // instead of overwriting the first accepted terminal (R7 enforced in the database, not just by
    // Twilio event ordering). Enrichment-only patches carry no CAS so they always land.
    const rowId = (existing as { id: string }).id;
    const priorStatus = (existing as { status?: string | null }).status ?? null;
    const statusCasApplied = ladder.writeStatus && typeof patch.status === "string";

    let updateQuery = supabase.from("calls").update(patch).eq("id", rowId);
    if (statusCasApplied) {
      updateQuery = priorStatus === null
        ? updateQuery.is("status", null)
        : updateQuery.eq("status", priorStatus);
    }
    const { data: updatedRows, error: updateError } = await updateQuery.select("id");

    const rowsLanded = Array.isArray(updatedRows) ? updatedRows.length : 0;
    const updateSucceeded = !updateError && rowsLanded === 1;

    if (updateError) {
      // Transient DB failure: 5xx so the callback is redelivered (the number-level statusCallback
      // URL carries the connection-override retry policy). Returning 200 here would permanently
      // lose both the terminal write and its missed-call notification.
      console.error(
        `[twilio-voice-status] calls update failed for ${matchTwilioSid} — returning 503 for redelivery:`,
        updateError.message,
      );
      return new Response(EMPTY_TWIML, { status: 503, headers: twimlHeaders });
    }
    if (!updateSucceeded) {
      // Zero rows: a concurrent writer won the CAS (expected under R7 — the first accepted terminal
      // stands) or the row is gone. Neither is retryable and neither may notify.
      console.warn(
        `[twilio-voice-status] calls update landed 0 rows for ${matchTwilioSid} — superseded by a concurrent writer or row missing`,
        { rowId, priorStatus, statusCasApplied },
      );
    }

    // ── Missed-call notification — C7: the ladder-ACCEPTED transition plus the verified update, or
    // convergence for a row that is DURABLY missed (see shouldEmitMissedCallNotification). A
    // suppressed late/replayed no-answer/busy/canceled on a not-missed row notifies nobody; the
    // notifications event_key upsert remains the exactly-once backstop.
    const storedIsMissed =
      (patch.is_missed as boolean | undefined) === true ||
      (existing as { is_missed?: boolean | null }).is_missed === true;
    const notifyMissed = shouldEmitMissedCallNotification({
      effectiveCallStatus: callStatus,
      ladderAcceptedStatusWrite: ladder.writeStatus,
      updateSucceeded,
      storedIsMissed,
      direction: (existing as { direction?: string | null }).direction,
      organizationId: (existing as { organization_id?: string | null }).organization_id,
    });

    if (notifyMissed) {
      try {
        // Merge existing with patch for the helper
        const callData = { ...(existing as Record<string, unknown>), ...patch };
        await insertMissedCallNotifications(supabase, callData as any);
      } catch (notifyErr) {
        console.error(
          "[twilio-voice-status] missed-call notification failed:",
          notifyErr,
        );
      }
    }

    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error("[twilio-voice-status] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
