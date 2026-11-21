import type { Db } from "../a2p/types.ts";
import { dispatch } from "../sms/dispatch.ts";
import { policy } from "../sms/consent.ts";
import { contactScope, selectedSender } from "../sms/scope.ts";
import { phone, UUID } from "../sms/wire.ts";
import { renderMergeFields } from "../workflowMergeFields.ts";

interface Claim {
  organization_id: string;
  workflow_id: string;
  version_id: string;
  run_id: string;
  node_id: string;
  lease_token: string;
  contact_type: string;
  contact_id: string;
  stop_on_reply: boolean;
}
interface Node {
  type: "send_sms" | "send_email";
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
  const body = renderMergeFields(String(config.body ?? config.body_override ?? ""), contact);
  const subject = renderMergeFields(String(config.subject ?? config.subject_override ?? ""), contact);
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
        purpose: config.purpose,
        contactId: claim.contact_id,
        contactType: claim.contact_type,
        verifyRecipient: async () => {
          await contactScope(
            db,
            claim.organization_id,
            claim.contact_id,
            claim.contact_type,
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
