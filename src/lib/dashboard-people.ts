/**
 * Agent names for Dashboard Team-mode context (Polish V2 plan §6).
 *
 * PRESENTATION ONLY. Names label records the viewer can already see; they never decide what is
 * shown, never authorize anything and never act as a contact identity.
 * - One batched read per load (≤ 100 ids per request), always scoped to the viewer's organization
 *   (`profiles_select_org` already allows same-organization reads). Never N+1, never another agency.
 * - Only names: no avatar strings (decision D7, initials only).
 * - A failed lookup is reported as `unavailable`, so the UI says "Name unavailable" and never
 *   invents a name. It does not fail the section. A cancellation or a hidden/offline tab still
 *   propagates, so the section lane defers as usual.
 */
import { supabase } from "@/integrations/supabase/client";
import { assertPageActive, PageInactiveError } from "@/lib/pageActivity";
import { isUuidLike } from "@/lib/missedCallScope";
import { chunk } from "@/lib/dashboard-attention";
import { linkedAbort, settleAll } from "@/lib/requestLifetime";

export const PEOPLE_BATCH_SIZE = 100;

export interface PersonName {
  id: string;
  name: string;
  initials: string;
}

export interface PeopleLookup {
  names: ReadonlyMap<string, PersonName>;
  /** The lookup failed: names that are missing are unknown, not absent. */
  unavailable: boolean;
}

export const EMPTY_PEOPLE: PeopleLookup = { names: new Map(), unavailable: false };

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Names for these profile ids in the viewer's organization. */
export async function resolvePeople(
  organizationId: string | null,
  ids: ReadonlyArray<string | null | undefined>,
  signal?: AbortSignal,
): Promise<PeopleLookup> {
  const unique = [...new Set(ids.filter((id): id is string => isUuidLike(id)).map((id) => id.toLowerCase()))];
  if (unique.length === 0) return EMPTY_PEOPLE;
  // Fail closed: without the viewer's organization nothing is read.
  if (!organizationId) return { names: new Map(), unavailable: true };

  // A follow-on read: a tab hidden or offline since the rows arrived sends nothing more.
  assertPageActive();
  const cancel = linkedAbort(signal);
  try {
    const results = await settleAll(
      chunk(unique, PEOPLE_BATCH_SIZE).map((batch) =>
        supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .eq("organization_id", organizationId)
          .in("id", batch)
          .abortSignal(cancel.signal)
          .then((res) => {
            if (res.error) throw res.error;
            return res.data ?? [];
          }),
      ),
      cancel.abort,
    );
    const names = new Map<string, PersonName>();
    for (const row of results.flat()) {
      const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      if (name) names.set(row.id.toLowerCase(), { id: row.id, name, initials: initialsOf(name) });
    }
    return { names, unavailable: false };
  } catch (err) {
    if (err instanceof PageInactiveError || signal?.aborted) throw err;
    console.error("[Dashboard] Agent name lookup failed:", err);
    return { names: new Map(), unavailable: true };
  } finally {
    cancel.dispose();
  }
}

/**
 * Campaign names for callback source labels ("Campaign · Final Expense Q4"), same rules as people:
 * batched, organization-scoped, presentation only; a failure leaves the plain "Campaign" label.
 */
export async function resolveCampaignNames(
  organizationId: string | null,
  ids: ReadonlyArray<string | null | undefined>,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => isUuidLike(id)))];
  if (unique.length === 0 || !organizationId) return new Map();
  assertPageActive();
  const cancel = linkedAbort(signal);
  try {
    const results = await settleAll(
      chunk(unique, PEOPLE_BATCH_SIZE).map((batch) =>
        supabase
          .from("campaigns")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", batch)
          .abortSignal(cancel.signal)
          .then((res) => {
            if (res.error) throw res.error;
            return res.data ?? [];
          }),
      ),
      cancel.abort,
    );
    return new Map(results.flat().filter((row) => row.name).map((row) => [row.id, row.name as string]));
  } catch (err) {
    if (err instanceof PageInactiveError || signal?.aborted) throw err;
    console.error("[Dashboard] Campaign name lookup failed:", err);
    return new Map();
  } finally {
    cancel.dispose();
  }
}

/** A person's display name, or the honest fallback. */
export function personLabel(people: PeopleLookup, id: string | null | undefined): string {
  if (!id) return "Name unavailable";
  return people.names.get(id.toLowerCase())?.name ?? "Name unavailable";
}

/** Routing metadata of a missed inbound call (AGENT_RULES #30 / D13). */
export interface MissedCallRouting {
  missed_for_agent_id?: string | null;
  missed_recipient_ids?: string[] | null;
  routed_agent_ids?: string[] | null;
  answered_by_agent_id?: string | null;
}

/**
 * Who a missed call was for, from the ROUTING record only — never `calls.agent_id`, which is empty
 * on a missed call. One intended recipient is named; a call that rang several agents is described as
 * such, and never attributed to one of them.
 */
export type MissedCallRecipients =
  | { kind: "one"; agentId: string }
  | { kind: "several"; agentIds: string[] }
  | { kind: "none" };

export function missedCallRecipients(row: MissedCallRouting): MissedCallRecipients {
  if (isUuidLike(row.missed_for_agent_id)) return { kind: "one", agentId: row.missed_for_agent_id };
  for (const list of [row.missed_recipient_ids, row.routed_agent_ids]) {
    const ids = [...new Set((list ?? []).filter((id): id is string => isUuidLike(id)))];
    if (ids.length === 1) return { kind: "one", agentId: ids[0] };
    if (ids.length > 1) return { kind: "several", agentIds: ids };
  }
  return { kind: "none" };
}

/** Every profile id a missed call's routing record names (for the batched name read). */
export function missedCallPeopleIds(row: MissedCallRouting): string[] {
  const recipients = missedCallRecipients(row);
  const ids = recipients.kind === "one" ? [recipients.agentId] : recipients.kind === "several" ? recipients.agentIds : [];
  return isUuidLike(row.answered_by_agent_id) ? [...ids, row.answered_by_agent_id] : ids;
}

/** "Missed for Alex Rivera" · "Rang 3 agents: Alex Rivera, Sam Lee, …" · "No recipient recorded". */
export function describeMissedCallRecipients(row: MissedCallRouting, people: PeopleLookup): string {
  const recipients = missedCallRecipients(row);
  if (recipients.kind === "one") return `Missed for ${personLabel(people, recipients.agentId)}`;
  if (recipients.kind === "none") return "No recipient recorded";
  const shown = recipients.agentIds.slice(0, 3).map((id) => personLabel(people, id));
  const more = recipients.agentIds.length > 3 ? `, +${recipients.agentIds.length - 3}` : "";
  return `Rang ${recipients.agentIds.length} agents: ${shown.join(", ")}${more}`;
}
