import React, { useState } from "react";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTeamMembers, type TeamMemberRow } from "@/hooks/useTeamMembers";
import { ROLE_BADGE } from "./userManagementUtils";

interface Props {
  /** The Team Leader whose direct reports are shown. */
  userId: string;
  organizationId: string | null;
  /**
   * The viewer may change uplines (Admin of this organization or platform super admin).
   * UI mirror only: the database keeps `upline_id` Admin-only.
   */
  canManage: boolean;
  /** Called after a successful Add / Remove so the member list re-reads from the database. */
  onTeamChanged?: () => void;
}

const errorText = (e: unknown) =>
  (e as { message?: string } | null)?.message || "An unknown error occurred";

const Initials: React.FC<{ row: TeamMemberRow; size: string }> = ({ row, size }) => (
  <div className={`${size} rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0 overflow-hidden`}>
    {row.avatar_url
      ? <img src={row.avatar_url} alt="" className="w-full h-full object-cover" />
      : `${(row.first_name || "")[0] || ""}${(row.last_name || "")[0] || ""}`}
  </div>
);

const UserTeamTab: React.FC<Props> = ({ userId, organizationId, canManage, onTeamChanged }) => {
  const { toast } = useToast();
  const { team, agents, openAddAgent, closeAddAgent, assignAgent, removeMember } =
    useTeamMembers({ leaderId: userId, organizationId, onTeamChanged });
  const [agentSearch, setAgentSearch] = useState("");

  const toggleAddAgent = () => {
    if (agents.open) { closeAddAgent(); return; }
    setAgentSearch("");
    void openAddAgent();
  };

  const handleAssignAgent = async (agent: TeamMemberRow) => {
    try {
      await assignAgent(agent.id);
      toast({ title: "Agent assigned successfully" });
    } catch (e) {
      toast({ title: "Failed to assign agent", description: errorText(e), variant: "destructive" });
    }
  };

  const handleRemoveAgent = async (memberId: string) => {
    try {
      await removeMember(memberId);
    } catch (e) {
      toast({ title: "Failed to remove agent", description: errorText(e), variant: "destructive" });
    }
  };

  const q = agentSearch.toLowerCase();
  const filteredAvailable = agents.rows.filter(a =>
    !q || `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q));
  const members = team.rows;

  return (
    <div className="space-y-4 mt-0">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          {team.loading || team.error ? "" : `${members.length} agent${members.length !== 1 ? "s" : ""} assigned`}
        </p>
        {canManage && (
          <div className="relative">
            <Button size="sm" variant="outline" onClick={toggleAddAgent} disabled={team.loading || !!team.error}>
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Add Agent
            </Button>
            {agents.open && (
              <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-card border border-border rounded-lg shadow-lg">
                <div className="p-2 border-b border-border">
                  <Input placeholder="Search agents..." value={agentSearch} onChange={e => setAgentSearch(e.target.value)} className="h-8" autoFocus />
                </div>
                <div className="max-h-52 overflow-y-auto p-1">
                  {filteredAvailable.map(agent => (
                    <button
                      key={agent.id}
                      type="button"
                      className="w-full flex items-center gap-2.5 px-2 py-2 rounded hover:bg-accent text-left text-sm"
                      onClick={() => handleAssignAgent(agent)}
                    >
                      <Initials row={agent} size="w-7 h-7 text-xs" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{agent.first_name} {agent.last_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{agent.email}</p>
                      </div>
                    </button>
                  ))}
                  {agents.loading && <p className="text-xs text-muted-foreground text-center py-4">Loading agents…</p>}
                  {agents.error && <p className="text-xs text-destructive text-center py-4">{agents.error}</p>}
                  {!agents.loading && !agents.error && filteredAvailable.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No unassigned agents found.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {team.loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}

      {!team.loading && team.error && (
        <div className="py-12 text-center border rounded-lg border-destructive/30 bg-destructive/5">
          <p className="text-sm text-destructive">{team.error}</p>
        </div>
      )}

      {!team.loading && !team.error && members.length === 0 && (
        <div className="py-12 text-center border rounded-lg bg-accent/10">
          <p className="text-sm text-muted-foreground">No agents assigned to this team leader yet.</p>
        </div>
      )}

      {!team.loading && !team.error && members.length > 0 && (
        <div className="space-y-2">
          {members.map(member => (
            <div key={member.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <Initials row={member} size="w-9 h-9 text-sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{member.first_name} {member.last_name}</p>
                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
              </div>
              <Badge className={ROLE_BADGE[member.role ?? ""] || ""}>{member.role}</Badge>
              {canManage && (
                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 shrink-0" onClick={() => handleRemoveAgent(member.id)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserTeamTab;
