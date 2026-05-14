import React, { useState } from "react";
import { z } from "zod";
import { Mail, Trash2, RotateCw, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { agencyGroupApi } from "./api";
import AgencyGroupResourceList from "./AgencyGroupResourceList";
import type { AgencyGroup, AgencyGroupMember, AgencyGroupResource } from "./types";

const emailSchema = z.string().email("Invalid email");

interface Props {
  group: AgencyGroup;
  members: AgencyGroupMember[];
  resources: AgencyGroupResource[];
  onChange: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  invited: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  left: "bg-muted text-muted-foreground border-border",
  removed: "bg-muted text-muted-foreground border-border",
};

const AgencyGroupLeaderView: React.FC<Props> = ({ group, members, resources, onChange }) => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(group.name);

  const visibleMembers = showInactive ? members : members.filter((m) => m.status === "active" || m.status === "invited");
  const activeMembers = members.filter((m) => m.status === "active").length;

  const handleInvite = async () => {
    const parsed = emailSchema.safeParse(inviteEmail.trim().toLowerCase());
    if (!parsed.success) {
      toast({ title: "Invalid email", description: parsed.error.errors[0].message, variant: "destructive" });
      return;
    }
    setBusy(true);
    const res = await agencyGroupApi.invite(group.id, parsed.data);
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Invite failed", description: res.data?.error ?? "Unknown error", variant: "destructive" });
      return;
    }
    toast({ title: "Invitation sent", description: res.data?.email_sent ? "Email delivered." : "Recorded — email may not have sent." });
    setInviteEmail("");
    onChange();
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm("Remove this member from the group?")) return;
    const res = await agencyGroupApi.remove(group.id, memberId);
    if (!res.ok) {
      toast({ title: "Remove failed", description: res.data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Member removed" });
    onChange();
  };

  const handleResend = async (email: string | null) => {
    if (!email) return;
    // Revoke existing, then re-invite. Simplest path: just call invite — the dedup check will block, so we just notify.
    toast({ title: "Pending invite already exists", description: `Revoke and re-invite ${email} to send a new email.` });
  };

  const handleRename = async () => {
    if (newName.trim().length < 2) return;
    const { error } = await supabase.from("agency_groups").update({ name: newName.trim() }).eq("id", group.id);
    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
      return;
    }
    setRenaming(false);
    toast({ title: "Group renamed" });
    onChange();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${group.name}"? This removes all members and resources.`)) return;
    const { error } = await supabase.from("agency_groups").delete().eq("id", group.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Group deleted" });
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border p-6">
        <div className="flex items-center justify-between mb-2">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9 px-3 rounded-lg bg-accent text-sm border-0" />
              <button onClick={handleRename} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">Save</button>
              <button onClick={() => { setRenaming(false); setNewName(group.name); }} className="h-9 px-3 rounded-lg bg-accent text-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-lg">{group.name}</h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-primary/10 text-primary border border-primary/30">
                <Crown className="w-3 h-3" /> Leader
              </span>
              <button onClick={() => setRenaming(true)} className="text-xs text-muted-foreground hover:text-foreground">Rename</button>
            </div>
          )}
          <button onClick={handleDelete} className="text-xs text-destructive hover:underline">Delete group</button>
        </div>
        <p className="text-xs text-muted-foreground">
          {activeMembers} active member{activeMembers === 1 ? "" : "s"} · Created {new Date(group.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="rounded-2xl bg-card border border-border p-6">
        <h3 className="font-semibold mb-3">Invite an Agency</h3>
        <div className="flex gap-2 mb-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="admin@theiragency.com"
            className="flex-1 h-10 px-3 rounded-lg bg-accent text-sm border-0"
          />
          <button onClick={handleInvite} disabled={busy} className="h-10 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2">
            <Mail className="w-4 h-4" /> Send Invite
          </button>
        </div>
        <p className="text-xs text-muted-foreground">The Admin of the invited agency will get an email with an acceptance link valid for 7 days.</p>
      </div>

      <div className="rounded-2xl bg-card border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Members</h3>
          <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
          </label>
        </div>
        <ul className="space-y-2">
          {visibleMembers.map((m) => {
            const isYou = m.organization_id === profile?.organization_id;
            return (
              <li key={m.id} className="flex items-center gap-3 p-3 rounded-lg bg-accent/40">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {m.organizations?.name ?? m.invite_email ?? "(pending org)"} {isYou && <span className="text-xs font-normal text-primary ml-1">(Your Agency)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.role === "leader" ? "Master Agency" : m.joined_at ? `Joined ${new Date(m.joined_at).toLocaleDateString()}` : m.invite_email ? `Invited ${new Date(m.invited_at ?? m.invite_expires_at ?? Date.now()).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full border ${STATUS_COLORS[m.status]}`}>{m.status}</span>
                {!isYou && m.status === "invited" && (
                  <>
                    <button onClick={() => handleResend(m.invite_email)} className="text-muted-foreground hover:text-foreground" title="Resend"><RotateCw className="w-4 h-4" /></button>
                    <button onClick={() => handleRemove(m.id)} className="text-muted-foreground hover:text-destructive" title="Revoke"><Trash2 className="w-4 h-4" /></button>
                  </>
                )}
                {!isYou && m.status === "active" && (
                  <button onClick={() => handleRemove(m.id)} className="text-muted-foreground hover:text-destructive" title="Remove"><Trash2 className="w-4 h-4" /></button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <AgencyGroupResourceList
        groupId={group.id}
        resources={resources}
        ownOrgId={profile?.organization_id ?? ""}
        onChange={onChange}
      />
    </div>
  );
};

export default AgencyGroupLeaderView;
