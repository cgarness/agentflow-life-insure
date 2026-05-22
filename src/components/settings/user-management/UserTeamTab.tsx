import React, { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { ROLE_BADGE } from "./userManagementUtils";

interface Props {
  userId: string;
  currentUserRole: string;
}

interface TeamRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
  upline_id?: string | null;
}

const UserTeamTab: React.FC<Props> = ({ userId, currentUserRole }) => {
  const { toast } = useToast();
  const [teamMembers, setTeamMembers] = useState<TeamRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<TeamRow[]>([]);
  const [agentSearch, setAgentSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setTeamLoading(true);
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role, upline_id, avatar_url")
      .eq("upline_id", userId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error) setTeamMembers((data as TeamRow[]) || []);
        setTeamLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  const openAddAgent = async () => {
    if (addAgentOpen) { setAddAgentOpen(false); return; }
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role, avatar_url")
      .eq("role", "Agent")
      .eq("status", "Active")
      .is("upline_id", null);
    const currentIds = new Set(teamMembers.map(m => m.id));
    setAvailableAgents(((data as TeamRow[]) || []).filter(a => !currentIds.has(a.id)));
    setAgentSearch("");
    setAddAgentOpen(true);
  };

  const handleAssignAgent = async (agent: TeamRow) => {
    try {
      await usersApi.assignUpline(agent.id, userId);
      setTeamMembers(prev => [...prev, { ...agent, upline_id: userId }]);
      setAddAgentOpen(false);
      toast({ title: "Agent assigned successfully" });
    } catch {
      toast({ title: "Failed to assign agent", variant: "destructive" });
    }
  };

  const handleRemoveAgent = async (memberId: string) => {
    try {
      await usersApi.removeFromTeam(memberId);
      setTeamMembers(prev => prev.filter(m => m.id !== memberId));
    } catch {
      toast({ title: "Failed to remove agent", variant: "destructive" });
    }
  };

  const filteredAvailable = availableAgents.filter(a => {
    const q = agentSearch.toLowerCase();
    return !q || `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4 mt-0">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          {teamLoading ? "" : `${teamMembers.length} agent${teamMembers.length !== 1 ? "s" : ""} assigned`}
        </p>
        {currentUserRole === "Admin" && (
          <div className="relative">
            <Button size="sm" variant="outline" onClick={openAddAgent}>
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Add Agent
            </Button>
            {addAgentOpen && (
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
                      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 overflow-hidden">
                        {agent.avatar_url
                          ? <img src={agent.avatar_url} alt="" className="w-full h-full object-cover" />
                          : `${(agent.first_name || "")[0] || ""}${(agent.last_name || "")[0] || ""}`}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{agent.first_name} {agent.last_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{agent.email}</p>
                      </div>
                    </button>
                  ))}
                  {filteredAvailable.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No unassigned agents found.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {teamLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}

      {!teamLoading && teamMembers.length === 0 && (
        <div className="py-12 text-center border rounded-lg bg-accent/10">
          <p className="text-sm text-muted-foreground">No agents assigned to this team leader yet.</p>
        </div>
      )}

      {!teamLoading && teamMembers.length > 0 && (
        <div className="space-y-2">
          {teamMembers.map(member => (
            <div key={member.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center shrink-0 overflow-hidden">
                {member.avatar_url
                  ? <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
                  : `${(member.first_name || "")[0] || ""}${(member.last_name || "")[0] || ""}`}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{member.first_name} {member.last_name}</p>
                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
              </div>
              <Badge className={ROLE_BADGE[member.role] || ""}>{member.role}</Badge>
              {currentUserRole === "Admin" && (
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
