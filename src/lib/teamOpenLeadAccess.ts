/**
 * teamOpenLeadAccess — pure access predicates for the Team / Open Pool dialer (Option F).
 * Existing authorization only: these gate UI actions; RLS stays the authority on every write.
 */
import type { TeamOpenMasterStatus } from "@/hooks/useTeamOpenMasterLead";

/** Master-only columns the loader can only get from the RLS-governed `leads` embed. */
const MASTER_ONLY_KEYS = [
  "custom_fields",
  "date_of_birth",
  "best_time_to_call",
  "spouse_info",
  "notes",
  "lead_source",
  "assigned_agent_id",
  "lead_score",
  "last_contacted_at",
  "created_at",
] as const;

/**
 * The queue row with the authorized master row's master-only fields laid over it, for consumers
 * that map the whole contact (ConvertLeadModal, the Full View). Snapshot-backed fields (name,
 * phone, email, state, age, status) keep the queue row's values exactly as the loader merged them.
 * Without a master row the queue row is returned unchanged.
 */
export function withTeamOpenMasterLead<T extends Record<string, unknown> | null>(
  row: T,
  master: Record<string, unknown> | null,
): T {
  if (!row || !master) return row;
  const over: Record<string, unknown> = {};
  for (const k of MASTER_ONLY_KEYS) if (k in master) over[k] = master[k];
  return { ...row, ...over } as T;
}

/**
 * Sold / Convert fails CLOSED for Team/Open until the full master lead is loaded: converting the
 * campaign copy would build the client from an empty `custom_fields` and `convert_lead_to_client_atomic`
 * then deletes the lead — the custom values would be lost permanently. Personal is unaffected.
 */
export function canConvertTeamOpenLead(lockMode: boolean, masterStatus: TeamOpenMasterStatus): boolean {
  return !lockMode || masterStatus === "loaded";
}

export const TEAM_OPEN_CONVERT_BLOCKED_MESSAGE =
  "This lead can't be converted yet: its full contact record isn't available to you, and converting now would permanently lose its custom field data. The record loads once the lead is claimed (after 45+ seconds of conversation). Choose a different disposition, or ask an admin to convert it from Contacts.";

export interface TeamOpenEditGateInput {
  callStatus: "idle" | "ringing" | "connected";
  masterStatus: TeamOpenMasterStatus;
  master: Record<string, unknown> | null;
  permissionsLoading: boolean;
  hasEditPermission: boolean;
  isImpersonating: boolean;
  userId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
}

/**
 * Team/Open inline Edit (D-2, D-3, F4): full reveal, `contacts.leads.edit` (fail closed while
 * permissions load), no View-As, the master row loaded, and a UI mirror of the `Leads Hierarchical
 * Access` UPDATE policy (owner / Admin / super admin / Team Leader — RLS decides the Team Leader case).
 */
export function canEditTeamOpenLead(i: TeamOpenEditGateInput): boolean {
  if (i.callStatus !== "connected") return false;
  if (i.permissionsLoading || !i.hasEditPermission || i.isImpersonating) return false;
  if (i.masterStatus !== "loaded" || !i.master || !i.userId) return false;
  if (i.isSuperAdmin || i.role === "Admin" || i.role === "Team Leader") return true;
  return i.master.user_id === i.userId || i.master.assigned_agent_id === i.userId;
}
