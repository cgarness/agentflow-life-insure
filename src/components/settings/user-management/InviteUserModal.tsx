import React, { useState } from "react";
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

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  managers: UserWithProfile[];
}

const InviteUserModal: React.FC<Props> = ({ open, onClose, onSuccess, managers }) => {
  const { toast } = useToast();
  const { user: currentUser, profile: currentProfile } = useAuth();
  const { organizationId } = useOrganization();
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

  const handleSubmit = async () => {
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await usersApi.invite({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        role: form.role,
        uplineId: form.uplineId || undefined,
        licensedStates: form.licensedStates,
        commissionLevel: form.commissionLevel,
      });
      toast({ title: "Invitation sent", description: `Invitation email sent to ${form.email}` });
      if (organizationId) {
        void logActivity({
          action: `Invited ${form.email} as ${form.role}`,
          category: "user_management",
          organizationId,
          userId: currentUser?.id,
          userName: currentProfile ? `${currentProfile.first_name} ${currentProfile.last_name}` : undefined,
          metadata: { invitedEmail: form.email, role: form.role },
        });
      }
      resetForm();
      onSuccess();
      onClose();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = async () => {
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Missing fields", description: "Please fill in name and email first.", variant: "destructive" });
      return;
    }
    setCopying(true);
    try {
      const result = await usersApi.invite({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        role: form.role,
        uplineId: form.uplineId || undefined,
        licensedStates: form.licensedStates,
        commissionLevel: form.commissionLevel,
      });
      const link = await usersApi.generateInviteLink(result.token);
      await navigator.clipboard.writeText(link);
      toast({ title: "Invite link copied", description: "Invite link copied to clipboard. Link expires after 7 days." });
      onSuccess();
      onClose();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCopying(false);
    }
  };

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
              <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v as UserRole }))}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Admin">Admin</SelectItem>
                  <SelectItem value="Team Leader">Team Leader</SelectItem>
                  <SelectItem value="Agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="invite-upline">Upline Manager</Label>
              <Select value={form.uplineId || "_none"} onValueChange={v => setForm(p => ({ ...p, uplineId: v === "_none" ? null : v }))}>
                <SelectTrigger id="invite-upline"><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {managers.map(m => (
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
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Sending..." : "Send Invitation"}</Button>
          </div>
          <div className="flex items-center gap-3 w-full">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">OR</span>
            <Separator className="flex-1" />
          </div>
          <Button variant="outline" className="w-full" onClick={handleCopyLink} disabled={copying}>
            <Copy className="w-4 h-4 mr-2" />
            {copying ? "Copying..." : "Copy Invite Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InviteUserModal;
