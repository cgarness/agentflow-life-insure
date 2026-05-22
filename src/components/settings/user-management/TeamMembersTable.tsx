import React from "react";
import { useNavigate } from "react-router-dom";
import { Ban, Eye, Mail, MoreHorizontal, Pencil, RefreshCw, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, Profile } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { AVAIL_COLORS, ROLE_BADGE } from "./userManagementUtils";
import type { ConfirmDialogState, UserWithProfile } from "./userManagementTypes";

interface Props {
  users: UserWithProfile[];
  allUsers: UserWithProfile[];
  loading: boolean;
  search: string;
  setSearch: (v: string) => void;
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  isCurrentUserSuperAdmin: boolean;
  onSelectUser: (u: UserWithProfile) => void;
  onConfirm: (s: ConfirmDialogState) => void;
  onBillingChange: (userId: string, newVal: "agency_covered" | "self_pay") => void;
}

const TeamMembersTable: React.FC<Props> = ({
  users, allUsers, loading, search, setSearch, roleFilter, setRoleFilter,
  statusFilter, setStatusFilter, isCurrentUserSuperAdmin, onSelectUser, onConfirm, onBillingChange,
}) => {
  const navigate = useNavigate();
  const { user: currentUser, startImpersonation } = useAuth();
  const { toast } = useToast();

  const handleBillingChange = async (userId: string, newVal: "agency_covered" | "self_pay") => {
    try {
      await usersApi.updateBillingType(userId, newVal);
      onBillingChange(userId, newVal);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Failed to update billing type", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 mt-6 animate-in fade-in-50 duration-500">
      <div className="flex flex-wrap gap-3 p-4 bg-accent/20 rounded-xl border border-border/50">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search team by name, email, or role..."
            className="pl-9 bg-background/50 border-border/50 focus:border-primary/50 transition-all"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44 bg-background/50 border-border/50"><SelectValue placeholder="Filter by Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Roles</SelectItem>
            <SelectItem value="Admin">Admin</SelectItem>
            <SelectItem value="Team Leader">Team Leader</SelectItem>
            <SelectItem value="Agent">Agent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-background/50 border-border/50"><SelectValue placeholder="Filter by Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-xl shadow-black/5 overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h4 className="text-lg font-medium text-foreground">No team members found</h4>
            <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-muted-foreground/70 uppercase text-[10px] font-bold tracking-wider border-b border-border/50 bg-muted/20">
                  <th className="text-left py-4 px-6">Member</th>
                  <th className="text-left py-4 px-2">Role</th>
                  <th className="text-left py-4 px-2">Manager</th>
                  <th className="text-left py-4 px-2">Status</th>
                  <th className="text-left py-4 px-2">Billing</th>
                  <th className="text-left py-4 px-2">Availability</th>
                  <th className="text-right py-4 px-6">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {users.map(u => {
                  const upline = u.profile.uplineId ? allUsers.find(m => m.id === u.profile.uplineId) : null;
                  return (
                    <tr
                      key={u.id}
                      className="group hover:bg-accent/40 transition-all duration-200 cursor-pointer"
                      onClick={() => onSelectUser(u)}
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary text-sm font-bold flex items-center justify-center overflow-hidden border border-primary/20 shadow-inner">
                              {u.avatar ? (
                                <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                              ) : (
                                `${u.firstName[0]}${u.lastName[0]}`
                              )}
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${AVAIL_COLORS[u.availabilityStatus]}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{u.firstName} {u.lastName}</span>
                              {u.isSuperAdmin && isCurrentUserSuperAdmin && (
                                <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] h-4">SUPER ADMIN</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground/70 flex items-center gap-1.5 mt-0.5">
                              <Mail className="w-3 h-3" /> {u.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-2">
                        <Badge className={`${ROLE_BADGE[u.role]} border-none rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight`}>{u.role}</Badge>
                      </td>
                      <td className="py-4 px-2">
                        {upline ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[8px] font-bold">
                              {upline.firstName[0]}
                            </div>
                            {upline.firstName} {upline.lastName}
                          </div>
                        ) : <span className="text-muted-foreground/30 text-xs">-</span>}
                      </td>
                      <td className="py-4 px-2">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${u.status === "Active" ? "bg-success" : "bg-muted-foreground"}`} />
                          <span className={`text-xs font-medium ${u.status === "Active" ? "text-success" : "text-muted-foreground"}`}>{u.status}</span>
                        </div>
                      </td>
                      <td className="py-4 px-2" onClick={e => e.stopPropagation()}>
                        <select
                          value={u.profile.billingType ?? "agency_covered"}
                          onChange={e => handleBillingChange(u.id, e.target.value as "agency_covered" | "self_pay")}
                          className="h-7 px-2 rounded-md bg-accent text-xs border-0"
                        >
                          <option value="agency_covered">Agency Covered</option>
                          <option value="self_pay">Self-Pay</option>
                        </select>
                      </td>
                      <td className="py-4 px-2">
                        <span className="text-xs text-muted-foreground">{u.availabilityStatus}</span>
                      </td>
                      <td className="py-4 px-6 text-right" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg hover:bg-accent"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 p-1 rounded-xl shadow-2xl border-border/50">
                            <DropdownMenuItem className="rounded-lg py-2" onClick={() => onSelectUser(u)}>
                              <Pencil className="w-4 h-4 mr-2" /> Edit Member
                            </DropdownMenuItem>
                            {u.status === "Active" && u.id !== currentUser?.id && (
                              <DropdownMenuItem
                                className="text-destructive rounded-lg py-2 focus:text-destructive"
                                onClick={() => onConfirm({ open: true, user: u, action: "deactivate" })}
                              >
                                <Ban className="w-4 h-4 mr-2" /> Deactivate
                              </DropdownMenuItem>
                            )}
                            {u.status === "Inactive" && (
                              <DropdownMenuItem className="rounded-lg py-2" onClick={() => onConfirm({ open: true, user: u, action: "reactivate" })}>
                                <RefreshCw className="w-4 h-4 mr-2" /> Reactivate
                              </DropdownMenuItem>
                            )}
                            {isCurrentUserSuperAdmin && u.status === "Active" && u.id !== currentUser?.id && (
                              <>
                                <DropdownMenuSeparator className="bg-border/50" />
                                <DropdownMenuItem
                                  onClick={() => {
                                    startImpersonation(u.profile as unknown as Profile);
                                    navigate("/dashboard");
                                  }}
                                  className="text-primary rounded-lg py-2 font-medium"
                                >
                                  <Eye className="w-4 h-4 mr-2" /> Impersonate
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamMembersTable;
