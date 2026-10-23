/**
 * Who may be offered as an upline / manager in Settings → User Management, and the
 * filter-independent manager-name lookup for the Team Members "Manager" column.
 *
 * Query scoping, not authorization — `profiles_select_org` permits same-org reads. These
 * loaders keep the pickers to choices the database will accept (D8: an Active Admin or
 * Team Leader of the same organization, never the member or anyone beneath them) and stay
 * independent of the table's search / role / status filters. The database guards (M2)
 * remain the authority; their messages reach the toast.
 */
import { supabase } from "@/integrations/supabase/client";
import { AGENT_SCOPE_ID_BATCH_SIZE, usersSupabaseApi } from "@/lib/supabase-users";

/** Roles that may be chosen as an upline / invite manager (D8). */
export const UPLINE_CANDIDATE_ROLES = ["Admin", "Team Leader"] as const;

export interface HierarchyPersonOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  status: string | null;
}

export interface UplineCandidatesResult {
  /** Active Admins / Team Leaders of the organization, minus the member and their subtree. */
  candidates: HierarchyPersonOption[];
  /**
   * The member's current upline when it is NOT an offered candidate (Inactive, Deleted, an
   * Agent, …): render it as a disabled "current" option so the select still shows the
   * value. `firstName`/`lastName` are empty and `role`/`status` null when the row cannot be
   * read in this organization.
   */
  currentOutsideSet: HierarchyPersonOption | null;
}

export interface ManagerName {
  firstName: string;
  lastName: string;
  status: string | null;
}

const EMPTY_RESULT: UplineCandidatesResult = { candidates: [], currentOutsideSet: null };

type PersonRow = {
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  role?: string | null;
  status?: string | null;
};

function toOption(row: PersonRow): HierarchyPersonOption {
  return {
    id: row.id as string,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    role: row.role ?? null,
    status: row.status ?? null,
  };
}

/** Active Admins / Team Leaders of `organizationId`, first-name order. Rejects on error. */
async function activeManagersOf(organizationId: string): Promise<HierarchyPersonOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, status")
    .eq("organization_id", organizationId)
    .eq("status", "Active")
    .in("role", [...UPLINE_CANDIDATE_ROLES])
    .order("first_name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PersonRow[]).filter((row) => !!row?.id).map(toOption);
}

/**
 * Upline choices for `targetId` (UserProfileTab). Excludes the member and every profile
 * beneath them (`getAgentScopeIds`, which walks through Deleted intermediates), so the
 * picker cannot offer a cycle. Fails closed: a scope or candidate error rejects — callers
 * show an error and disable the picker, never an unfiltered list. A missing member or
 * organization issues no query and resolves to no candidates.
 */
export async function loadUplineCandidates(params: {
  targetId: string;
  organizationId: string | null;
  currentUplineId?: string | null;
}): Promise<UplineCandidatesResult> {
  const targetId = (params.targetId ?? "").trim();
  const organizationId = (params.organizationId ?? "").trim();
  if (!targetId || !organizationId) return EMPTY_RESULT;

  const [managers, subtreeIds] = await Promise.all([
    activeManagersOf(organizationId),
    usersSupabaseApi.getAgentScopeIds({ viewerId: targetId, organizationId }),
  ]);

  const excluded = new Set<string>([targetId, ...subtreeIds]);
  const candidates = managers.filter((m) => !excluded.has(m.id));

  const currentUplineId = (params.currentUplineId ?? "").trim();
  if (!currentUplineId || currentUplineId === "_none" || candidates.some((c) => c.id === currentUplineId)) {
    return { candidates, currentOutsideSet: null };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, status")
    .eq("organization_id", organizationId)
    .eq("id", currentUplineId)
    .maybeSingle();
  if (error) throw error;

  const row = data as PersonRow | null;
  const currentOutsideSet = row?.id
    ? toOption(row)
    : { id: currentUplineId, firstName: "", lastName: "", role: null, status: null };
  return { candidates, currentOutsideSet };
}

/**
 * Manager choices for InviteUserModal: every Active Admin / Team Leader of the
 * organization, with no exclusions (the invitee has no subtree yet). Rejects on error; a
 * missing organization issues no query and resolves to [].
 */
export async function loadInviteManagerCandidates(params: {
  organizationId: string | null;
}): Promise<HierarchyPersonOption[]> {
  const organizationId = (params.organizationId ?? "").trim();
  if (!organizationId) return [];
  return activeManagersOf(organizationId);
}

/**
 * Name-only lookup for the Team Members "Manager" column: `{ id → name, status }` for the
 * given upline ids in `organizationId`, independent of the table filters and of the
 * viewer's downline scope (so a Team Leader's or Agent's own manager still has a name).
 * Batched `.in("id", …)`; any batch error rejects. Deleted managers are included (with
 * their status) so the column can say who the recorded manager is. Empty ids or a missing
 * organization issue no query and resolve to {}.
 */
export async function managerNamesById(
  ids: readonly (string | null | undefined)[],
  organizationId: string | null,
): Promise<Record<string, ManagerName>> {
  const org = (organizationId ?? "").trim();
  const unique = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)),
  );
  if (!org || unique.length === 0) return {};

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += AGENT_SCOPE_ID_BATCH_SIZE) {
    batches.push(unique.slice(i, i + AGENT_SCOPE_ID_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      supabase.from("profiles").select("id, first_name, last_name, status").eq("organization_id", org).in("id", batch),
    ),
  );

  const names: Record<string, ManagerName> = {};
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data ?? []) as PersonRow[]) {
      if (!row?.id) continue;
      names[row.id] = { firstName: row.first_name || "", lastName: row.last_name || "", status: row.status ?? null };
    }
  }
  return names;
}
