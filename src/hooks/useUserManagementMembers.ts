/**
 * Settings → User Management: which members the Team Members table lists, the
 * filter-independent Manager-column names, and the Invite modal's manager choices
 * (hierarchy stabilization F5 / F2).
 *
 * Query scoping, NOT authorization — `profiles_select_org` permits same-org reads. Downline
 * profile scoping is query-enforced (AGENT_RULES §3), so every branch constrains its query to
 * the resolved scope and fails closed:
 *  - Admin / Super Admin role, or a platform super admin → `getAll` for the organization;
 *  - Team Leader → `getAgentScopeTraversal` (self + every non-Deleted descendant through
 *    `profiles.upline_id`; cached per viewer/organization so typing in the search box does
 *    not re-walk the tree) → `getByIds` with the table's search / role / status filters. A
 *    traversal failure is an error state, NEVER a `getAll` fallback;
 *  - anyone else (Agent, unknown role) → their own row only.
 * The branch is chosen from the viewer's PROFILE row (`useAuth().profile`, the effective
 * viewer), never from JWT claims. UI authority mirrors (`canAdminister`) use the REAL
 * signed-in profile (`useAuth().realProfile`); the database stays the authority.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usersSupabaseApi, type AgentScopeTraversal } from "@/lib/supabase-users";
import {
  loadInviteManagerCandidates,
  managerNamesById,
  type HierarchyPersonOption,
  type ManagerName,
} from "@/lib/hierarchy/uplineCandidates";
import { isOrgAdminViewer } from "@/lib/user-management/profileSavePayload";
import type { User, UserProfile } from "@/lib/types";

export type ManagedMember = User & { profile: UserProfile };

/** A partial row update: user fields, plus profile fields merged into the existing profile. */
export type MemberPatch = Partial<Omit<ManagedMember, "profile">> & { profile?: Partial<UserProfile> };

/** How the table's rows are scoped for this viewer. */
export type MemberScopeKind = "organization" | "downline" | "self" | "none";

export interface MemberScopeViewer {
  id: string | null | undefined;
  role: string | null | undefined;
  isSuperAdmin?: boolean | null;
}

/** The signed-in viewer's own profile row, for UI mirrors only (the database decides). */
export interface UserManagementViewer {
  id: string;
  role: string | null;
  isSuperAdmin: boolean;
  /** `profiles.organization_id` of the viewer's own row — not a JWT claim. */
  organizationId: string | null;
}

export interface MemberFilters {
  search: string;
  role: string;
  status: string;
}

const LOAD_ERROR = "We couldn't load team members. Try again.";

export function memberScopeKind(
  viewer: MemberScopeViewer | null | undefined,
  organizationId: string | null | undefined,
): MemberScopeKind {
  if (!viewer?.id || !(organizationId ?? "").trim()) return "none";
  const role = (viewer.role ?? "").trim().toLowerCase();
  if (viewer.isSuperAdmin === true || role === "admin" || role === "super admin") return "organization";
  if (role === "team leader") return "downline";
  return "self";
}

export function traversalCacheKey(viewerId: string, organizationId: string): string {
  return `${viewerId}|${organizationId}`;
}

/**
 * The Team Members rows for `viewer` (contract in the file header). Pure data loading — no
 * React — so the frontend ↔ database compatibility suite can call it against PostgREST.
 * Rejects on any error; a missing viewer or organization issues no query.
 */
export async function loadUserManagementMembers(params: {
  viewer: MemberScopeViewer | null | undefined;
  organizationId: string | null | undefined;
  filters?: Partial<MemberFilters>;
  traversalCache?: Map<string, AgentScopeTraversal>;
}): Promise<{ scope: MemberScopeKind; members: ManagedMember[] }> {
  const organizationId = (params.organizationId ?? "").trim();
  const scope = memberScopeKind(params.viewer, organizationId);
  const { search = "", role = "All", status = "All" } = params.filters ?? {};
  if (scope === "none") return { scope, members: [] };
  if (scope === "organization") {
    return { scope, members: await usersSupabaseApi.getAll({ search, role, status, organizationId }) };
  }

  const viewerId = (params.viewer?.id ?? "").trim();
  let ids = [viewerId];
  if (scope === "downline") {
    const key = traversalCacheKey(viewerId, organizationId);
    let traversal = params.traversalCache?.get(key);
    if (!traversal) {
      traversal = await usersSupabaseApi.getAgentScopeTraversal({ viewerId, organizationId });
      params.traversalCache?.set(key, traversal);
    }
    ids = traversal.scopedIds;
  }
  return { scope, members: await usersSupabaseApi.getByIds({ ids, organizationId, search, role, status }) };
}

/**
 * Manager-column names for the listed members' recorded uplines — looked up by id, so they do
 * not depend on the table filters or on the viewer's scope (a Team Leader's own manager still
 * has a name; an Admin filtering by "Agent" still sees each agent's manager).
 */
export function loadMemberManagerNames(
  members: readonly ManagedMember[],
  organizationId: string | null | undefined,
): Promise<Record<string, ManagerName>> {
  return managerNamesById(members.map((m) => m.profile?.uplineId ?? null), organizationId ?? null);
}

