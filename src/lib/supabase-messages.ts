import { supabase } from "@/integrations/supabase/client";
import {
  emailEventAt,
  pickNewestPerContact,
  smsEventAt,
  type ConversationChannel,
  type ConversationScope,
} from "@/lib/conversationScope";

/**
 * A sidebar conversation row.
 *
 * `channel` is `'sms' | 'email'` — NOT `'call'`. The narrowing is load-bearing: it makes a call
 * re-entering the sidebar a COMPILE error rather than a silent behavioural regression.
 */
export interface ConversationPreview {
  contact_id: string;
  contact_name: string;
  contact_type: 'lead' | 'client' | 'recruit';
  contact_phone?: string;
  contact_email?: string;
  last_message: string;
  last_message_at: string;
  channel: ConversationChannel;
  direction: 'inbound' | 'outbound';
}

/** A contact proven to be inside the effective viewer's scope (the deep-link resolution result). */
export interface ScopedContact {
  contact_id: string;
  contact_name: string;
  contact_type: 'lead' | 'client' | 'recruit';
  contact_phone?: string;
  contact_email?: string;
}

/** Rows fetched per page from each activity source. */
const ACTIVITY_PAGE_SIZE = 200;
/**
 * Hard bound on paging per source. Exceeding it is LOGGED, never silent — a truncated sidebar that
 * looks complete is worse than a short one that says so.
 */
const ACTIVITY_MAX_PAGES = 10;
/** Ids per `.in(...)` batch when resolving contacts (PostgREST serializes these into the query string). */
const CONTACT_ID_BATCH_SIZE = 200;

interface ActivityCandidate {
  contact_id: string;
  event_at: string | null;
  last_message: string;
  channel: ConversationChannel;
  direction: 'inbound' | 'outbound';
}

interface ResolvedContact {
  name: string;
  type: 'lead' | 'client' | 'recruit';
  phone?: string;
  email?: string;
}

function normalizeDirection(value: unknown): 'inbound' | 'outbound' {
  return value === 'inbound' ? 'inbound' : 'outbound';
}

function displayName(firstName: unknown, lastName: unknown): string {
  const first = typeof firstName === "string" ? firstName.trim() : "";
  const last = typeof lastName === "string" ? lastName.trim() : "";
  return [first, last].filter(Boolean).join(" ");
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve a page of candidate contact ids against `leads` / `clients` / `recruits`, applying the
 * viewer's scope EXPLICITLY.
 *
 * This is the authorization step, and it deliberately runs BEFORE anything is grouped or displayed.
 * Relying on RLS alone is what broke the old implementation: `messages_select` is organization-wide
 * (`organization_id = get_user_org_id()`) while the contact tables are owner/hierarchy-scoped, so
 * the SMS query returned rows whose contact the same viewer could not read — and the old code
 * fabricated `'Unknown Contact'` typed `'lead'` for each one instead of dropping it.
 *
 * Owner columns mirror the canonical server-side predicates so this cannot drift from Contacts:
 *   - `leads`    → `user_id`            (`_contacts_filtered_leads`: `l.user_id = ANY(...)`)
 *   - `clients`  → `assigned_agent_id`  (`_contacts_filtered_clients`)
 *   - `recruits` → `assigned_agent_id`  (`_contacts_filtered_recruits`)
 *
 * Every query carries the effective `organization_id`, in BOTH scope modes.
 * Any query error throws — a partial resolution would silently look like "you have no contacts".
 */
async function resolveContactsInScope(
  contactIds: string[],
  scope: ConversationScope,
): Promise<Map<string, ResolvedContact>> {
  const resolved = new Map<string, ResolvedContact>();
  if (contactIds.length === 0) return resolved;

  const tables = [
    { table: "leads" as const, ownerColumn: "user_id", type: "lead" as const },
    { table: "clients" as const, ownerColumn: "assigned_agent_id", type: "client" as const },
    { table: "recruits" as const, ownerColumn: "assigned_agent_id", type: "recruit" as const },
  ];

  for (let start = 0; start < contactIds.length; start += CONTACT_ID_BATCH_SIZE) {
    const batch = contactIds.slice(start, start + CONTACT_ID_BATCH_SIZE);

    const results = await Promise.all(
      tables.map(({ table, ownerColumn }) => {
        // `phone` and `email` MUST be selected — the previous implementation read them off a
        // projection that never included them, so every send from Conversations failed with
        // "This contact has no phone number." for contacts that plainly had one.
        let query = supabase
          .from(table)
          .select("id, first_name, last_name, phone, email")
          .in("id", batch)
          .eq("organization_id", scope.organizationId);
        if (scope.kind === "agents") {
          query = query.in(ownerColumn, scope.agentIds);
        }
        return query;
      }),
    );

    results.forEach((result, index) => {
      if (result.error) {
        throw new Error(`Failed to load ${tables[index].table} for conversations: ${result.error.message}`);
      }
      const { type } = tables[index];
      for (const row of (result.data ?? []) as Record<string, unknown>[]) {
        const id = typeof row.id === "string" ? row.id : "";
        if (!id || resolved.has(id)) continue;
        resolved.set(id, {
          name: displayName(row.first_name, row.last_name),
          type,
          phone: optionalText(row.phone),
          email: optionalText(row.email),
        });
      }
    });
  }

  return resolved;
}

/** One page of SMS candidates, newest first by the real event timestamp. */
async function fetchSmsPage(offset: number): Promise<ActivityCandidate[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("contact_id, lead_id, body, sent_at, created_at, direction")
    // `nullsFirst: false` is explicit so the window is independent of the PostgreSQL DESC default
    // (NULLS FIRST) — a null `sent_at` must never displace real recent traffic.
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + ACTIVITY_PAGE_SIZE - 1);

  if (error) throw new Error(`Failed to load SMS conversations: ${error.message}`);

  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.flatMap((row) => {
    // `contact_id` wins over `lead_id`: lead→client conversion sets `contact_id` on the message
    // without clearing `lead_id`, so a converted contact carries both and only `contact_id` is live.
    const contactId =
      (typeof row.contact_id === "string" && row.contact_id) ||
      (typeof row.lead_id === "string" && row.lead_id) ||
      "";
    if (!contactId) return [];
    return [{
      contact_id: contactId,
      event_at: smsEventAt(row as never),
      last_message: typeof row.body === "string" ? row.body : "",
      channel: "sms" as const,
      direction: normalizeDirection(row.direction),
    }];
  });
}

