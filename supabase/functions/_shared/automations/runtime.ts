import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { registeredBlock } from "./blockRegistry.ts";
import type { AutomationGraph } from "./graph.ts";

export interface AutomationClaim {
  organization_id: string;
  workflow_id: string;
  version_id: string;
  run_id: string;
  node_id: string;
  lease_token: string;
  contact_type: "lead";
  contact_id: string;
  status: "queued" | "held" | "waiting";
  stop_on_reply: boolean;
  uncertain_handoff?: boolean;
  due_lag_ms?: number;
  graph: AutomationGraph;
}
type Contact = Record<string, unknown>;
type Outcome = { status: string; reason?: string };
export type ChannelHandler = (
  db: SupabaseClient, claim: AutomationClaim,
  node: { type: "send_sms" | "send_email"; config: Record<string, unknown> }, contact: Contact,
) => Promise<Outcome>;

export async function evaluateClaim(
  claim: AutomationClaim,
  loadContact: () => Promise<Contact | null>,
  send: (type: "send_sms" | "send_email", config: Record<string, unknown>, contact: Contact) => Promise<Outcome>,
): Promise<Outcome> {
  if (claim.uncertain_handoff) return { status: "unknown", reason: "Awaiting confirmation of the original handoff" };
  const node = claim.graph.nodes.find((candidate) => candidate.id === claim.node_id);
  const block = node && registeredBlock(node.type, node.version);
  if (!node || !block?.execute) return { status: "failed", reason: "Published block is unavailable" };
  return await block.execute(node.config, {
    status: claim.status, send,
    async withContact(handler) {
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
    const { data, error } = await db.from("leads").select("*")
      .eq("organization_id", claim.organization_id).eq("id", claim.contact_id).maybeSingle();
    if (error) throw error;
    return data;
  }, (type, config, contact) => handler(db,claim,{type,config},contact));
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
