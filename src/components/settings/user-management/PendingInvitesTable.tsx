import React, { useCallback, useEffect, useState } from "react";
import { Ban, Copy, Mail, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { formatDate } from "./userManagementUtils";

interface Props {
  organizationId: string | null;
  active: boolean;
}

const PendingInvitesTable: React.FC<Props> = ({ organizationId, active }) => {
  const { toast } = useToast();
  const [invitations, setInvitations] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [invitesLoading, setInvitesLoading] = useState(false);

  const fetchInvitations = useCallback(async () => {
    if (!organizationId) return;
    setInvitesLoading(true);
    try {
      const data = await usersApi.getInvitations(organizationId);
      setInvitations(data);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error fetching invitations", description: e.message, variant: "destructive" });
    } finally {
      setInvitesLoading(false);
    }
  }, [organizationId, toast]);

  useEffect(() => {
    if (active) fetchInvitations();
  }, [active, fetchInvitations]);

  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel("invitations-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invitations", filter: `organization_id=eq.${organizationId}` },
        () => { fetchInvitations(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [organizationId, fetchInvitations]);

  const handleRevoke = async (id: string) => {
    try {
      await usersApi.revokeInvitation(id);
      toast({ title: "Invitation revoked" });
      fetchInvitations();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await usersApi.deleteInvitation(id);
      toast({ title: "Invitation deleted permanently" });
      fetchInvitations();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResend = async (u: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const link = await usersApi.generateInviteLink(u.token);
      await usersApi.sendInviteEmail({ email: u.email, firstName: u.first_name, role: u.role, inviteURL: link });
      toast({ title: "Invite resent", description: `Invitation resent to ${u.email}` });
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCopy = async (u: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const link = await usersApi.generateInviteLink(u.token);
      await navigator.clipboard.writeText(link);
      toast({ title: "Invite link copied", description: "Invite link copied to clipboard." });
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 mt-6 animate-in slide-in-from-right-4 duration-300">
      <div className="bg-card rounded-2xl border border-border/50 shadow-xl shadow-black/5 overflow-hidden">
        {invitesLoading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h4 className="text-lg font-medium text-foreground">No pending invitations</h4>
            <p className="text-muted-foreground text-sm mt-1">Invite new users to join your organization.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-muted-foreground/70 uppercase text-[10px] font-bold tracking-wider border-b border-border/50 bg-muted/20">
                  <th className="text-left py-4 px-6">Invitee</th>
                  <th className="text-left py-4 px-2">Role</th>
                  <th className="text-left py-4 px-2">Sent At</th>
                  <th className="text-left py-4 px-2">Expires</th>
                  <th className="text-left py-4 px-2">Status</th>
                  <th className="text-right py-4 px-6">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {invitations.map(inv => (
                  <tr key={inv.id} className="hover:bg-accent/40 transition-all duration-200">
                    <td className="py-4 px-6">
                      <div>
                        <div className="font-semibold text-foreground">{inv.first_name} {inv.last_name}</div>
                        <div className="text-xs text-muted-foreground/70">{inv.email}</div>
                      </div>
                    </td>
                    <td className="py-4 px-2"><Badge variant="outline" className="text-[10px] font-bold uppercase">{inv.role}</Badge></td>
                    <td className="py-4 px-2 text-xs text-muted-foreground">{formatDate(inv.created_at)}</td>
                    <td className="py-4 px-2 text-xs text-muted-foreground">{formatDate(inv.expires_at)}</td>
                    <td className="py-4 px-2">
                      <Badge className={inv.status === "Pending" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}>
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg" onClick={() => handleResend(inv)}>
                                <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Resend Invite</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg" onClick={() => handleCopy(inv)}>
                                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Copy Link</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {inv.status === "Revoked" ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg hover:text-destructive" onClick={() => handleDelete(inv.id)}>
                                  <X className="w-4 h-4 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Delete Invite</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg hover:text-destructive" onClick={() => handleRevoke(inv.id)}>
                                  <Ban className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Revoke Invite</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingInvitesTable;
