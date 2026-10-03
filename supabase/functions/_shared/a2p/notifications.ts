import { escapeHtml, paragraph, renderSystemEmail, resolveSiteUrl, SYSTEM_EMAIL_FROM } from "../systemEmail.ts";
import { checked } from "./store.ts";
import type { Db } from "./types.ts";
export async function deliverEmails(db: Db, org?: string) {
  let q = db.from("a2p_email_outbox").select("*").is("sent_at", null).lt("attempts", 6).order("created_at").limit(3);
  if (org) q = q.eq("organization_id", org);
  const rows = checked(await q) as Record<string, any>[];
  for (const row of rows) {
    const p = checked(
      await db.from("profiles").select("email,status,role,organization_id,email_notifications_enabled").eq(
        "id",
        row.user_id,
      ).maybeSingle(),
    ) as Record<string, any> | null;
    if (
      !p || p.organization_id !== row.organization_id || p.status !== "Active" ||
      !["Admin", "Super Admin"].includes(p.role) || !p.email_notifications_enabled
    ) {
      checked(
        await db.from("a2p_email_outbox").update({
          sent_at: new Date().toISOString(),
          last_error: "Recipient no longer eligible; no email sent.",
        }).eq("id", row.id),
      );
      continue;
    }
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) continue;
    // Resend idempotency expires after 24h. Stop uncertain old retries for operator review.
    if (Date.now() - Date.parse(row.created_at) > 23 * 3600000) {
      await db.from("a2p_email_outbox").update({ attempts: 6, last_error: "Delivery window expired; review required." })
        .eq("id", row.id);
      continue;
    }
    const link = `${resolveSiteUrl()}/settings?section=a2p-registration`;
    const message = "Open A2P Registration to review your current status and next steps.";
    const mail = renderSystemEmail({
      title: row.title,
      heading: row.title,
      preheader: message,
      bodyHtml: paragraph(escapeHtml(message)),
      bodyText: [message],
      cta: { label: "View registration", url: link },
      fallbackUrl: link,
    });
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `a2p-${row.id}`,
        },
        body: JSON.stringify({
          from: SYSTEM_EMAIL_FROM,
          to: [p.email],
          subject: row.title,
          html: mail.html,
          text: mail.text,
        }),
      });
      checked(
        await db.from("a2p_email_outbox").update(
          res.ok
            ? { sent_at: new Date().toISOString(), last_error: null }
            : { attempts: row.attempts + 1, last_error: "Email provider did not confirm delivery." },
        ).eq("id", row.id),
      );
    } catch {
      await db.from("a2p_email_outbox").update({
        attempts: row.attempts + 1,
        last_error: "Email delivery could not be confirmed.",
      }).eq("id", row.id);
    }
  }
}
