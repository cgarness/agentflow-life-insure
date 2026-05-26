import { supabase } from "@/integrations/supabase/client";

export type DuplicateRule = "phone_only" | "email_only" | "phone_or_email" | "phone_and_email";
export type DuplicateScope = "all_agents" | "assigned_only";
export type ManualAction = "warn" | "block" | "allow";
export type CsvAction = "skip" | "flag" | "import";
export type DuplicateContactType = "leads" | "clients" | "recruits";

export interface DuplicateMatch {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  assignedAgentId: string | null;
}

export function normalizePhone(p: unknown): string {
  return (typeof p === "string" ? p : "").replace(/\D/g, "");
}

export function normalizeEmail(e: unknown): string {
  return (typeof e === "string" ? e : "").toLowerCase().trim();
}

export function rowsMatch(
  rule: DuplicateRule,
  newPhone: string,
  newEmail: string,
  rowPhone: string,
  rowEmail: string,
): boolean {
  if (rule === "phone_only") return !!newPhone && newPhone === rowPhone;
  if (rule === "email_only") return !!newEmail && newEmail === rowEmail;
  if (rule === "phone_and_email") {
    return !!newPhone && !!newEmail && newPhone === rowPhone && newEmail === rowEmail;
  }
  // phone_or_email (default)
  return (!!newPhone && newPhone === rowPhone) || (!!newEmail && newEmail === rowEmail);
}

export interface FindDuplicatesOpts {
  table: DuplicateContactType;
  organizationId: string;
  rule: DuplicateRule;
  scope: DuplicateScope;
  phone?: string | null;
  email?: string | null;
  /** Required when scope = "assigned_only"; falls back to all_agents if missing. */
  assignedAgentId?: string | null;
  /** Skip this id when checking (used on edit). */
  excludeId?: string | null;
}

export async function findDuplicates(opts: FindDuplicatesOpts): Promise<DuplicateMatch[]> {
  const newPhone = normalizePhone(opts.phone);
  const newEmail = normalizeEmail(opts.email);
  if (!newPhone && !newEmail) return [];

  let query = (supabase as any)
    .from(opts.table)
    .select("id, first_name, last_name, phone, email, assigned_agent_id")
    .eq("organization_id", opts.organizationId);

  if (opts.scope === "assigned_only" && opts.assignedAgentId) {
    query = query.eq("assigned_agent_id", opts.assignedAgentId);
  }
  if (opts.excludeId) {
    query = query.neq("id", opts.excludeId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const matches: DuplicateMatch[] = [];
  for (const r of (data as any[]) ?? []) {
    if (rowsMatch(opts.rule, newPhone, newEmail, normalizePhone(r.phone), normalizeEmail(r.email))) {
      matches.push({
        id: r.id,
        firstName: r.first_name ?? "",
        lastName: r.last_name ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
        assignedAgentId: r.assigned_agent_id ?? null,
      });
    }
  }
  return matches;
}

export function describeDuplicate(m: DuplicateMatch): string {
  const name = `${m.firstName} ${m.lastName}`.trim() || "(no name)";
  if (m.phone && m.email) return `${name} — ${m.phone} / ${m.email}`;
  if (m.phone) return `${name} — ${m.phone}`;
  if (m.email) return `${name} — ${m.email}`;
  return name;
}