/** Merge a modal save patch into a member row (the profile object is merged, not replaced). */
export function applyMemberPatch(member: ManagedMember, patch: MemberPatch): ManagedMember {
  const { profile: profilePatch, ...userPatch } = patch;
  const merged = { ...member, ...userPatch } as ManagedMember;
  if (profilePatch) merged.profile = { ...member.profile, ...profilePatch };
  return merged;
}

export function useUserManagementMembers(filters: MemberFilters) {
  const { profile, realProfile } = useAuth();
  const { organizationId } = useOrganization();
  const viewerId = profile?.id ?? null;
  const viewerRole = profile?.role ?? null;
  const viewerIsSuper = profile?.is_super_admin === true;
  const { search, role, status } = filters;

  const realId = realProfile?.id ?? null;
  const realRole = realProfile?.role ?? null;
  const realIsSuper = realProfile?.is_super_admin === true;
  const realOrg = realProfile?.organization_id ?? null;
  const viewer = useMemo<UserManagementViewer | null>(
    () => (realId ? { id: realId, role: realRole, isSuperAdmin: realIsSuper, organizationId: realOrg } : null),
    [realId, realRole, realIsSuper, realOrg],
  );
  const canAdminister = isOrgAdminViewer(viewer, organizationId);

  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerNames, setManagerNames] = useState<Record<string, ManagerName>>({});
  const [version, setVersion] = useState(0);
  const traversalCache = useRef(new Map<string, AgentScopeTraversal>());
  const fetchSeq = useRef(0);

  // A different viewer, role or organization never sees the previous one's rows or scope. The
  // cache is REPLACED (not cleared) so a traversal still in flight writes into the old map.
  useEffect(() => {
    traversalCache.current = new Map();
    setMembers([]);
    setError(null);
  }, [viewerId, viewerRole, viewerIsSuper, organizationId]);

  useEffect(() => {
    const seq = ++fetchSeq.current;
    // Wait for the organization: without it no query is scoped (the table stays loading).
    if (!organizationId || !viewerId) { setLoading(true); return; }
    setLoading(true);
    loadUserManagementMembers({
      viewer: { id: viewerId, role: viewerRole, isSuperAdmin: viewerIsSuper },
      organizationId,
      filters: { search, role, status },
      traversalCache: traversalCache.current,
    })
      .then((result) => {
        if (seq !== fetchSeq.current) return;
        setMembers(result.members);
        setError(null);
      })
      .catch((e) => {
        if (seq !== fetchSeq.current) return;
        console.error("[UserManagement] member scope failed:", e);
        // Fail closed: no rows and an error state — never an organization-wide fallback.
        setMembers([]);
        setError(LOAD_ERROR);
      })
      .finally(() => { if (seq === fetchSeq.current) setLoading(false); });
  }, [viewerId, viewerRole, viewerIsSuper, organizationId, search, role, status, version]);

  const uplineKey = useMemo(
    () => Array.from(new Set(members.map((m) => m.profile?.uplineId).filter((id): id is string => !!id))).sort().join(","),
    [members],
  );
  useEffect(() => {
    if (!uplineKey || !organizationId) { setManagerNames({}); return; }
    let cancelled = false;
    managerNamesById(uplineKey.split(","), organizationId)
      .then((names) => { if (!cancelled) setManagerNames(names); })
      .catch((e) => {
        console.error("[UserManagement] manager names failed:", e);
        if (!cancelled) setManagerNames({});
      });
    return () => { cancelled = true; };
  }, [uplineKey, organizationId]);

  /** Re-read from the database, re-walking the downline (after team changes or a partial save). */
  const reload = useCallback(() => {
    traversalCache.current = new Map();
    setVersion((v) => v + 1);
  }, []);
  const patchMember = useCallback((patch?: MemberPatch) => {
    if (!patch?.id) return;
    setMembers((prev) => prev.map((m) => (m.id === patch.id ? applyMemberPatch(m, patch) : m)));
  }, []);
  const removeMember = useCallback((id: string) => setMembers((prev) => prev.filter((m) => m.id !== id)), []);

  return { members, loading, error, managerNames, reload, patchMember, removeMember, viewer, canAdminister, organizationId };
}

/**
 * Invite modal manager choices: every Active Admin / Team Leader of the organization, loaded
 * while the modal is open and independent of the table filters. A load failure yields no
 * choices and an error message (the invitation can still be sent with no manager).
 */
export function useInviteManagerCandidates(organizationId: string | null, enabled: boolean) {
  const [state, setState] = useState<{ key: string | null; managers: HierarchyPersonOption[]; error: string | null }>(
    { key: null, managers: [], error: null },
  );
  useEffect(() => {
    if (!enabled || !organizationId) return;
    let cancelled = false;
    loadInviteManagerCandidates({ organizationId })
      .then((managers) => { if (!cancelled) setState({ key: organizationId, managers, error: null }); })
      .catch((e) => {
        console.error("[UserManagement] invite managers failed:", e);
        if (!cancelled) setState({ key: organizationId, managers: [], error: "Could not load managers." });
      });
    return () => { cancelled = true; };
  }, [organizationId, enabled]);
  const current = state.key === organizationId;
  return { managers: current ? state.managers : [], error: current ? state.error : null };
}
