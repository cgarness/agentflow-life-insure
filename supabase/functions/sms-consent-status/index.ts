import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { cors, database, json } from "../_shared/a2p/auth.ts";
import { account, registration } from "../_shared/a2p/store.ts";
import { campaignReady } from "../_shared/a2p/types.ts";
import { bridge, checked, policy, suppress } from "../_shared/sms/consent.ts";
import { contactScope } from "../_shared/sms/scope.ts";
import { boundedBody, phone, SmsError, UUID } from "../_shared/sms/wire.ts";
export async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") {
      throw new SmsError("METHOD", "POST required.", 405);
    }
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new SmsError("AUTH", "Sign in to continue.", 401);
    const db = database(),
      { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) throw new SmsError("AUTH", "Sign in to continue.", 401);
    const b = JSON.parse(await boundedBody(req));
    const actor = checked(
      await db.from("profiles").select("id,organization_id,status,role").eq(
        "id",
        user.id,
      ).maybeSingle(),
    );
    if (
      !actor || actor.status !== "Active" || actor.id !== b.actor_id ||
      actor.organization_id !== b.organization_id || b.view_as === true
    ) throw new SmsError("SCOPE", "Reload your own account.", 403);
    const p = await policy(db, actor.organization_id);
    if (!p?.enforced) return json({ enforced: false });
    const r = await registration(db, actor.organization_id);
    const a = await account(db, actor.organization_id);
    const providerReady = !!a?.enabled && a.sms_enforced &&
      r?.account_sid === a.account_sid && !!r && campaignReady(r) &&
      !r.sync_error && !!r.last_synced_at &&
      Date.now() - Date.parse(r.last_synced_at) < 86400000;
    if (!b.contact_id) {
      if (
        !["Admin", "Super Admin"].includes(actor.role) || b.action !== "status"
      ) throw new SmsError("ADMIN", "Administrator access required.", 403);
      const pending = await db.from("sms_confirmation_jobs").select("id", {
        count: "exact",
        head: true,
      }).eq("organization_id", actor.organization_id).eq("state", "pending");
      const review = await db.from("sms_dispatches").select("request_key", {
        count: "exact",
        head: true,
      }).eq("organization_id", actor.organization_id).in("state", [
        "uncertain",
        "attempting",
      ]);
      const relay = await db.from("sms_suppressions").select("phone_e164", {
        count: "exact",
        head: true,
      }).eq("organization_id", actor.organization_id).is("synced_at", null);
      checked(pending);
      checked(review);
      checked(relay);
      return json({
        enforced: true,
        send_enabled: p.send_enabled,
        provider_ready: providerReady,
        selected_senders: p.selected_phone_ids.length,
        pending_confirmations: pending.count,
        review_sends: review.count,
        pending_suppressions: relay.count,
      });
    }
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const c = await contactScope(
      caller,
      actor.organization_id,
      b.contact_id,
      b.contact_type,
    );
    const recipient = phone(c.phone);
    if (b.action === "revoke") {
      if (!UUID.test(b.request_id ?? "")) {
        throw new SmsError("REQUEST", "Invalid request.", 400);
      }
      await suppress(
        db,
        actor.organization_id,
        recipient,
        "stop",
        `operator:${actor.id}:${b.request_id}`,
      );
      return json({ recorded: true });
    }
    if (b.action !== "status") {
      throw new SmsError("ACTION", "Invalid action.", 400);
    }
    const local = checked(
      await db.rpc("sms_recipient_blocked", {
        p_org: actor.organization_id,
        p_phone: recipient,
      }),
    );
    const e = checked(
      await db.from("sms_enrollments").select(
        "informational_confirmed,marketing_confirmed",
      ).eq("organization_id", actor.organization_id).eq("phone_e164", recipient)
        .maybeSingle(),
    );
    const [info, market] = await Promise.all([
      bridge(p, {
        action: "eligibility",
        phone: recipient,
        purpose: "informational",
      }),
      bridge(p, {
        action: "eligibility",
        phone: recipient,
        purpose: "marketing",
      }),
    ]);
    return json({
      enforced: true,
      send_enabled: p.send_enabled,
      provider_ready: providerReady,
      suppressed: !!local || info.reason === "suppressed" ||
        market.reason === "suppressed",
      informational: info.allowed === true,
      marketing: market.allowed === true,
      informational_confirmed: !!e?.informational_confirmed,
      marketing_confirmed: !!e?.marketing_confirmed,
    });
  } catch (e) {
    const x = e instanceof SmsError
      ? e
      : new SmsError("SMS_STATUS", "Texting status unavailable.", 503);
    return json({ error: x.message, code: x.code }, x.status);
  }
}
if (import.meta.main) Deno.serve(handle);
