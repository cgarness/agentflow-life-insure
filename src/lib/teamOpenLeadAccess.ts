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

const KEPT = "Your disposition and notes are still on this screen and nothing has been saved.";

export const TEAM_OPEN_CONVERT_MESSAGES = {
  notDialled: "This lead isn't the one you dialled under your current lock, so it can't be converted here. Nothing was saved.",
  loading: `The full contact record is still loading, so this sale can't be converted yet. ${KEPT} Press Save again once it has loaded.`,
  error: `The full contact record could not be loaded, so this sale can't be converted yet. ${KEPT}`,
  unavailableAfterClaim: `The full contact record is still not available to you after the claim, so this sale can't be converted yet. ${KEPT}`,
  unavailableBeforeClaim:
    "This sale can't be completed in this dialer flow yet: your account can't read this lead's full record, and converting without it would permanently lose its custom field data. Your disposition and notes remain on this screen, unsaved.",
} as const;

/** Back-compat alias for the generic "record not available" refusal. */
export const TEAM_OPEN_CONVERT_BLOCKED_MESSAGE = TEAM_OPEN_CONVERT_MESSAGES.unavailableBeforeClaim;
export const TEAM_OPEN_CONVERT_NOT_DIALLED_MESSAGE = TEAM_OPEN_CONVERT_MESSAGES.notDialled;

export interface TeamOpenConvertBlock {
  message: string;
  /** Offer ONE context-bound read ("Retry loading record"). Never converts or submits. */
  offerRetry: boolean;
}

/**
 * Why a Team/Open Sold/Convert must not open (null = it may). Nothing is saved, advanced or
 * released on a refusal; the selected disposition and notes stay on screen (not persisted across
 * refresh, navigation or sign-out).
 *   - Only the lead this agent dialled under the CURRENT confirmed lock (lock-loss swap guard).
 *   - The full authorized master record must be loaded (custom_fields would otherwise be lost).
 */
export function teamOpenConvertBlock(
  lockMode: boolean,
  masterStatus: TeamOpenMasterStatus,
  dialledUnderCurrentLock: boolean,
  claimed: boolean,
): TeamOpenConvertBlock | null {
  if (!lockMode) return null;
  if (!dialledUnderCurrentLock) return { message: TEAM_OPEN_CONVERT_MESSAGES.notDialled, offerRetry: false };
  switch (masterStatus) {
    case "loaded": return null;
    case "loading": return { message: TEAM_OPEN_CONVERT_MESSAGES.loading, offerRetry: false };
    case "error": return { message: TEAM_OPEN_CONVERT_MESSAGES.error, offerRetry: true };
    default:
      return claimed
        ? { message: TEAM_OPEN_CONVERT_MESSAGES.unavailableAfterClaim, offerRetry: true }
        : { message: TEAM_OPEN_CONVERT_MESSAGES.unavailableBeforeClaim, offerRetry: false };
  }
}

/** String-only form kept for existing callers/tests. */
export function teamOpenConvertBlockReason(
  lockMode: boolean,
  masterStatus: TeamOpenMasterStatus,
  dialledUnderCurrentLock: boolean,
  claimed = false,
): string | null {
  return teamOpenConvertBlock(lockMode, masterStatus, dialledUnderCurrentLock, claimed)?.message ?? null;
}

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
