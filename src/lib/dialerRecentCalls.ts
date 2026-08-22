/**
 * FloatingDialer recent-calls identity (plan rev5 R8): the `calls` row itself is authoritative.
 * Linked rows (non-null `contact_id`) resolve their CRM name BY ID from the table named by
 * `contact_type`; unlinked rows render the permanent snapshot name, else the ANI. The old
 * leads-only `.ilike` phone probe — first-match-wins per last-10, with its
 * `status === "Closed Won" ⇒ 'client'` type invention — is deleted, not reimplemented here.
 */

import { normalizeInboundContactType } from "@/lib/inboundCallOwnership";

export interface RecentCallsSourceRow {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  disposition_name: string | null;
  started_at: string | null;
  created_at: string | null;
  contact_type: string | null;
}

export interface RecentCallDisplayRow {
  id: string;
  contact_name: string | null;
  phone: string;
  disposition_name: string | null;
  disposition_color: string | null;
  created_at: string;
  contact_type?: "lead" | "client" | "recruit";
  display_name: string;
  matched_lead_id: string | null;
  matched_contact_type?: "lead" | "client" | "recruit";
}

/** Snapshot-name-else-ANI; linked rows carry their true contact_id/contact_type forward. */
export function buildRecentCallDisplay(row: RecentCallsSourceRow): RecentCallDisplayRow {
  const phone = String(row.contact_phone ?? "").trim();
  const snap = String(row.contact_name ?? "").trim();
  const type = normalizeInboundContactType(row.contact_type);
  const contactId = String(row.contact_id ?? "").trim() || null;
  return {
    id: row.id,
    contact_name: row.contact_name,
    phone,
    disposition_name: row.disposition_name,
    disposition_color: null,
    created_at: row.started_at || row.created_at || new Date().toISOString(),
    contact_type: type,
    display_name: snap || phone || "Unknown",
    matched_lead_id: contactId,
    matched_contact_type: contactId ? type : undefined,
  };
}

export interface LinkedContactRefs {
  leadIds: string[];
  clientIds: string[];
  recruitIds: string[];
}

/** Batch linked ids per true type so enrichment is three by-id selects — never a phone probe. */
export function collectLinkedContactRefs(rows: RecentCallDisplayRow[]): LinkedContactRefs {
  const leadIds = new Set<string>();
  const clientIds = new Set<string>();
  const recruitIds = new Set<string>();
  for (const r of rows) {
    if (!r.matched_lead_id) continue;
    if (r.matched_contact_type === "lead") leadIds.add(r.matched_lead_id);
    else if (r.matched_contact_type === "client") clientIds.add(r.matched_lead_id);
    else if (r.matched_contact_type === "recruit") recruitIds.add(r.matched_lead_id);
  }
  return {
    leadIds: [...leadIds],
    clientIds: [...clientIds],
    recruitIds: [...recruitIds],
  };
}

/** Overlay CRM names onto LINKED rows only (keyed by contact_id); unlinked rows are untouched. */
export function applyLinkedContactNames(
  rows: RecentCallDisplayRow[],
  namesById: Map<string, { first_name: string | null; last_name: string | null }>,
): RecentCallDisplayRow[] {
  return rows.map((r) => {
    if (!r.matched_lead_id) return r;
    const m = namesById.get(r.matched_lead_id);
    if (!m) return r;
    const name = `${m.first_name || ""} ${m.last_name || ""}`.trim();
    if (!name) return r;
    return { ...r, display_name: name };
  });
}

export interface QuickCallContact {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  type?: "lead" | "client" | "recruit";
}

/** Quick-call carries the TRUE contact_type (undefined when the row is unlinked/untyped). */
export function quickCallContactFromRecent(call: RecentCallDisplayRow): QuickCallContact {
  const name = call.display_name === "Unknown" ? "" : call.display_name;
  const parts = name.includes(" ") ? name.split(" ") : [name, ""];
  return {
    id: call.matched_lead_id || "",
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" ").trim(),
    phone: call.phone,
    type: call.matched_contact_type || call.contact_type,
  };
}
