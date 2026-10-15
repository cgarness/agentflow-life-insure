import React, { useRef, useState } from "react";
import { z } from "zod";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { logActivity } from "@/lib/activityLogger";
import { UserRole } from "@/lib/types";
import StateMultiSelect from "./StateMultiSelect";
import type { LicensedStateEntry, UserWithProfile } from "./userManagementTypes";

const invitationSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().email("Enter a valid email address"),
  role: z.enum(["Agent", "Team Leader", "Admin"]),
  licensedStates: z.array(z.object({ state: z.string(), licenseNumber: z.string() })),
  commissionLevel: z.string().trim(),
  uplineId: z.string().uuid().nullable(),
});

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  managers: UserWithProfile[];
}

const InviteUserModal: React.FC<Props> = ({ open, onClose, onSuccess, managers }) => {
  const { toast } = useToast();
  const { user: currentUser, realProfile: currentProfile } = useAuth();
  const { organizationId } = useOrganization();
  const isTeamLeader = currentProfile?.role === "Team Leader" && !currentProfile.is_super_admin;
  const canInvite = Boolean(currentProfile && currentUser?.id === currentProfile.id && organizationId &&
    organizationId === currentProfile.organization_id && (currentProfile.is_super_admin ||
      ["Admin", "Super Admin", "Team Leader"].includes(currentProfile.role)));
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    role: "Agent" as UserRole,
    licensedStates: [] as LicensedStateEntry[],
    commissionLevel: "50%",
    uplineId: null as string | null,
  });

  const resetForm = () =>
    setForm({ firstName: "", lastName: "", email: "", role: "Agent", licensedStates: [], commissionLevel: "50%", uplineId: null });

  const submit = async (copyLink: boolean) => {
    if (inFlight.current || !canInvite) return;
    const parsed = invitationSchema.safeParse({ ...form,
      role: isTeamLeader ? "Agent" : form.role,
      uplineId: isTeamLeader ? currentUser?.id : form.uplineId,
    });
    if (!parsed.success) {
      toast({ title: "Check invitation details", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    inFlight.current = true;
    copyLink ? setCopying(true) : setSaving(true);
    const data = parsed.data;
    try {
      const result = await usersApi.invite({
        firstName: data.firstName, lastName: data.lastName, email: data.email, role: data.role,
        uplineId: data.uplineId || undefined, licensedStates: form.licensedStates,
        commissionLevel: data.commissionLevel,
      });
      if (copyLink) {
        try {
          await navigator.clipboard.writeText(await usersApi.generateInviteLink(result.token));
          toast({ title: "Invite link copied", description: "Invite link copied to clipboard. Link expires after 7 days." });
        } catch {
          // The invitation already exists. Refresh it rather than invite twice.
          toast({ title: "Invitation created", description: "Could not copy the link. Copy it from Pending Invites." });
        }
      } else if (result.email_sent) {
        toast({ title: "Invitation sent", description: `Invitation email sent to ${data.email}` });
      } else {
        toast({ title: "Invitation created", description: "The email could not be sent. Use Resend from Pending Invites." });
      }
      if (organizationId) {
        void logActivity({ action: `Invited ${data.email} as ${data.role}`, category: "user_management",
          organizationId, userId: currentUser?.id,
          userName: currentProfile ? `${currentProfile.first_name} ${currentProfile.last_name}` : undefined,
          metadata: { invitedEmail: data.email, role: data.role },
        });
      }
      resetForm();
      onSuccess();
      onClose();
    } catch (error: unknown) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Could not create invitation", variant: "destructive" });
    } finally {
      inFlight.current = false;
      setSaving(false);
      setCopying(false);
    }
  };
  const busy = saving || copying;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>Send an invitation to join AgentFlow.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invite-first-name">First Name *</Label>
              <Input id="invite-first-name" value={form.firstName} autoFocus onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="invite-last-name">Last Name *</Label>
              <Input id="invite-last-name" value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label htmlFor="invite-email">Email *</Label>
            <Input id="invite-email" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <Select disabled={isTeamLeader || busy} value={isTeamLeader ? "Agent" : form.role} onValueChange={v => setForm(p => ({ ...p, role: v as UserRole }))}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!isTeamLeader && <SelectItem value="Admin">Admin</SelectItem>}
                  {!isTeamLeader && <SelectItem value="Team Leader">Team Leader</SelectItem>}
                  <SelectItem value="Agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="invite-upline">Upline Manager</Label>
              <Select disabled={isTeamLeader || busy} value={isTeamLeader ? currentUser?.id : form.uplineId || "_none"} onValueChange={v => setForm(p => ({ ...p, uplineId: v === "_none" ? null : v }))}>
                <SelectTrigger id="invite-upline"><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  {isTeamLeader ? (
                    <SelectItem value={currentUser?.id || "_none"}>{currentProfile?.first_name} {currentProfile?.last_name}</SelectItem>
                  ) : <SelectItem value="_none">None</SelectItem>}
                  {!isTeamLeader && managers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="invite-states">Licensed States</Label>
            <StateMultiSelect selected={form.licensedStates} onChange={v => setForm(p => ({ ...p, licensedStates: v }))} />
          </div>
          <div>
            <Label htmlFor="invite-commission">Commission Level</Label>
            <Input id="invite-commission" value={form.commissionLevel} onChange={e => setForm(p => ({ ...p, commissionLevel: e.target.value }))} placeholder="e.g. 75%" />
          </div>
        </div>
        <DialogFooter className="flex-col gap-3 sm:flex-col">
          <div className="flex gap-2 w-full justify-end">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => submit(false)} disabled={busy || !canInvite}>{saving ? "Sending..." : "Send Invitation"}</Button>
          </div>
          <div className="flex items-center gap-3 w-full">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">OR</span>
            <Separator className="flex-1" />
          </div>
          <Button variant="outline" className="w-full" onClick={() => submit(true)} disabled={busy || !canInvite}>
            <Copy className="w-4 h-4 mr-2" />
            {copying ? "Copying..." : "Copy Invite Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InviteUserModal;
