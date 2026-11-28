import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { registeredBlock } from "./blockRegistry.ts";
import { fieldValues, renderFields } from "./fields.ts";
import type { AutomationGraph } from "./graph.ts";

/** Facts the database resolved for this step when it leased the run. */
export interface ClaimContext {
  appointment_start?: string | null;
  agency_timezone?: string | null;
  caller_phone?: string | null;
  /** Purpose pinned for this published SMS step. */
  sms_purpose?: string | null;
}
export interface AutomationClaim {
  organization_id: string;
  workflow_id: string;
  version_id: string;
  run_id: string;
  node_id: string;
  lease_token: string;
  contact_type: "lead" | "client" | "recruit" | null;
  contact_id: string | null;
  status: "queued" | "held" | "waiting";
  stop_on_reply: boolean;
  uncertain_handoff?: boolean;
  due_lag_ms?: number;
  trigger?: string | null;
  context?: ClaimContext | null;
  graph: AutomationGraph;
}
type Contact = Record<string, unknown>;
type Outcome = { status: string; reason?: string };
type MessageNode = { type: "send_sms" | "send_email"; version: number; config: Record<string, unknown> };
export type ChannelHandler = (
  db: SupabaseClient, claim: AutomationClaim, node: MessageNode, contact: Contact,
) => Promise<Outcome>;
type TaskHandler = (config: Record<string, unknown>, contact: Contact | null) => Promise<Outcome>;

const CONTACT_TABLES = { lead: "leads", client: "clients", recruit: "recruits" } as const;

export async function evaluateClaim(
  claim: AutomationClaim,
  loadContact: () => Promise<Contact | null>,
  send: (type: MessageNode["type"], config: Record<string, unknown>, contact: Contact, version: number) => Promise<Outcome>,
  createTask: TaskHandler = () => Promise.resolve({ status: "failed", reason: "Task creation is unavailable" }),
): Promise<Outcome> {
  if (claim.uncertain_handoff) return { status: "unknown", reason: "Awaiting confirmation of the original handoff" };
  const node = claim.graph.nodes.find((candidate) => candidate.id === claim.node_id);
  const block = node && registeredBlock(node.type, node.version);
  if (!node || !block?.execute) return { status: "failed", reason: "Published block is unavailable" };
  return await block.execute(node.config, {
    status: claim.status,
    send: (type, config, contact) =>
      // Automated messages use the lead delivery path. Other contacts continue past the step.
      claim.contact_type !== "lead"
        ? Promise.resolve({ status: "skipped", reason: "Automated messages are available for leads only" })
        : send(type, config, contact, node.version),
    async createTask(config) {
      let contact: Contact | null = null;
      if (claim.contact_id) {
        try { contact = await loadContact(); }
        catch { return { status: "held", reason: "Contact lookup unavailable" }; }
      }
      return await createTask(config, contact);
    },
    async withContact(handler) {
      if (!claim.contact_id) return { status: "skipped", reason: "This run has no matched contact" };
      let contact: Contact | null;
      try { contact = await loadContact(); }
      catch { return { status: "held", reason: "Contact lookup unavailable" }; }
      if (!contact) return { status: "held", reason: "Contact unavailable in this agency" };
      return await handler(contact);
    },
  });
}

export async function runAutomationClaim(db: SupabaseClient, claim: AutomationClaim, handler: ChannelHandler) {
  const outcome = await evaluateClaim(claim, async () => {
    const table = claim.contact_type ? CONTACT_TABLES[claim.contact_type] : undefined;
    if (!table || !claim.contact_id) return null;
    const { data, error } = await db.from(table).select("*")
      .eq("organization_id", claim.organization_id).eq("id", claim.contact_id).maybeSingle();
    if (error) throw error;
    return data;
  }, (type, config, contact, version) => handler(db, claim, { type, version, config }, contact), async (config, contact) => {
    // Internal task text is written in the agency time zone. The database resolves the assignee and due time.
    const values = fieldValues({
      contact,
      appointment_start: claim.context?.appointment_start,
      timezone: claim.context?.agency_timezone,
      caller_phone: claim.context?.caller_phone,
    });
    const title = renderFields(config.title, values);
    const notes = renderFields(config.notes, values);
    const missing = [...new Set([...title.missing, ...notes.missing])];
    if (missing.length) {
      return { status: "held", reason: "Set the agency time zone to use " + missing.join(" and ") + " in a task." };
    }
    const { data, error } = await db.rpc("automation_create_task", {
      p_run: claim.run_id, p_token: claim.lease_token, p_node: claim.node_id,
      p_title: title.text.trim(), p_notes: notes.text.trim() || null,
    });
    if (error) return { status: "held", reason: "Task could not be saved. It will be retried." };
    const result = data as { status?: unknown; reason?: unknown } | null;
    if (typeof result?.status !== "string") return { status: "held", reason: "Task result was not confirmed." };
    return { status: result.status, reason: typeof result.reason === "string" ? result.reason : undefined };
  });
  const { error } = await db.rpc("automation_finish_node", {
    p_run: claim.run_id, p_token: claim.lease_token, p_result: outcome.status, p_reason: outcome.reason ?? null,
  });
  if (error) throw error;
}

// An interrupted batch leaves only expiring leases. Transport uncertainty is reconciled by the channel ledger.
export async function sweepAutomationWork(db: SupabaseClient, handler: ChannelHandler) {
  const failedStages: string[] = [];
  async function batch<T>(rpc: string, limit: number, fallback: T): Promise<T> {
    try {
      const { data, error } = await db.rpc(rpc, { p_limit: limit });
      if (error) throw error;
      return (data ?? fallback) as T;
    } catch {
      failedStages.push(rpc);
      return fallback;
    }
  }

  const enrolled = await batch<number | null>("automation_process_events", 10, null);
  // Continue immediately due successors within this invocation. Oldest due work still wins
  // each lease, including work for other agencies. The next scheduled tick drains any remainder.
  const deadline = Date.now() + 20_000;
  let claimed = 0;
  let failedClaims = 0;
  let maxDueLagMs = 0;
  for (let page = 0; page < 4 && Date.now() < deadline; page++) {
    const pending = await batch<AutomationClaim[]>("automation_claim_work", 10, []);
    if (pending.length === 0) break;
    claimed += pending.length;
    maxDueLagMs = Math.max(maxDueLagMs, ...pending.map(claim => claim.due_lag_ms ?? 0));
    const outcomes = await Promise.allSettled(pending.map(claim => runAutomationClaim(db, claim, handler)));
    failedClaims += outcomes.filter(result => result.status === "rejected").length;
  }
  const repaired = await batch<number | null>("automation_repair_messages", 20, null);
  return {
    enrolled, claimed, repaired, max_due_lag_ms: maxDueLagMs, failed_stages: failedStages, failed_claims: failedClaims,
  };
}
