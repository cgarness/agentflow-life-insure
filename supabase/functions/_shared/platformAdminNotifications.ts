// Platform-admin registration notifications ("[AGENTFLOW ADMIN] New User
// Registered" / "New Agency Created").
//
// The database enqueues (AFTER INSERT triggers on profiles / organizations,
// migration 20261010200000); this module delivers. It is used only by the
// platform-admin-notify Edge Function, which pg_cron invokes with a dedicated
// Vault token. Nothing here is reachable from a signup request, so a delivery
// failure can never affect account or agency creation.
//
// Security: the recipient comes from server configuration only
// (PLATFORM_ADMIN_NOTIFY_RECIPIENT, default chris@fflagent.com when unset; a
// set-but-invalid value fails closed); nothing is read from the request. Templates receive display strings only — never
// passwords, tokens, invitation tokens, auth links, JWT/app_metadata or
// phone numbers. Logs carry row ids, event types and outcomes, never bodies.

import {
  AgencyStatusDisplay,
  deriveAgencyStatus,
  renderAdminAgencyCreatedEmail,
  renderAdminUserRegisteredEmail,
  RenderedSystemEmailWithSubject,
} from "./systemEmailTemplates.ts";
import { SYSTEM_EMAIL_FROM } from "./systemEmail.ts";

export const DEFAULT_PLATFORM_ADMIN_RECIPIENT = "chris@fflagent.com";
// 5 sequential sends x 15 s timeout stays well inside the Edge wall-clock limit; the queue drains every minute.
export const CLAIM_BATCH_SIZE = 5;
const RESEND_TIMEOUT_MS = 15_000;

// ── Configuration ────────────────────────────────────────────────────────────

