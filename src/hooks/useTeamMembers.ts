/**
 * Settings → User Management → a Team Leader's "My Team" tab (hierarchy stabilization F3).
 *
 * Query scoping, NOT authorization — `profiles_select_org` permits same-org reads. Add and
 * Remove write `profiles.upline_id`, an account-control field the database keeps Admin-only
 * (`enforce_profile_field_authorization`, from the actor's profile row) and, once the
 * hierarchy integrity migration is live, guards against self, cycle and cross-org uplines.
 *  - team: the leader's DIRECT reports in the explicit organization, Deleted excluded;
 *  - a load failure is an error state, never an empty team;
 *  - "Add Agent" offers Active Agents of the organization with no upline, minus the leader
 *    and the leader's own upline chain (`getUplineChainIds`), so it cannot offer a cycle;
 *  - a list load that finishes after the list was closed, re-opened, or the leader /
 *    organization changed is stale and ignored (`openSeq`), so it can never re-open the list;
 *  - every Add / Remove re-reads the team from the database and calls `onTeamChanged` so the
 *    parent member list refreshes too.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usersSupabaseApi } from "@/lib/supabase-users";

export const TEAM_MEMBER_COLUMNS = "id, first_name, last_name, email, role, status, upline_id, avatar_url";

export interface TeamMemberRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  upline_id: string | null;
  avatar_url: string | null;
}

const LOAD_ERROR = "We couldn't load this team. Try again.";
const AGENTS_ERROR = "We couldn't load agents to add. Try again.";

type AgentsState = { open: boolean; rows: TeamMemberRow[]; loading: boolean; error: string | null };
const AGENTS_CLOSED: AgentsState = { open: false, rows: [], loading: false, error: null };

function keep(rows: unknown): TeamMemberRow[] {
  return ((rows ?? []) as TeamMemberRow[]).filter((row) => !!row?.id);
}

/** The leader's direct, non-Deleted reports in `organizationId`. Rejects on error; no query without both ids. */
export async function loadTeamMembers(params: { leaderId: string; organizationId: string | null }): Promise<TeamMemberRow[]> {
  const leaderId = (params.leaderId ?? "").trim();
  const organizationId = (params.organizationId ?? "").trim();
  if (!leaderId || !organizationId) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select(TEAM_MEMBER_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("upline_id", leaderId)
    .neq("status", "Deleted")
    .order("first_name", { ascending: true });
  if (error) throw error;
  return keep(data);
}

/**
 * "Add Agent" choices: Active Agents of `organizationId` with no upline, excluding the leader,
 * the leader's upline chain and `excludeIds`. Rejects when either read fails (fail closed).
 */
export async function loadTeamAssignableAgents(params: {
  leaderId: string;
  organizationId: string | null;
  excludeIds?: readonly string[];
}): Promise<TeamMemberRow[]> {
  const leaderId = (params.leaderId ?? "").trim();
  const organizationId = (params.organizationId ?? "").trim();
  if (!leaderId || !organizationId) return [];
  const [chain, result] = await Promise.all([
    usersSupabaseApi.getUplineChainIds({ profileId: leaderId, organizationId }),
    supabase
      .from("profiles")
      .select(TEAM_MEMBER_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("role", "Agent")
      .eq("status", "Active")
      .is("upline_id", null)
      .order("first_name", { ascending: true }),
  ]);
  if (result.error) throw result.error;
  const excluded = new Set<string>([leaderId, ...chain, ...(params.excludeIds ?? [])]);
  return keep(result.data).filter((row) => !excluded.has(row.id));
}

export function useTeamMembers(params: { leaderId: string; organizationId: string | null; onTeamChanged?: () => void }) {
  const { leaderId, organizationId, onTeamChanged } = params;
  const [team, setTeam] = useState<{ rows: TeamMemberRow[]; loading: boolean; error: string | null }>(
    { rows: [], loading: true, error: null },
  );
  const [agents, setAgents] = useState<AgentsState>(AGENTS_CLOSED);
  const [version, setVersion] = useState(0);
  const teamRef = useRef<TeamMemberRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setTeam((prev) => ({ ...prev, loading: true, error: null }));
    loadTeamMembers({ leaderId, organizationId })
      .then((rows) => {
        if (cancelled) return;
        teamRef.current = rows;
        setTeam({ rows, loading: false, error: null });
      })
      .catch((e) => {
        console.error("[UserTeamTab] team load failed:", e);
        if (cancelled) return;
        teamRef.current = [];
        setTeam({ rows: [], loading: false, error: LOAD_ERROR });
      });
    return () => { cancelled = true; };
  }, [leaderId, organizationId, version]);

  // Each open takes a new sequence number; a close (or a newer open) bumps it, so a load that
  // finishes afterwards is stale and must not re-open the list or overwrite a newer one.
  const openSeq = useRef(0);
  const closeAddAgent = useCallback(() => {
    openSeq.current += 1;
    setAgents(AGENTS_CLOSED);
  }, []);

  // A leader or organization switch closes the list: its rows were computed for the old leader.
  useEffect(() => { closeAddAgent(); }, [leaderId, organizationId, closeAddAgent]);

  const openAddAgent = useCallback(async () => {
    const seq = ++openSeq.current;
    setAgents({ open: true, rows: [], loading: true, error: null });
    try {
      const rows = await loadTeamAssignableAgents({
        leaderId, organizationId, excludeIds: teamRef.current.map((m) => m.id),
      });
      if (seq !== openSeq.current) return;
      setAgents({ open: true, rows, loading: false, error: null });
    } catch (e) {
      console.error("[UserTeamTab] assignable agents failed:", e);
      if (seq !== openSeq.current) return;
      setAgents({ open: true, rows: [], loading: false, error: AGENTS_ERROR });
    }
  }, [leaderId, organizationId]);

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    onTeamChanged?.();
  }, [onTeamChanged]);

  /** Rejects with the database message (e.g. a hierarchy guard) for the caller's toast. */
  const assignAgent = useCallback(async (agentId: string) => {
    await usersSupabaseApi.assignUpline(agentId, leaderId);
    closeAddAgent();
    changed();
  }, [leaderId, closeAddAgent, changed]);

  const removeMember = useCallback(async (memberId: string) => {
    await usersSupabaseApi.removeFromTeam(memberId);
    changed();
  }, [changed]);

  return { team, agents, openAddAgent, closeAddAgent, assignAgent, removeMember };
}
