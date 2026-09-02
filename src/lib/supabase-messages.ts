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
/** Ids per `.in(...)` batch when resolving contacts (PostgREST serializes these into the query string). */
const CONTACT_ID_BATCH_SIZE = 200;
/**
 * Contact ids per activity batch.
 *
 * A trade-off, chosen deliberately: bigger batches mean fewer round trips (a 500-contact book is
 * 5 batches x 8 sources = 40 queries rather than 80 at batch 50), but the ids are serialized into
 * the PostgREST query string, so ~100 UUIDs (~3.7 KB) keeps the URL comfortably inside common
 * limits. Exactness does not depend on this number — an under-covered batch falls back to
 * per-contact lookups.
 */
const ACTIVITY_CONTACT_BATCH_SIZE = 100;
/** Pages to read for one activity batch before falling back to exact per-contact lookups. */
const ACTIVITY_MAX_PAGES_PER_BATCH = 3;
/** Contacts enumerated per page when listing the viewer's authorized book. */
const CONTACT_ENUMERATION_PAGE_SIZE = 1000;
/**
 * Bound on enumerating one viewer's authorized contacts. Reaching it is an explicit, surfaced
 * ERROR — never a silent truncation of the conversation list.
 */
const CONTACT_ENUMERATION_MAX_PAGES = 25;
/**
 * Bound on the organization-wide activity sweep. Every row an organization-wide viewer can see is
 * authorized for them, so this is not an authorization filter — it only guards against a
 * pathological organization whose newest tens of thousands of rows resolve to fewer than `limit`
 * distinct contacts. Reaching it throws rather than silently returning a short list.
 */
const ORG_ACTIVITY_MAX_PAGES = 25;

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

/**
 * Owner columns mirror the canonical server-side predicates so this cannot drift from Contacts:
 *   - `leads`    → `user_id`            (`_contacts_filtered_leads`: `l.user_id = ANY(...)`)
 *   - `clients`  → `assigned_agent_id`  (`_contacts_filtered_clients`)
 *   - `recruits` → `assigned_agent_id`  (`_contacts_filtered_recruits`)
 */
const CONTACT_TABLES = [
  { table: "leads" as const, ownerColumn: "user_id", type: "lead" as const },
  { table: "clients" as const, ownerColumn: "assigned_agent_id", type: "client" as const },
  { table: "recruits" as const, ownerColumn: "assigned_agent_id", type: "recruit" as const },
];

function normalizeDirection(value: unknown): 'inbound' | 'outbound' {
  return value === 'inbound' ? 'inbound' : 'outbound';
}

function displayName(firstName: unknown, lastName: unknown): string {
  const first = typeof firstName === "string" ? firstName.trim() : "";
  const last = typeof lastName === "string" ? lastName.trim() : "";
  return [first, last].filter(Boolean).join(" ");
}

/** The label shown when a real contact row carries no usable name. */
export const UNNAMED_CONTACT_LABEL = "Unnamed contact";

/**
 * The label a RESOLVED contact is shown under: name, else phone, else email, else a constant.
 *
 * `displayName` returns the empty string when both name parts are blank, which is honest but
 * unrenderable — it produced blank avatar initials, a blank sidebar row and a blank thread header,
 * so the conversation looked broken rather than merely unnamed. The old `|| "Unknown"` fallback at
 * the page level covered only the header, and only for one of the three.
 *
 * The order is deterministic and never invents anything: phone and email come from the SAME
 * contact row as the name, so the label is always a real identifier of that same contact.
 *
 * ⚠️ This applies ONLY to contacts that RESOLVED. An unresolved row has no contact record behind
 * it, so it has no phone and no email to fall back to and — critically — no known type. Labelling
 * one would mean fabricating a `contact_type`, which is the defect that made unlinked rows surface
 * as conversations in the first place. Unresolved rows are still dropped; this function is never
 * reached for them.
 */
