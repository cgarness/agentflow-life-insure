import React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { CommissionGate } from "@/components/PermissionGate";
import ProfileCarriersSection, { normalizeProfileCarriers } from "@/components/settings/ProfileCarriersSection";
import { UserRole } from "@/lib/types";
import StateMultiSelect from "./StateMultiSelect";
import SingleStateSelect from "./SingleStateSelect";
import type { UserWithProfile } from "./userManagementTypes";

interface Props {
  form: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  setForm: (updater: (p: any) => any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  editMode: boolean;
  isSuperAdmin: boolean;
  setIsSuperAdmin: (v: boolean) => void;
  isCurrentUserSuperAdmin: boolean;
  isSelf: boolean;
  uplineCandidates: UserWithProfile[];
  saving: boolean;
  onResetPasswordClick: () => void;
  onDeleteClick: () => void;
  onCancel: () => void;
  onSave: () => void;
}

const UserProfileTab: React.FC<Props> = ({
  form, setForm, editMode, isSuperAdmin, setIsSuperAdmin, isCurrentUserSuperAdmin,
  isSelf, uplineCandidates, saving, onResetPasswordClick, onDeleteClick, onCancel, onSave,
}) => {
  return (
    <div className="space-y-4 mt-0">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>First Name</Label><Input value={form.firstName as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} /></div>
        <div><Label>Last Name</Label><Input value={form.lastName as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Email</Label><Input type="email" value={form.email as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
        <div><Label>Phone</Label><Input value={form.phone as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Role</Label>
          <Select value={form.role as string} disabled={!editMode} onValueChange={v => setForm(p => ({ ...p, role: v as UserRole }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Admin">Admin</SelectItem>
              <SelectItem value="Team Leader">Team Leader</SelectItem>
              <SelectItem value="Agent">Agent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm text-foreground">{form.status === "Active" ? "Active" : "Inactive"}</span>
            <Switch
              checked={form.status === "Active"}
              disabled={!editMode || isSelf}
              onCheckedChange={(checked) => setForm(p => ({ ...p, status: checked ? "Active" : "Inactive" }))}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="ml-auto gap-1.5" disabled={isSelf} onClick={() => !isSelf && onResetPasswordClick()}>
                    <Lock className="w-3.5 h-3.5" />
                    Reset Password
                  </Button>
                </TooltipTrigger>
                {isSelf && (
                  <TooltipContent><p>Use Profile Settings to change your own password</p></TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {isCurrentUserSuperAdmin && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-foreground">Super Admin Access</p>
              <p className="text-xs text-muted-foreground">Grants full system access across all organizations.</p>
            </div>
          </div>
          <Switch
            checked={isSuperAdmin}
            disabled={!editMode || (isSelf && isSuperAdmin)}
            onCheckedChange={setIsSuperAdmin}
          />
        </div>
      )}

      <div><Label>Licensed States</Label><StateMultiSelect selected={(form.licensedStates as any[]) || []} onChange={v => setForm(p => ({ ...p, licensedStates: v }))} disabled={!editMode} /></div>
      <div><Label>Resident State</Label><SingleStateSelect value={form.residentState as string} onChange={v => setForm(p => ({ ...p, residentState: v }))} disabled={!editMode} /></div>

      <ProfileCarriersSection
        carriers={normalizeProfileCarriers(form.carriers)}
        onChange={(next) => setForm((p) => ({ ...p, carriers: next }))}
        disabled={!editMode}
        adminEditing
      />

      <div className="grid grid-cols-2 gap-4">
        <CommissionGate metric="View Others' Commission Percentage">
          <div><Label>Commission Level</Label><Input value={form.commissionLevel as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, commissionLevel: e.target.value }))} placeholder="e.g. 75%" /></div>
        </CommissionGate>
        <div>
          <Label>Upline Agent</Label>
          <Select value={form.uplineId || "_none"} disabled={!editMode} onValueChange={v => setForm(p => ({ ...p, uplineId: v === "_none" ? null : v }))}>
            <SelectTrigger><SelectValue placeholder="Select upline agent..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">None</SelectItem>
              {uplineCandidates.map(u => (
                <SelectItem key={u.id} value={u.id}>
                  <span className="flex items-center gap-2">
                    {u.firstName} {u.lastName}
                    <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">{u.role}</Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {editMode && (
        <div className="flex gap-2 justify-end pt-4 pb-2">
          {!isSelf && (
            <Button variant="ghost" className="text-destructive hover:bg-destructive/10 mr-auto" onClick={onDeleteClick}>
              Delete User
            </Button>
          )}
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
        </div>
      )}
    </div>
  );
};

export default UserProfileTab;
