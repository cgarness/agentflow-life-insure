import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { idSchema } from "./schemas";

/**
 * Read-only lookups for the policy commission preview. Every read is a plain RLS-governed select (or the
 * existing invoker Team-scope RPC) explicitly constrained to the viewer's organization; nothing here
 * writes, widens access or falls back to other data. Callers fail closed on any thrown error.
 */
export class PreviewReadError extends Error {
  constructor(readonly reason: "failed" | "not_found") {
    super(reason === "not_found" ? "Record not found" : "Commission preview data could not be loaded");
    this.name = "PreviewReadError";
  }
}

export type CreditedOwnerSource = { kind: "lead" | "client"; id: string };

const ownerRowSchema = z.object({ assigned_agent_id: idSchema.nullable() });

/** The stored owner the sale writers credit (`assigned_agent_id`); null means no assigned agent. */
export async function fetchCreditedOwner(source: CreditedOwnerSource, organizationId: string): Promise<string | null> {
  const table = source.kind === "lead" ? "leads" : "clients";
  const { data, error } = await supabase
    .from(table)
    .select("assigned_agent_id")
    .eq("id", source.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new PreviewReadError("failed");
  if (!data) throw new PreviewReadError("not_found");
  const parsed = ownerRowSchema.safeParse(data);
  if (!parsed.success) throw new PreviewReadError("failed");
  return parsed.data.assigned_agent_id;
}

const profileRowSchema = z.object({
  id: idSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  commission_level: z.string().nullable(),
});

export interface CreditedAgentProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** The raw stored value: missing stays missing (never mapped to a default level). */
  commissionLevel: string | null;
}

/** Another agent's profile in the viewer's organization, or null when there is no such profile. */
export async function fetchCreditedAgentProfile(agentId: string, organizationId: string): Promise<CreditedAgentProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, commission_level")
    .eq("id", agentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new PreviewReadError("failed");
  if (!data) return null;
  const parsed = profileRowSchema.safeParse(data);
  if (!parsed.success) throw new PreviewReadError("failed");
  const row = parsed.data;
  return {
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.email ?? "",
    commissionLevel: row.commission_level,
  };
}

const scopeRowsSchema = z.array(z.object({ id: idSchema }).passthrough());

/** The signed-in Team Leader's existing Contacts Team scope: self plus `is_ancestor_of` descendants. */
export async function fetchTeamScopeAgentIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_contact_scope_agents");
  if (error) throw new PreviewReadError("failed");
  const parsed = scopeRowsSchema.safeParse(data ?? []);
  if (!parsed.success) throw new PreviewReadError("failed");
  return parsed.data.map((row) => row.id);
}