function contactDisplayLabel(contact: ResolvedContact): string {
  const name = contact.name.trim();
  if (name) return name;
  const phone = contact.phone?.trim();
  if (phone) return phone;
  const email = contact.email?.trim();
  if (email) return email;
  return UNNAMED_CONTACT_LABEL;
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

  const tables = CONTACT_TABLES;

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

/**
 * Enumerate the viewer's AUTHORIZED contacts, with their display fields.
 *
 * This runs BEFORE any activity is read, which is the whole point: activity queries are then
 * constrained to this id set, so organization-wide traffic the viewer must not see can never
 * occupy the result window in the first place. The previous implementation read activity first and
 * filtered afterwards, so a busy colleague could push the viewer's own conversations out entirely.
 *
 * Throws — rather than truncating — if the book is implausibly large, so a short list is never
 * mistaken for a complete one.
 */
async function listAuthorizedContacts(scope: ConversationScope): Promise<Map<string, ResolvedContact>> {
  const resolved = new Map<string, ResolvedContact>();
  if (scope.kind !== "agents") return resolved;

  for (const { table, ownerColumn, type } of CONTACT_TABLES) {
    for (let page = 0; ; page += 1) {
      if (page >= CONTACT_ENUMERATION_MAX_PAGES) {
        throw new Error(
          `Too many ${table} to list conversations for this view. Narrow the view or contact support.`,
        );
      }
      const offset = page * CONTACT_ENUMERATION_PAGE_SIZE;
      const { data, error } = await supabase
        .from(table)
        .select("id, first_name, last_name, phone, email")
        .eq("organization_id", scope.organizationId)
        .in(ownerColumn, scope.agentIds)
        .order("id", { ascending: true })
        .range(offset, offset + CONTACT_ENUMERATION_PAGE_SIZE - 1);

      if (error) throw new Error(`Failed to load ${table} for conversations: ${error.message}`);

      const rows = (data ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        if (!id || resolved.has(id)) continue;
        resolved.set(id, {
          name: displayName(row.first_name, row.last_name),
          type,
          phone: optionalText(row.phone),
          email: optionalText(row.email),
        });
      }
      if (rows.length < CONTACT_ENUMERATION_PAGE_SIZE) break;
    }
  }

  return resolved;
}

/**
 * One activity source: a single, independently-ordered query shape.
 *
 * Sources are SPLIT on their primary timestamp being null or not, and each half is ordered by the
 * column that actually decides its recency. That split is what makes the legacy fallback exact:
 * ordering one combined query by the nullable primary with nulls last, then keeping the first row
 * per contact, meant a NEWER row whose primary was null always lost to an OLDER row whose primary
 * was set — and, worse, the null rows sorted past the end of the fetched window entirely.
 */
interface SourceSpec {
  label: string;
  table: "messages" | "contact_emails";
  columns: string;
  /** The column that carries this source's event time. */
  orderColumn: string;
  /** The primary timestamp column this source is split on. */
  primaryColumn: string;
  /** `false` → rows where `primaryColumn` IS NOT NULL; `true` → rows where it IS NULL. */
  fallback: boolean;
  /** Column linking a row to a contact, for the authorized-set (agent) path. */
  linkColumn: "contact_id" | "lead_id";
  /** Legacy SMS source: only rows that have no `contact_id` at all. */
  requireNullContactId?: boolean;
  direction?: "inbound" | "outbound";
  /** Organization-wide sweeps skip sources already covered by a sibling. */
  orgSweep: boolean;
  toCandidate: (row: Record<string, unknown>) => ActivityCandidate[];
}

/**
 * One page from one source.
 *
 * `rawCount` is the number of rows the DATABASE returned, kept separate from the candidates they
 * mapped to. Paging exhaustion is a property of the query, not of the mapping: `toCandidate` drops
 * rows that carry no usable contact link, and both `messages.contact_id` and `messages.lead_id` are
 * nullable (the legacy `lead_id` FK is `ON DELETE SET NULL`), as is `contact_emails.contact_id`. A
 * full 200-row page can therefore map to ZERO candidates — and treating that as "the table is
 * exhausted" stopped the sweep one page short of a real conversation.
 *
 * Stated honestly: with `excludeUnlinked` applied to every organization sweep, and `.in(linkColumn,
 * ids)` on every batched read, no query can currently return a row that fails to map — so reverting
 * this to `rows.length` breaks no test. It is kept because exhaustion is a property of the QUERY and
 * must not silently become a property of the mapping again the next time a `toCandidate` learns a
 * new reason to drop a row.
 */
interface SourcePage {
  rows: ActivityCandidate[];
  /** Rows returned by the query itself, BEFORE mapping. Never derived from `rows.length`. */
  rawCount: number;
}

interface ActivitySource {
  label: string;
  /** One page of rows for an explicit contact-id batch, newest first. */
  page: (ids: string[], organizationId: string, offset: number, pageSize?: number) => Promise<SourcePage>;
  /** One page of organization-wide rows, newest first. `null` when this source has no org sweep. */
  orgPage: ((organizationId: string, offset: number) => Promise<SourcePage>) | null;
}

function smsRowToCandidate(row: Record<string, unknown>): ActivityCandidate[] {
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
}

function emailRowToCandidate(row: Record<string, unknown>, direction: "inbound" | "outbound"): ActivityCandidate[] {
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
}

const SMS_COLUMNS = "id, contact_id, lead_id, body, sent_at, created_at, direction";
const EMAIL_COLUMNS = "id, contact_id, subject, body_text, direction, received_at, sent_at, created_at";

/**
 * Apply the filters and ordering shared by BOTH the batched and organization-wide paths.
 *
 * `organization_id` is applied here, so no source can be built without it. Neither RLS nor the
 * global uniqueness of a UUID is the application's tenant boundary (AGENT_RULES §3).
 */
function buildQuery(spec: SourceSpec, organizationId: string, offset: number, pageSize: number) {
  let q = supabase
    .from(spec.table)
    .select(spec.columns)
    .eq("organization_id", organizationId);

  if (spec.direction) q = q.eq("direction", spec.direction);
  if (spec.requireNullContactId) q = q.is("contact_id", null);
  q = spec.fallback ? q.is(spec.primaryColumn, null) : q.not(spec.primaryColumn, "is", null);

  return q
    .order(spec.orderColumn, { ascending: false, nullsFirst: false })
    // Deterministic tiebreak so paging can neither skip nor repeat rows sharing a timestamp.
    .order("id", { ascending: false })
    .range(offset, offset + pageSize - 1);
}

/**
 * Organization sweeps additionally EXCLUDE rows that carry no usable contact link.
 *
 * Raw-count paging (see `SourcePage`) already stops an unlinked page from being mistaken for an
 * exhausted table, but on its own it lets those rows consume the page budget: `messages.contact_id`
 * and `messages.lead_id` are both nullable and the legacy `lead_id` FK is `ON DELETE SET NULL`, so a
 * tenant accumulates orphans through the application's own writes. Enough of them and the sweep
 * would burn all `ORG_ACTIVITY_MAX_PAGES` and throw — turning a quietly short list into a total
 * sidebar outage. Excluding them in the QUERY means every raw row a sweep reads maps to exactly one
 * candidate, so the budget is spent only on rows that can actually become conversations.
 *
 * The batched (agent) path needs none of this: `.in(linkColumn, ids)` already excludes nulls.
 */
function excludeUnlinked(q: ReturnType<typeof buildQuery>, spec: SourceSpec) {
  return spec.table === "messages"
    // `smsRowToCandidate` resolves `contact_id ?? lead_id`, so either link makes the row usable.
    ? q.or("contact_id.not.is.null,lead_id.not.is.null")
    : q.not("contact_id", "is", null);
}

function makeSource(spec: SourceSpec): ActivitySource {
  const read = async (
    apply: (q: ReturnType<typeof buildQuery>) => ReturnType<typeof buildQuery>,
    organizationId: string,
    offset: number,
    pageSize: number,
  ) => {
    const { data, error } = await apply(buildQuery(spec, organizationId, offset, pageSize));
    if (error) throw new Error(`Failed to load ${spec.label} conversations: ${error.message}`);
    const raw = (data ?? []) as Record<string, unknown>[];
    return { rows: raw.flatMap(spec.toCandidate), rawCount: raw.length };
  };

  return {
    label: spec.label,
    page: (ids, organizationId, offset, pageSize = ACTIVITY_PAGE_SIZE) =>
      read((q) => q.in(spec.linkColumn, ids), organizationId, offset, pageSize),
    orgPage: spec.orgSweep
      ? (organizationId, offset) =>
          read((q) => excludeUnlinked(q, spec), organizationId, offset, ACTIVITY_PAGE_SIZE)
      : null,
  };
}

/**
 * Eight sources: {SMS by contact_id, legacy SMS by lead_id, inbound email, outbound email} x
 * {primary timestamp present, primary timestamp null}.
 *
 * The legacy `lead_id` sources have no organization sweep because the organization-wide SMS
 * sources already read every message in the tenant, and `smsRowToCandidate` resolves the
 * `contact_id ?? lead_id` link for them.
 */
const ACTIVITY_SOURCES: ActivitySource[] = [
  { label: "sms:contact_id", table: "messages", columns: SMS_COLUMNS, primaryColumn: "sent_at",
    orderColumn: "sent_at", fallback: false, linkColumn: "contact_id", orgSweep: true,
    toCandidate: smsRowToCandidate },
  { label: "sms:contact_id:legacy-time", table: "messages", columns: SMS_COLUMNS, primaryColumn: "sent_at",
    orderColumn: "created_at", fallback: true, linkColumn: "contact_id", orgSweep: true,
    toCandidate: smsRowToCandidate },
  { label: "sms:lead_id", table: "messages", columns: SMS_COLUMNS, primaryColumn: "sent_at",
    orderColumn: "sent_at", fallback: false, linkColumn: "lead_id", requireNullContactId: true,
    orgSweep: false, toCandidate: smsRowToCandidate },
  { label: "sms:lead_id:legacy-time", table: "messages", columns: SMS_COLUMNS, primaryColumn: "sent_at",
    orderColumn: "created_at", fallback: true, linkColumn: "lead_id", requireNullContactId: true,
    orgSweep: false, toCandidate: smsRowToCandidate },
  { label: "email:inbound", table: "contact_emails", columns: EMAIL_COLUMNS, primaryColumn: "received_at",
    orderColumn: "received_at", fallback: false, linkColumn: "contact_id", direction: "inbound",
    orgSweep: true, toCandidate: (r) => emailRowToCandidate(r, "inbound") },
  { label: "email:inbound:legacy-time", table: "contact_emails", columns: EMAIL_COLUMNS, primaryColumn: "received_at",
    orderColumn: "created_at", fallback: true, linkColumn: "contact_id", direction: "inbound",
    orgSweep: true, toCandidate: (r) => emailRowToCandidate(r, "inbound") },
  { label: "email:outbound", table: "contact_emails", columns: EMAIL_COLUMNS, primaryColumn: "sent_at",
    orderColumn: "sent_at", fallback: false, linkColumn: "contact_id", direction: "outbound",
    orgSweep: true, toCandidate: (r) => emailRowToCandidate(r, "outbound") },
  { label: "email:outbound:legacy-time", table: "contact_emails", columns: EMAIL_COLUMNS, primaryColumn: "sent_at",
    orderColumn: "created_at", fallback: true, linkColumn: "contact_id", direction: "outbound",
    orgSweep: true, toCandidate: (r) => emailRowToCandidate(r, "outbound") },
].map(makeSource);

/**
 * Explicit fan-out budget for the sidebar's activity reads.
 *
 * Splitting each source on its primary timestamp doubled the source count from four to eight, and
 * that cost has to be visible rather than implied: the numbers below are asserted in
 * `recentConversationsScope.test.ts`, so adding a ninth source, widening a page or loosening a page
 * budget fails a test instead of quietly multiplying every sidebar load.
 *
 * Worst case for one load, in queries:
 *   - agent viewer: `ceil(contacts / contactBatchSize)` batches x `sourceCount` sources x
 *     (`maxPagesPerBatch` paged reads + at most `contactBatchSize` single-row skew lookups).
 *     The skew term only applies to a batch whose page budget one contact monopolised.
 *   - organization-wide viewer: `orgSweepSourceCount` x `orgMaxPages`, plus contact resolution.
 *
 * Collapsing this fan-out into a single database view or RPC is deliberately NOT done here — it is
 * Phase B, after the S1 migration-history consolidation.
 */
export const ACTIVITY_QUERY_BUDGET = {
  sourceCount: ACTIVITY_SOURCES.length,
  orgSweepSourceCount: ACTIVITY_SOURCES.filter((s) => s.orgPage !== null).length,
  pageSize: ACTIVITY_PAGE_SIZE,
  contactBatchSize: ACTIVITY_CONTACT_BATCH_SIZE,
  maxPagesPerBatch: ACTIVITY_MAX_PAGES_PER_BATCH,
  orgMaxPages: ORG_ACTIVITY_MAX_PAGES,
} as const;

/**
 * Newest qualifying event per contact, for an EXPLICIT authorized id set.
 *
 * Each source is paged within the batch until either every contact in the batch has an event or the
 * batch's rows run out — so the answer is exact, and nothing outside the batch can consume the
 * window. A pathologically skewed batch (one contact with more rows than the page budget) falls back
 * to a per-contact `.limit(1)` lookup for the contacts still unseen, which keeps it exact without
 * paging indefinitely.
 */
async function newestEventsForContacts(
  contactIds: string[],
  organizationId: string,
): Promise<ActivityCandidate[]> {
  const found: ActivityCandidate[] = [];

  for (let start = 0; start < contactIds.length; start += ACTIVITY_CONTACT_BATCH_SIZE) {
    const batch = contactIds.slice(start, start + ACTIVITY_CONTACT_BATCH_SIZE);

    for (const source of ACTIVITY_SOURCES) {
      const seen = new Set<string>();
      let exhausted = false;

      for (let page = 0; page < ACTIVITY_MAX_PAGES_PER_BATCH; page += 1) {
        const { rows, rawCount } = await source.page(batch, organizationId, page * ACTIVITY_PAGE_SIZE);
        for (const row of rows) {
          if (seen.has(row.contact_id)) continue;
          seen.add(row.contact_id);
          found.push(row);
        }
        // RAW count, never `rows.length`: a page whose rows all failed to map is a full page the
        // database still has more behind. Every row here is link-constrained by `.in(...)`, so the
        // two counts coincide today — reading the raw one keeps that an observation rather than an
        // assumption the mapping is free to break.
        if (rawCount < ACTIVITY_PAGE_SIZE) { exhausted = true; break; }
        if (seen.size >= batch.length) { exhausted = true; break; }
      }

      // Only reached when one contact's traffic filled the page budget. Exact, and bounded by the
      // handful of contacts in THIS batch that are still unaccounted for.
      if (!exhausted) {
        for (const id of batch) {
          if (seen.has(id)) continue;
          // Exactly one row: the newest for this one contact in this one source.
          const { rows } = await source.page([id], organizationId, 0, 1);
          if (rows.length > 0) found.push(rows[0]);
        }
      }
    }
  }

  return found;
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

    const authorized =
      scope.kind === "agents"
        ? await listAuthorizedContacts(scope)
        : new Map<string, ResolvedContact>();

    let candidates: ActivityCandidate[];

    if (scope.kind === "agents") {
      // AUTHORIZED-SET-FIRST. Every activity query is constrained to contacts this viewer owns, so
      // organization-wide traffic cannot enter the window at all — there is no pre-authorization cap
      // to silently change the answer, and the newest qualifying conversations are exact.
      if (authorized.size === 0) return [];
      candidates = await newestEventsForContacts(Array.from(authorized.keys()), scope.organizationId);
    } else {
      // Organization-wide viewer: every row the policy returns is already inside the viewer's
      // tenant, so there is no unauthorized activity to crowd anything out. The organization filter
      // is still applied EXPLICITLY rather than inherited from RLS (AGENT_RULES §3).
      candidates = [];
      const unresolvable = new Set<string>();

      for (const source of ACTIVITY_SOURCES) {
        // A source with no organization sweep is wholly covered by a sibling that reads the same
        // rows without the link-column restriction.
        const orgPage = source.orgPage;
        if (!orgPage) continue;

        // Termination is proved PER SOURCE. This source may stop only once it has independently
        // found `limit` distinct resolved contacts OF ITS OWN, run out of rows, or hit the page
        // budget (which is surfaced, never swallowed). Counting across the shared candidate array
        // let one busy source settle every other one — an SMS-heavy tenant could stop the email
        // sweep after a single page and drop email-only conversations out of the sidebar entirely.
        const resolvedHere = new Set<string>();
        let settled = false;
        for (let page = 0; page < ORG_ACTIVITY_MAX_PAGES; page += 1) {
          const { rows, rawCount } = await orgPage(scope.organizationId, page * ACTIVITY_PAGE_SIZE);
          // Exhaustion is a property of the QUERY, not of the mapping. A full page of rows that
          // carry no usable contact link maps to zero candidates; reading that as "no more rows"
          // ended the sweep one page short of a real conversation.
          if (rawCount === 0) { settled = true; break; }

          const unseen = Array.from(new Set(
            rows.map((r) => r.contact_id).filter((id) => !authorized.has(id) && !unresolvable.has(id)),
          ));
          if (unseen.length > 0) {
            const resolved = await resolveContactsInScope(unseen, scope);
            for (const id of unseen) {
              const hit = resolved.get(id);
              if (hit) authorized.set(id, hit);
              else unresolvable.add(id); // orphaned by a hard-deleted contact
            }
          }
          for (const row of rows) {
            if (!authorized.has(row.contact_id)) continue;
            candidates.push(row);
            resolvedHere.add(row.contact_id);
          }

          // Rows are newest-first within a source, so once `limit` distinct contacts have been
          // seen here every later row from THIS source is older than all of them and cannot reach
          // the final page of results.
          if (resolvedHere.size >= limit) { settled = true; break; }
          if (rawCount < ACTIVITY_PAGE_SIZE) { settled = true; break; }
        }
        if (!settled) {
          // Explicit and surfaced, never a console warning behind a plausible-looking short list.
          throw new Error(
            "This organization has too much recent activity to list conversations reliably. Please narrow the view.",
          );
        }
      }
    }

    return pickNewestPerContact(candidates)
      .slice(0, limit)
      .map((row) => {
        // Non-null by construction: candidates only ever carry authorized contact ids.
        const contact = authorized.get(row.contact_id) as ResolvedContact;
        return {
          contact_id: row.contact_id,
          contact_name: contactDisplayLabel(contact),
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
      contact_name: contactDisplayLabel(hit),
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
