/**
 * Who a viewer may pick as a contact's assigned agent — the rule `Contacts.tsx` uses for
 * Add Lead / bulk assign, extracted so the full-screen contact view applies the same one
 * (hierarchy stabilization F10):
 *  - Admin, or an effective super admin → the organization roster (`orgAgents`);
 *  - Team Leader → self + recursive downline (`teamAgents`, from `get_contact_scope_agents`);
 *  - Agent (and any other role) → only themselves, or nobody with `agentSelf: "none"`;
 *  - no viewer → nobody.
 * `currentAssigneeId`, when given, is always kept (prepended when it is outside the list) so
 * an edit form never silently drops the existing assignment; it is not a new choice.
 *
 * A display/UX narrowing only — the server (`private.assert_may_assign_to`, RLS) is the
 * authority. Mirrors it: a "Super Admin" role string alone does not widen the list; only
 * `isSuperAdmin` (the effective viewer's `is_super_admin`) does.
 */

export interface AssignableAgent {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ResolveAssignableAgentsInput {
  /** The EFFECTIVE viewer's role (the viewed profile under View As). */
  role: string | null | undefined;
  viewerId: string | null | undefined;
  /** The EFFECTIVE viewer's super-admin flag — never a navigation-level "is impersonating". */
  isSuperAdmin: boolean;
  /** Active organization roster. */
  orgAgents: readonly AssignableAgent[];
  /** The Team Leader's scope (self + recursive downline). */
  teamAgents: readonly AssignableAgent[];
  /** The contact's current assignee, kept in the list when present. */
  currentAssigneeId?: string | null;
  /**
   * What an Agent gets: `"self"` (default; the full-screen view's picker) or `"none"`
   * (Contacts Add Lead / bulk assign, which assign an Agent's own leads implicitly).
   */
  agentSelf?: "self" | "none";
}

function dedupeById(agents: readonly AssignableAgent[]): AssignableAgent[] {
  const seen = new Set<string>();
  const out: AssignableAgent[] = [];
  for (const agent of agents) {
    if (!agent?.id || seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}

export function resolveAssignableAgents(input: ResolveAssignableAgentsInput): AssignableAgent[] {
  const viewerId = (input.viewerId ?? "").trim();
  if (!viewerId) return [];

  let base: readonly AssignableAgent[];
  if (input.role === "Team Leader") {
    base = input.teamAgents;
  } else if (input.role === "Admin" || input.isSuperAdmin) {
    base = input.orgAgents;
  } else if ((input.agentSelf ?? "self") === "self") {
    const self = input.teamAgents.find((a) => a?.id === viewerId) ?? input.orgAgents.find((a) => a?.id === viewerId);
    base = self ? [self] : [];
  } else {
    base = [];
  }

  const list = dedupeById(base);
  const currentId = (input.currentAssigneeId ?? "").trim();
  if (!currentId || list.some((a) => a.id === currentId)) return list;

  const current: AssignableAgent =
    input.orgAgents.find((a) => a?.id === currentId) ??
    input.teamAgents.find((a) => a?.id === currentId) ??
    { id: currentId, firstName: "", lastName: "" };
  return [current, ...list];
}