const SIMPLE_EMAIL = /^[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[^\s@,;<>"'()]+$/;

export type RecipientResolution =
  | { ok: true; recipient: string; source: "default" | "configured" }
  | { ok: false; error: string };

/**
 * Resolves the notification recipient from server configuration. FAILS CLOSED:
 *   - unset (`undefined`)           -> the default, chris@fflagent.com
 *   - set to exactly one valid address -> that address
 *   - set to anything else (blank, whitespace, malformed, several addresses)
 *                                   -> an error; the caller must not send or claim
 * The error never contains the configured value (only its length), so it is
 * safe to log. Pass the raw env value: `Deno.env.get("PLATFORM_ADMIN_NOTIFY_RECIPIENT")`.
 */
export function resolvePlatformAdminRecipient(configured: string | undefined): RecipientResolution {
  if (configured === undefined) {
    return { ok: true, recipient: DEFAULT_PLATFORM_ADMIN_RECIPIENT, source: "default" };
  }
  const value = configured.trim();
  if (!value || value.length > 254 || !SIMPLE_EMAIL.test(value)) {
    return {
      ok: false,
      error: `PLATFORM_ADMIN_NOTIFY_RECIPIENT is set but invalid (length ${configured.length}); ` +
        "expected exactly one email address",
    };
  }
  return { ok: true, recipient: value, source: "configured" };
}

/** Constant-time string comparison for the worker Bearer token. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only for `Authorization: Bearer <token>` matching a configured token of >= 32 chars. */
export function isAuthorizedWorkerRequest(authorization: string | null, token: string | undefined): boolean {
  const expected = (token ?? "").trim();
  if (expected.length < 32) return false;
  return timingSafeEqual(authorization ?? "", `Bearer ${expected}`);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatUtc(iso: string | null | undefined): string {
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return "Unknown";
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function formatPacific(iso: string | null | undefined): string {
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

export function signupSourceLabel(source: unknown): string {
  if (source === "invite") return "Team invitation";
  if (source === "self_serve") return "Self-service signup";
  return "Other (administrative or direct)";
}

function fullName(first: unknown, last: unknown): string {
  return [first, last].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join(" ");
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Single-line, bounded error text safe for the queue's last_error and logs. */
export function sanitizeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown error";
}

// ── Data access (narrow interface so tests can inject a fake) ───────────────

export interface QueueRow {
  id: string;
  event_type: "user_registered" | "agency_created";
  subject_id: string;
  organization_id: string | null;
  attempts: number;
}

export type CompleteOutcome = "sent" | "skipped" | "retry" | "failed";

export interface NotificationStore {
  claim(limit: number): Promise<QueueRow[]>;
  complete(id: string, outcome: CompleteOutcome, providerMessageId?: string | null, error?: string | null): Promise<string | null>;
  loadUser(userId: string): Promise<UserNotificationData | null>;
  loadAgency(organizationId: string): Promise<AgencyNotificationData | null>;
}

export interface UserNotificationData {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  createdAt: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationStatus: string | null;
  organizationTwilioStatus: string | null;
  emailConfirmed: boolean;
  signupSource: unknown;
  invitedBy: string | null;
}

export interface AgencyNotificationData {
  id: string;
  name: string | null;
  slug: string | null;
  status: string | null;
  twilioSubaccountStatus: string | null;
  createdAt: string | null;
  founder: { name: string; email: string | null; role: string | null } | null;
  memberCount: number;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/** Unwraps a PostgREST result; a returned error is a failure, never an empty result. */
// deno-lint-ignore no-explicit-any
function check(result: { data: any; error: { message: string } | null }, what: string): any {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

/** Service-role Supabase implementation of the store. */
export function createSupabaseStore(db: SupabaseLike): NotificationStore {
  return {
    async claim(limit) {
      return (check(await db.rpc("claim_platform_admin_notifications", { p_limit: limit }), "claim") ?? []) as QueueRow[];
    },
    async complete(id, outcome, providerMessageId = null, error = null) {
      return check(
        await db.rpc("complete_platform_admin_notification", {
          p_id: id,
          p_outcome: outcome,
          p_provider_message_id: providerMessageId,
          p_error: error,
        }),
        "complete",
      ) as string | null;
    },
    async loadUser(userId) {
      const profile = check(
        await db.from("profiles")
          .select("id, first_name, last_name, email, role, status, organization_id, created_at")
          .eq("id", userId)
          .maybeSingle(),
        "profile lookup",
      );
      if (!profile) return null;

      let org: { name: string | null; status: string | null; twilio_subaccount_status: string | null } | null = null;
      if (profile.organization_id) {
        org = check(
          await db.from("organizations")
            .select("name, status, twilio_subaccount_status")
            .eq("id", profile.organization_id)
            .maybeSingle(),
          "organization lookup",
        );
      }

      // Only confirmation state and signup source are read from the auth user.
      const { data: authData, error: authError } = await db.auth.admin.getUserById(userId);
      if (authError) throw new Error(`auth user lookup: ${authError.message}`);
      const authUser = authData?.user ?? null;

      let invitedBy: string | null = null;
      if (profile.organization_id && authUser?.user_metadata?.signup_source === "invite") {
        // Exact normalized email equality in code (never ilike). Tokens are never selected.
        const invitations = check(
          await db.from("invitations")
            .select("email, invited_by, accepted_at")
            .eq("organization_id", profile.organization_id)
            .eq("status", "Accepted")
            .order("accepted_at", { ascending: false, nullsFirst: false })
            .limit(50),
          "invitation lookup",
        ) as Array<{ email: string; invited_by: string | null }>;
        const match = invitations.find((i) => normalizeEmail(i.email) === normalizeEmail(profile.email));
        if (match?.invited_by) {
          const inviter = check(
            await db.from("profiles")
              .select("first_name, last_name, email")
              .eq("id", match.invited_by)
              .eq("organization_id", profile.organization_id)
              .maybeSingle(),
            "inviter lookup",
          );
          if (inviter) {
            const inviterName = fullName(inviter.first_name, inviter.last_name);
            invitedBy = inviterName ? `${inviterName} (${inviter.email})` : inviter.email;
          }
        }
      }

      return {
        id: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        email: profile.email,
        role: profile.role,
        status: profile.status,
        createdAt: profile.created_at,
        organizationId: profile.organization_id,
        organizationName: org?.name ?? null,
        organizationStatus: org?.status ?? null,
        organizationTwilioStatus: org?.twilio_subaccount_status ?? null,
        emailConfirmed: Boolean(authUser?.email_confirmed_at),
        signupSource: authUser?.user_metadata?.signup_source,
        invitedBy,
      };
    },
    async loadAgency(organizationId) {
      const org = check(
        await db.from("organizations")
          .select("id, name, slug, status, twilio_subaccount_status, created_at")
          .eq("id", organizationId)
          .maybeSingle(),
        "organization lookup",
      );
      if (!org) return null;
      const members = await db.from("profiles")
        .select("first_name, last_name, email, role, created_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (members.error) throw new Error(`member lookup: ${members.error.message}`);
      const first = (members.data ?? [])[0] ?? null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        twilioSubaccountStatus: org.twilio_subaccount_status,
        createdAt: org.created_at,
        founder: first
          ? { name: fullName(first.first_name, first.last_name), email: first.email ?? null, role: first.role ?? null }
          : null,
        memberCount: members.count ?? 0,
      };
    },
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

export function renderUserNotification(u: UserNotificationData): RenderedSystemEmailWithSubject {
  const agencyStatus: AgencyStatusDisplay | null = u.organizationId
    ? deriveAgencyStatus(u.organizationStatus, u.organizationTwilioStatus)
    : null;
  return renderAdminUserRegisteredEmail({
    userId: u.id,
    fullName: fullName(u.firstName, u.lastName),
    email: u.email ?? "",
    role: u.role ?? "",
    accountStatus: u.status ?? "",
    emailConfirmed: u.emailConfirmed,
    signupSource: signupSourceLabel(u.signupSource),
    invitedBy: u.invitedBy,
    organizationId: u.organizationId,
    organizationName: u.organizationName,
    agencyStatus,
    registeredAtUtc: formatUtc(u.createdAt),
    registeredAtPacific: formatPacific(u.createdAt),
  });
}

export function renderAgencyNotification(a: AgencyNotificationData): RenderedSystemEmailWithSubject {
  const founder = a.founder
    ? [a.founder.name || "Unnamed", a.founder.email ? `(${a.founder.email})` : "", a.founder.role ? `— ${a.founder.role}` : ""]
      .filter(Boolean).join(" ")
    : null;
  return renderAdminAgencyCreatedEmail({
    organizationId: a.id,
    name: a.name ?? "",
    slug: a.slug,
    status: deriveAgencyStatus(a.status, a.twilioSubaccountStatus),
    founder,
    memberCount: a.memberCount,
    createdAtUtc: formatUtc(a.createdAt),
    createdAtPacific: formatPacific(a.createdAt),
  });
}

// ── Delivery ─────────────────────────────────────────────────────────────────

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export type MailResult =
  | { ok: true; id: string | null }
  | { ok: false; retryable: boolean; error: string };

export type Mailer = (message: MailMessage) => Promise<MailResult>;

/** Resend over fetch, with a per-row Idempotency-Key (fetch is injectable for tests). */
export function createResendMailer(apiKey: string, fetchImpl: typeof fetch = fetch): Mailer {
  return async (message) => {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: SYSTEM_EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.ok) {
        return { ok: true, id: typeof body?.id === "string" ? body.id : null };
      }
      const name = typeof body?.name === "string" ? body.name : "";
      // Same key, different payload: retrying with this key can never succeed and a previous
      // attempt may already have been delivered, so close the row for review.
      const retryable = !(res.status === 409 && name === "invalid_idempotent_request");
      return { ok: false, retryable, error: sanitizeError(`Resend HTTP ${res.status}${name ? ` ${name}` : ""}`) };
    } catch (err) {
      return { ok: false, retryable: true, error: sanitizeError(`Resend request failed: ${sanitizeError(err)}`) };
    }
  };
}

export interface ProcessSummary {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
  errors: number;
}

/**
 * Claims due rows and delivers each one. Never throws for a single row: every
 * outcome is recorded through store.complete, and a failed bookkeeping call is
 * logged (the row's lease then expires and it is reclaimed safely).
 */
export async function processQueue(
  store: NotificationStore,
  mailer: Mailer,
  recipient: string,
  limit: number = CLAIM_BATCH_SIZE,
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, errors: 0 };
  const rows = await store.claim(limit);
  summary.claimed = rows.length;

  for (const row of rows) {
    const tag = `row=${row.id} event=${row.event_type} attempt=${row.attempts}`;
    let outcome: CompleteOutcome;
    let providerId: string | null = null;
    let error: string | null = null;

    try {
      let rendered: RenderedSystemEmailWithSubject | null = null;
      if (row.event_type === "user_registered") {
        const user = await store.loadUser(row.subject_id);
        rendered = user ? renderUserNotification(user) : null;
      } else if (row.event_type === "agency_created") {
        const agency = await store.loadAgency(row.subject_id);
        rendered = agency ? renderAgencyNotification(agency) : null;
      }

      if (!rendered) {
        outcome = "skipped";
        error = "subject_deleted";
      } else {
        const result = await mailer({
          to: recipient,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `platform-admin-${row.id}`,
        });
        if (result.ok) {
          outcome = "sent";
          providerId = result.id;
        } else {
          outcome = result.retryable ? "retry" : "failed";
          error = result.error;
        }
      }
    } catch (err) {
      outcome = "retry";
      error = sanitizeError(err);
    }

    try {
      const status = await store.complete(row.id, outcome, providerId, error);
      if (status === "sent") summary.sent++;
      else if (status === "skipped") summary.skipped++;
      else if (status === "pending") summary.retried++;
      else if (status === "failed") summary.failed++;
      const line = `platform-admin-notify: ${tag} outcome=${outcome} status=${status ?? "not-applied"}` +
        (error ? ` error="${error}"` : "");
      if (outcome === "retry" || outcome === "failed" || status === "failed") console.error(line);
      else console.log(line);
    } catch (completeErr) {
      summary.errors++;
      console.error(`platform-admin-notify: ${tag} could not record outcome=${outcome}: ${sanitizeError(completeErr)}`);
    }
  }

  return summary;
}