/**
 * One page of email candidates for a single direction.
 *
 * The split by direction is what lets each query's PAGING key equal its RANKING key: inbound pages
 * by `received_at`, outbound by `sent_at`. PostgREST cannot `ORDER BY COALESCE(...)`, so ordering a
 * single combined query by `created_at` would page on sync-insert time and re-rank afterwards,
 * which can pull the wrong rows into the window entirely. `contact_emails_direction_check`
 * constrains `direction` to exactly `inbound | outbound`, so the two queries are exhaustive.
 */
async function fetchEmailPage(
  direction: "inbound" | "outbound",
  offset: number,
): Promise<ActivityCandidate[]> {
  const rankingColumn = direction === "inbound" ? "received_at" : "sent_at";

  const { data, error } = await supabase
    .from("contact_emails")
    .select("contact_id, subject, body_text, direction, received_at, sent_at, created_at")
    .eq("direction", direction)
    .order(rankingColumn, { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + ACTIVITY_PAGE_SIZE - 1);

  if (error) throw new Error(`Failed to load ${direction} email conversations: ${error.message}`);

  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.flatMap((row) => {
    const contactId = typeof row.contact_id === "string" ? row.contact_id : "";
    if (!contactId) return [];
    const subject = typeof row.subject === "string" ? row.subject.trim() : "";
    const bodyText = typeof row.body_text === "string" ? row.body_text.trim() : "";
    return [{
      contact_id: contactId,
      event_at: emailEventAt(row as never),
      last_message: subject || bodyText || "(No subject)",
      channel: "email" as const,
      direction,
    }];
  });
}

export const messagesSupabaseApi = {
  /**
   * Sidebar conversations for ONE effective viewer: one row per RESOLVED contact, ordered by the
   * newest qualifying SMS or email.
   *
   * Guarantees:
   *  - `calls` is never queried. A call cannot create a conversation, set a preview, or rank one.
   *  - Every contact query carries the effective `organization_id`, plus an explicit owner filter
   *    for a non-organization-wide viewer.
   *  - A contact that does not resolve in scope is DROPPED. No `'Unknown Contact'`, no defaulting
   *    `contact_type` to `'lead'`.
   *  - Any query failure throws, so the caller can show a recoverable error instead of a partial
   *    list that looks complete.
   *
   * Crowd-out defence: paging continues past a page that resolves to zero authorized contacts.
   * `messages` RLS is organization-wide, so a chatty colleague can fill many pages with rows this
   * viewer must not see; stopping at the first page would let their traffic hide this viewer's own
   * conversations entirely.
   */
  async getRecentConversations(scope: ConversationScope | null, limit = 50): Promise<ConversationPreview[]> {
    // Fail closed. A null scope (unresolved viewer, or a failed downline traversal) yields zero
    // rows and issues no query — never an organization-wide fallback.
    if (!scope || !scope.organizationId) return [];
    if (scope.kind === "agents" && scope.agentIds.length === 0) return [];

    const sources: { label: string; load: (offset: number) => Promise<ActivityCandidate[]> }[] = [
      { label: "sms", load: (offset) => fetchSmsPage(offset) },
      { label: "email:inbound", load: (offset) => fetchEmailPage("inbound", offset) },
      { label: "email:outbound", load: (offset) => fetchEmailPage("outbound", offset) },
    ];

    const authorized = new Map<string, ResolvedContact>();
    const unauthorized = new Set<string>();
    const candidates: ActivityCandidate[] = [];
    const truncated: string[] = [];

    for (const source of sources) {
      let page = 0;
      for (; page < ACTIVITY_MAX_PAGES; page += 1) {
        const rows = await source.load(page * ACTIVITY_PAGE_SIZE);
        if (rows.length === 0) break;

        const unseen = Array.from(
          new Set(
            rows
              .map((row) => row.contact_id)
              .filter((id) => !authorized.has(id) && !unauthorized.has(id)),
          ),
        );

        if (unseen.length > 0) {
          const resolved = await resolveContactsInScope(unseen, scope);
          for (const id of unseen) {
            const hit = resolved.get(id);
            if (hit) authorized.set(id, hit);
            else unauthorized.add(id);
          }
        }

        candidates.push(...rows.filter((row) => authorized.has(row.contact_id)));

        const distinctAuthorized = new Set(candidates.map((row) => row.contact_id)).size;
        if (distinctAuthorized >= limit) break;
        if (rows.length < ACTIVITY_PAGE_SIZE) break;
      }
      if (page >= ACTIVITY_MAX_PAGES) truncated.push(source.label);
    }

    if (truncated.length > 0) {
      // Never silent: a capped sweep that renders like a complete one is a correctness trap.
      console.warn(
        `[Conversations] Activity sweep hit the ${ACTIVITY_MAX_PAGES}-page cap for: ${truncated.join(", ")}. ` +
        "Older conversations may not be listed.",
      );
    }

    return pickNewestPerContact(candidates)
      .slice(0, limit)
      .map((row) => {
        // Non-null by construction: `candidates` only ever holds authorized contact ids.
        const contact = authorized.get(row.contact_id) as ResolvedContact;
        return {
          contact_id: row.contact_id,
          contact_name: contact.name,
          contact_type: contact.type,
          contact_phone: contact.phone,
          contact_email: contact.email,
          last_message: row.last_message,
          last_message_at: row.event_at as string,
          channel: row.channel,
          direction: row.direction,
        };
      });
  },

  /**
   * Resolve ONE contact against the same scope the sidebar uses.
   *
   * This is what a `?contactId=` deep link is validated against, so a link cannot reach a contact
   * outside the effective viewer's scope. It also returns the contact's REAL type, which is why the
   * page no longer has to trust (or default) the `?contactType=` URL parameter.
   */
  async resolveScopedContact(
    contactId: string,
    scope: ConversationScope | null,
  ): Promise<ScopedContact | null> {
    if (!scope || !contactId) return null;
    const resolved = await resolveContactsInScope([contactId], scope);
    const hit = resolved.get(contactId);
    if (!hit) return null;
    return {
      contact_id: contactId,
      contact_name: hit.name,
      contact_type: hit.type,
      contact_phone: hit.phone,
      contact_email: hit.email,
    };
  },

  /**
   * The opened contact's FULL history — SMS, email AND calls, oldest first.
   *
   * Calls belong here and are deliberately retained: the requirement is that they never rank or
   * create a SIDEBAR conversation, not that they disappear from the thread.
   */
  async getConversationThread(contactId: string): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const [callsRes, msgsRes, emailsRes] = await Promise.all([
      supabase
        .from("calls")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("messages")
        .select("*")
        .or(`lead_id.eq.${contactId},contact_id.eq.${contactId}`)
        .order("sent_at", { ascending: false })
        .limit(100),
      supabase
        .from("contact_emails")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (callsRes.error) throw new Error(`Failed to load calls: ${callsRes.error.message}`);
    if (msgsRes.error) throw new Error(`Failed to load messages: ${msgsRes.error.message}`);
    if (emailsRes.error) throw new Error(`Failed to load emails: ${emailsRes.error.message}`);

    const calls = (callsRes.data || []).map(c => ({
      ...c,
      type: "call",
      _ts: new Date(c.started_at || c.created_at || 0).getTime(),
      description: c.disposition_name || "Call",
    }));
    const msgs = (msgsRes.data || []).map(m => ({
      ...m,
      type: "sms",
      _ts: new Date(m.sent_at || m.created_at || 0).getTime(),
      description: m.body,
    }));
    const emails = (emailsRes.data || []).map(e => ({
      ...e,
      type: "email",
      _ts: new Date(e.received_at || e.sent_at || e.created_at || 0).getTime(),
      description: e.body_text || e.body_html || "(No content)",
    }));

    return [...calls, ...msgs, ...emails].sort((a, b) => a._ts - b._ts);
  }
};
