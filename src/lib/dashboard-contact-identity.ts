/**
 * dashboard-contact-identity — the ONE place that decides who a Dashboard row is about.
 *
 * These helpers previously lived module-private inside `DashboardDetailModal.tsx`, so
 * tests could not import them and had to re-declare copies — meaning the tests pinned
 * a duplicate rather than the shipped logic. They are exported here and imported by
 * both the runtime and the tests.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **`calls.id` is never a contact identity.** `calls_today` / `missed_calls` rows
 *     come from `calls`, where `id` is the call row. Navigating with it produced a
 *     `/contacts?contact=<call-uuid>` link that could never resolve.
 *  2. **An unknown contact type is never assumed to be `lead`.** `calls.contact_type`
 *     is NULL on most real rows (AGENT_RULES §5), and the previous two-valued fallback
 *     (`=== "client" ? "client" : "lead"`) sent unresolved rows — and every recruit —
 *     to the Leads tab. Unresolved now means `null`, and `null` disables the action.
 */

import { supabase } from "@/integrations/supabase/client";
import type { QuickCallContactType } from "@/lib/quick-call";

export type ContactType = QuickCallContactType;

/** Contact tables a Dashboard row can resolve against. */
const CONTACT_TABLES: ReadonlyArray<{ table: "leads" | "clients" | "recruits"; type: ContactType }> = [
  { table: "leads", type: "lead" },
  { table: "clients", type: "client" },
  { table: "recruits", type: "recruit" },
];

/** True only for the three values `calls_contact_type_check` permits. */
export function isValidContactType(value: unknown): value is ContactType {
  return value === "lead" || value === "client" || value === "recruit";
}

/**
 * Contact id for a row, or `null`.
 *
 * `callsContactId` is the `calls.contact_id` column — **never** `calls.id`.
 * `ownIdIsContact` marks rows that came straight from a contact table, where the row's
 * own `id` *is* the contact.
 */
export function resolveContactId(row: {
  contactId?: string | null;
  ownId?: string | null;
  ownIdIsContact?: boolean;
}): string | null {
  if (typeof row.contactId === "string" && row.contactId.length > 0) return row.contactId;
  if (row.ownIdIsContact && typeof row.ownId === "string" && row.ownId.length > 0) {
    return row.ownId;
  }
  return null;
}

/**
 * Contact type for a row, or `null` when it cannot be resolved.
 *
 * Order: (1) a valid explicit `calls.contact_type`; (2) a trusted row-source marker set
 * by the query that produced the row; (3) a batched lookup result from
 * `resolveContactTypesByIds`. Anything else is `null` — including an id that resolved
 * ambiguously to more than one contact table.
 */
export function resolveContactType(
  row: { explicitType?: unknown; sourceMarker?: ContactType | null },
  lookedUp?: ContactType | null,
): ContactType | null {
  if (isValidContactType(row.explicitType)) return row.explicitType;
  if (isValidContactType(row.sourceMarker)) return row.sourceMarker;
  return isValidContactType(lookedUp) ? lookedUp : null;
}

/**
 * Batch-resolve contact ids to their type by looking them up in the contact tables the
 * caller can actually see. Only RLS-visible rows participate, so this never widens access.
 *
 * An id present in more than one table is **ambiguous** and maps to `null` rather than
 * guessing a precedence — an ambiguous identity must fail safely, not navigate.
 * An id present in none maps to `null` (deleted, or not visible to this user).
 */
export async function resolveContactTypesByIds(
  ids: string[],
): Promise<Map<string, ContactType | null>> {
  const resolved = new Map<string, ContactType | null>();
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return resolved;

  const hits = new Map<string, ContactType[]>();
  const results = await Promise.all(
    CONTACT_TABLES.map(({ table }) => supabase.from(table).select("id").in("id", unique)),
  );

  results.forEach((result, index) => {
    const { type } = CONTACT_TABLES[index];
    for (const row of result.data ?? []) {
      const list = hits.get(row.id) ?? [];
      list.push(type);
      hits.set(row.id, list);
    }
  });

  for (const id of unique) {
    const matches = hits.get(id) ?? [];
    // Exactly one table => resolved. Zero => unknown. More than one => ambiguous.
    resolved.set(id, matches.length === 1 ? matches[0] : null);
  }
  return resolved;
}

/**
 * Batch-resolve contact ids to `{ type, name, phone }` from the visible contact rows.
 * Used where a row needs a dialable number it does not carry itself.
 */
export async function resolveContactDetailsByIds(
  ids: string[],
): Promise<Map<string, { type: ContactType; name: string; phone: string }>> {
  const details = new Map<string, { type: ContactType; name: string; phone: string }>();
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return details;

  const seenIn = new Map<string, number>();
  const results = await Promise.all(
    CONTACT_TABLES.map(({ table }) =>
      supabase.from(table).select("id, first_name, last_name, phone").in("id", unique),
    ),
  );

  results.forEach((result, index) => {
    const { type } = CONTACT_TABLES[index];
    for (const row of result.data ?? []) {
      seenIn.set(row.id, (seenIn.get(row.id) ?? 0) + 1);
      details.set(row.id, {
        type,
        name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
        phone: row.phone ?? "",
      });
    }
  });

  // Drop ambiguous ids entirely — an id in two contact tables must not resolve.
  for (const [id, count] of seenIn) if (count > 1) details.delete(id);
  return details;
}

/**
 * Contacts tab for a type, or `null` when the type is unresolved.
 *
 * `null` means **do not navigate**. A known client or recruit can never reach Leads.
 */
export function contactsTabFor(type: ContactType | null): string | null {
  switch (type) {
    case "client":
      return "Clients";
    case "recruit":
      return "Recruits";
    case "lead":
      return "Leads";
    default:
      return null;
  }
}

/** Contacts deep link, or `null` when identity or type is unresolved. */
export function contactHref(contactId: string | null, type: ContactType | null): string | null {
  const tab = contactsTabFor(type);
  if (!contactId || !tab) return null;
  return `/contacts?contact=${contactId}&tab=${tab}`;
}
