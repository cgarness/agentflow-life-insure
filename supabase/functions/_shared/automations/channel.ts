import type { Db } from "../a2p/types.ts";
import { dispatch } from "../sms/dispatch.ts";
import { policy } from "../sms/consent.ts";
import { contactScope, selectedSender } from "../sms/scope.ts";
import { phone, UUID } from "../sms/wire.ts";
import { fieldValues, renderFields, usesAppointmentField } from "./fields.ts";

interface Claim {
  organization_id: string;
  workflow_id: string;
  version_id: string;
  run_id: string;
  node_id: string;
  lease_token: string;
  contact_type: string | null;
  contact_id: string | null;
  stop_on_reply: boolean;
  context?: { appointment_start?: string | null; sms_purpose?: string | null } | null;
}
interface Node {
  type: "send_sms" | "send_email";
  /** Version 2 SMS steps carry no author purpose. The published version pins one. */
  version?: number;
  config: Record<string, unknown>;
}
interface Outcome {
  status: "accepted" | "held" | "failed" | "unknown";
  reason?: string;
}
interface Handoff {
  id: string;
  from_email: string;
  reply_to: string;
  unsubscribe_token: string;
}
interface Dependencies {
  fetch: typeof fetch;
  env(name: string): string | undefined;
}

export async function dispatchChannel(
  db: Db,
  claim: Claim,
  node: Node,
  contact: Record<string, unknown>,
  dependencies: Dependencies = { fetch, env: (name) => Deno.env.get(name) },
): Promise<Outcome> {
  const channel = node.type === "send_email" ? "email" : "sms";
  const config = node.config;
  if (!claim.contact_id || claim.contact_type !== "lead") {
    return { status: "held", reason: "Automated messages are available for leads only." };
  }
  const contactId: string = claim.contact_id;
  const contactType: string = claim.contact_type;
  const rawBody = String(config.body ?? config.body_override ?? "");
  const rawSubject = String(config.subject ?? config.subject_override ?? "");
  // A version published under the current rules carries a pinned purpose. Earlier versions keep their stored one.
  const purpose = claim.context?.sms_purpose ?? (node.version === 2 ? undefined : config.purpose);
  if (channel === "sms" && purpose !== "informational" && purpose !== "marketing") {
    return { status: "held", reason: "SMS purpose could not be established. Republish this automation." };
  }
  let timezone: string | null = null;
  if (usesAppointmentField(rawBody) || usesAppointmentField(rawSubject)) {
    // Appointment wording is written in the recipient's verified time zone, the same evidence the send window uses.
    const recipient = channel === "email" ? String(contact.email ?? "").trim().toLowerCase() : String(contact.phone ?? "");
    const { data, error } = await db.rpc("automation_message_timezone", {
      p_run: claim.run_id, p_channel: channel, p_recipient: recipient,
    });
    if (error || typeof data !== "string" || !data) {
      return { status: "held", reason: "Current recipient eligibility or verified timezone is missing." };
    }
    timezone = data;
  }
  const values = fieldValues({ contact, appointment_start: claim.context?.appointment_start, timezone });
  const renderedBody = renderFields(rawBody, values);
  const renderedSubject = renderFields(rawSubject, values);
  const missing = [...new Set([...renderedSubject.missing, ...renderedBody.missing])];
  if (missing.length) return { status: "held", reason: missing.join(" and ") + " could not be filled in for this appointment." };
  const body = renderedBody.text;
  const subject = renderedSubject.text;
  const origin = dependencies.env("SUPABASE_URL")?.replace(/\/+$/, "");
  if (!origin || !body.trim()) return { status: "held", reason: "Message configuration is incomplete." };
  let handedOff = false;
  let messageId: string | undefined;

  async function begin(recipient: string, from?: string): Promise<Handoff> {
    const { data, error } = await db.rpc("automation_begin_message", {
      p_run: claim.run_id,
      p_token: claim.lease_token,
      p_node: claim.node_id,
      p_channel: channel,
      p_recipient: recipient,
      p_subject: channel === "email" ? subject : null,
      p_body: body,
      p_sender_id: config.sender_id ?? null,
      p_sms_from: from ?? null,
    });
    if (error || !data?.id) throw new Error(error?.message ?? "Provider handoff was held.");
    handedOff = true;
    messageId = data.id;
    return data;
  }
  async function accepted(id: string): Promise<Outcome> {
    const { error } = await db.rpc("automation_record_receipt", {
      p_message: messageId,
      p_channel: channel,
      p_provider: id,
      p_state: "accepted",
      p_at: new Date().toISOString(),
      p_org: claim.organization_id,
    });
    return error
      ? { status: "unknown", reason: "Provider accepted. Receipt reconciliation is pending." }
      : { status: "accepted" };
  }
  try {
    if (channel === "sms") {
      const smsPolicy = await policy(db, claim.organization_id);
      if (!smsPolicy?.enforced) {
        return { status: "held", reason: "Agency automated texting policy is unavailable." };
      }
      const destination = phone(contact.phone);
      const result = await dispatch(db, {
        org: claim.organization_id,
        key: `automation:${claim.run_id}:${claim.node_id}`,
        to: destination,
        from: await selectedSender(db, smsPolicy),
        body,
        purpose,
        contactId: contactId,
        contactType: contactType,
        verifyRecipient: async () => {
          await contactScope(
            db,
            claim.organization_id,
            contactId,
            contactType,
            destination,
          );
        },
        authorizeHandoff: async (from) => {
          const authorization = await begin(destination, from);
          return `${origin}/functions/v1/automation-provider-receipt?sms=${authorization.id}`;
        },
      }, dependencies.fetch);
      if (!result) return { status: "held", reason: "Agency texting policy changed." };
      return messageId ? await accepted(result.provider_message_id) : { status: "accepted" };
    }
    const key = dependencies.env("RESEND_API_KEY");
    const signedFeed = dependencies.env("AUTOMATION_RESEND_WEBHOOK_SECRET");
    if (!key || !signedFeed) {
      return { status: "held", reason: "Verified email transport and receipt feed are required." };
    }
    const to = String(contact.email ?? "").trim().toLowerCase();
    if (!to || !subject.trim()) {
      return { status: "held", reason: "Email destination and subject are required." };
    }
    const sender = await begin(to);
    const unsubscribe =
      `${origin}/functions/v1/automation-provider-receipt?unsubscribe=${sender.unsubscribe_token}`;
    const response = await dependencies.fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": sender.id,
      },
      body: JSON.stringify({
        from: sender.from_email,
        reply_to: sender.reply_to,
        to: [to],
        subject,
        text: body,
        headers: {
          "Message-ID": `<${sender.id}@${sender.from_email.split("@")[1]}>`,
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "automation_message", value: sender.id }],
      }),
    });
    if (!response.ok) {
      return {
        status: response.status >= 500 || [408, 409, 429].includes(response.status)
          ? "unknown"
          : "failed",
        reason: `Email provider returned HTTP ${response.status}.`,
      };
    }
    const payload = await response.json();
    if (typeof payload.id !== "string" || !UUID.test(payload.id)) {
      throw new Error("Unrecognized provider receipt.");
    }
    return await accepted(payload.id);
  } catch (error) {
    if (channel === "sms" && handedOff) {
      const stored = await db.from("sms_dispatches").select("state").eq(
        "organization_id",
        claim.organization_id,
      )
        .eq("request_key", `automation:${claim.run_id}:${claim.node_id}`).maybeSingle();
      if (!stored.error && stored.data?.state === "failed") {
        return {
          status: "failed",
          reason: error instanceof Error ? error.message : "The SMS provider rejected the message.",
        };
      }
    }
    return {
      status: handedOff ? "unknown" : "held",
      reason: error instanceof Error ? error.message : "Message eligibility could not be verified.",
    };
  }
}
