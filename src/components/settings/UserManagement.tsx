import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Search, MoreHorizontal, X, Check, ChevronDown,
  Shield, User as UserIcon, Users, Pencil, Ban, RefreshCw, Mail,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { usersApi } from "@/lib/mock-api";
import { User, UserProfile, UserRole, OnboardingItem } from "@/lib/types";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const AVAIL_COLORS: Record<string, string> = {
  Available: "bg-success",
  "On Break": "bg-warning",
  "Do Not Disturb": "bg-destructive",
  Offline: "bg-muted-foreground/50",
};

const ROLE_BADGE: Record<string, string> = {
  Admin: "bg-primary/10 text-primary",
  "Team Leader": "bg-info/10 text-info",
  Agent: "bg-success/10 text-success",
};

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-success/10 text-success",
  Inactive: "bg-muted text-muted-foreground",
  Pending: "bg-warning/10 text-warning",
};

type UserWithProfile = User & { profile: UserProfile };

function formatDate(d: string | null): string {
  if (!d) return "Never";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function goalColor(pct: number): string {
  if (pct >= 80) return "bg-success";
  if (pct >= 50) return "bg-warning";
  return "bg-destructive";
}

// ---- STATE MULTI-SELECT ----
const StateMultiSelect: React.FC<{
  selected: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}> = ({ selected, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() =>
    search ? US_STATES.filter(s => s.toLowerCase().includes(search.toLowerCase())) : US_STATES
  , [search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between h-auto min-h-[2.5rem] py-1.5" disabled={disabled}>
          <div className="flex flex-wrap gap-1 flex-1">
            {selected.length === 0 && <span className="text-muted-foreground text-sm">Select states...</span>}
            {selected.map(s => (
              <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
            ))}
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <Input placeholder="Search states..." value={search} onChange={e => setSearch(e.target.value)} className="mb-2 h-8" />
        <ScrollArea className="h-48">
          <div className="space-y-1">
            {filtered.map(st => (
              <label key={st} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer text-sm">
                <Checkbox
                  checked={selected.includes(st)}
                  onCheckedChange={(checked) => {
                    onChange(checked ? [...selected, st] : selected.filter(s => s !== st));
                  }}
                />
                {st}
              </label>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

// ---- INVITE MODAL ----
const InviteModal: React.FC<{ open: boolean; onClose: () => void; onSuccess: () => void }> = ({ open, onClose, onSuccess }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", role: "Agent" as UserRole, licensedStates: [] as string[], commissionLevel: "50%" });

  const handleSubmit = async () => {
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await usersApi.invite(form);
      toast({ title: "Invitation sent", description: `Invitation sent to ${form.email}` });
      setForm({ firstName: "", lastName: "", email: "", role: "Agent", licensedStates: [], commissionLevel: "50%" });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>Send an invitation to join AgentFlow.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} /></div>
            <div><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} /></div>
          </div>
          <div><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
          <div>
            <Label>Role</Label>
            <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v as UserRole }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Team Leader">Team Leader</SelectItem>
                <SelectItem value="Agent">Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Licensed States</Label><StateMultiSelect selected={form.licensedStates} onChange={v => setForm(p => ({ ...p, licensedStates: v }))} /></div>
          <div><Label>Commission Level</Label><Input value={form.commissionLevel} onChange={e => setForm(p => ({ ...p, commissionLevel: e.target.value }))} placeholder="e.g. 75%" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Sending..." : "Send Invitation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---- USER PROFILE MODAL ----
const UserProfileModal: React.FC<{
  user: UserWithProfile | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  currentUserId: string;
}> = ({ user, open, onClose, onSaved, currentUserId }) => {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("profile");

  // Editable copies
  const [form, setForm] = useState<Partial<User & UserProfile>>({});
  const [onboardingItems, setOnboardingItems] = useState<OnboardingItem[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [perfLoading, setPerfLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        status: user.status,
        licensedStates: user.profile.licensedStates,
        commissionLevel: user.profile.commissionLevel,
        uplineId: user.profile.uplineId,
        monthlyCallGoal: user.profile.monthlyCallGoal,
        monthlySalesGoal: user.profile.monthlySalesGoal,
        weeklyAppointmentGoal: user.profile.weeklyAppointmentGoal,
        monthlyTalkTimeGoalHours: user.profile.monthlyTalkTimeGoalHours,
      });
      setOnboardingItems([...user.profile.onboardingItems]);
      setEditMode(false);
      setTab("profile");
    }
  }, [user]);

  useEffect(() => {
    if (user && tab === "performance" && !performance) {
      setPerfLoading(true);
      usersApi.getPerformance(user.id).then(p => { setPerformance(p); setPerfLoading(false); });
    }
  }, [user, tab]);

  if (!user) return null;

  const initials = `${user.firstName[0]}${user.lastName[0]}`;

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await usersApi.update(user.id, {
        firstName: form.firstName as string,
        lastName: form.lastName as string,
        email: form.email as string,
        phone: form.phone as string,
        role: form.role as UserRole,
        status: form.status as any,
      });
      await usersApi.updateProfile(user.id, {
        licensedStates: form.licensedStates as string[],
        commissionLevel: form.commissionLevel as string,
        uplineId: form.uplineId,
      });
      toast({ title: "Saved", description: "User profile updated successfully." });
      setEditMode(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGoals = async () => {
    setSaving(true);
    try {
      await usersApi.updateProfile(user.id, {
        monthlyCallGoal: form.monthlyCallGoal as number,
        monthlySalesGoal: form.monthlySalesGoal as number,
        weeklyAppointmentGoal: form.weeklyAppointmentGoal as number,
        monthlyTalkTimeGoalHours: form.monthlyTalkTimeGoalHours as number,
      });
      toast({ title: "Saved", description: "Goals updated successfully." });
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOnboarding = async (key: string, checked: boolean) => {
    const updated = onboardingItems.map(i =>
      i.key === key ? { ...i, completed: checked, completedAt: checked ? new Date().toISOString() : null } : i
    );
    setOnboardingItems(updated);
    const allDone = updated.every(i => i.completed);
    try {
      await usersApi.updateProfile(user.id, { onboardingItems: updated, onboardingComplete: allDone });
      toast({ title: "Saved", description: `Onboarding item ${checked ? "completed" : "unchecked"}.` });
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResetOnboarding = async () => {
    const reset = onboardingItems.map(i => ({ ...i, completed: false, completedAt: null }));
    setOnboardingItems(reset);
    try {
      await usersApi.updateProfile(user.id, { onboardingItems: reset, onboardingComplete: false });
      toast({ title: "Saved", description: "Onboarding checklist reset." });
      onSaved();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const onboardingPct = onboardingItems.length ? Math.round(onboardingItems.filter(i => i.completed).length / onboardingItems.length * 100) : 0;

  // Mock actual values for goals
  const goalActuals = {
    calls: performance?.callsMade ?? Math.floor(Math.random() * (form.monthlyCallGoal as number || 100)),
    policies: performance?.policiesSold ?? Math.floor(Math.random() * (form.monthlySalesGoal as number || 10)),
    appointments: performance?.appointmentsSet ?? Math.floor(Math.random() * (form.weeklyAppointmentGoal as number || 10)),
    talkTime: performance ? parseFloat(performance.totalTalkTime) : Math.random() * (form.monthlyTalkTimeGoalHours as number || 20),
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary text-xl font-bold flex items-center justify-center">
              {initials}
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">{user.firstName} {user.lastName}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={ROLE_BADGE[user.role]}>{user.role}</Badge>
                <Badge className={STATUS_BADGE[user.status]}>{user.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Last login: {formatDate(user.lastLoginAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Edit Mode</Label>
              <Switch checked={editMode} onCheckedChange={setEditMode} />
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
            <TabsTrigger value="goals" className="flex-1">Goals</TabsTrigger>
            <TabsTrigger value="onboarding" className="flex-1">Onboarding</TabsTrigger>
            <TabsTrigger value="performance" className="flex-1">Performance</TabsTrigger>
          </TabsList>

          {/* PROFILE TAB */}
          <TabsContent value="profile" className="space-y-4 mt-4">
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
                    disabled={!editMode || user.id === currentUserId}
                    onCheckedChange={c => setForm(p => ({ ...p, status: c ? "Active" : "Inactive" }))}
                  />
                </div>
              </div>
            </div>
            <div><Label>Licensed States</Label><StateMultiSelect selected={(form.licensedStates as string[]) || []} onChange={v => setForm(p => ({ ...p, licensedStates: v }))} disabled={!editMode} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Commission Level</Label><Input value={form.commissionLevel as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, commissionLevel: e.target.value }))} placeholder="e.g. 75%" /></div>
              <div><Label>Upline Agent</Label><Input value={form.uplineId as string || ""} disabled={!editMode} onChange={e => setForm(p => ({ ...p, uplineId: e.target.value }))} placeholder="Agent ID" /></div>
            </div>
            {editMode && (
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                <Button onClick={handleSaveProfile} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
              </div>
            )}
          </TabsContent>

          {/* GOALS TAB */}
          <TabsContent value="goals" className="space-y-5 mt-4">
            {[
              { label: "Daily Calls Goal", key: "monthlyCallGoal", actual: goalActuals.calls },
              { label: "Monthly Policies Goal", key: "monthlySalesGoal", actual: goalActuals.policies },
              { label: "Weekly Appointments Goal", key: "weeklyAppointmentGoal", actual: goalActuals.appointments },
              { label: "Monthly Talk Time (hrs)", key: "monthlyTalkTimeGoalHours", actual: Math.round(goalActuals.talkTime) },
            ].map(g => {
              const target = (form as any)[g.key] as number || 1;
              const pct = Math.min(100, Math.round((g.actual / target) * 100));
              return (
                <div key={g.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{g.label}</Label>
                    <Input
                      type="number"
                      className="w-24 h-8 text-sm"
                      value={(form as any)[g.key] || 0}
                      onChange={e => setForm(p => ({ ...p, [g.key]: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${goalColor(pct)}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`text-xs font-medium min-w-[80px] text-right ${pct >= 80 ? "text-success" : pct >= 50 ? "text-warning" : "text-destructive"}`}>
                      {g.actual} / {target} ({pct}%)
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button onClick={handleSaveGoals} disabled={saving}>{saving ? "Saving..." : "Save Goals"}</Button>
            </div>
          </TabsContent>

          {/* ONBOARDING TAB */}
          <TabsContent value="onboarding" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground mb-1">Completion: {onboardingPct}%</p>
                <Progress value={onboardingPct} className="h-2" />
              </div>
              <Button variant="outline" size="sm" className="ml-4" onClick={handleResetOnboarding}>Reset Checklist</Button>
            </div>
            <div className="space-y-2">
              {onboardingItems.map(item => (
                <label key={item.key} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors">
                  <Checkbox
                    checked={item.completed}
                    onCheckedChange={(c) => handleToggleOnboarding(item.key, !!c)}
                  />
                  <span className={`flex-1 text-sm ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>{item.label}</span>
                  {item.completedAt && <span className="text-xs text-muted-foreground">{new Date(item.completedAt).toLocaleDateString()}</span>}
                </label>
              ))}
            </div>
          </TabsContent>

          {/* PERFORMANCE TAB */}
          <TabsContent value="performance" className="space-y-4 mt-4">
            {perfLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : performance ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Calls Made", value: performance.callsMade },
                    { label: "Policies Sold", value: performance.policiesSold },
                    { label: "Appointments Set", value: performance.appointmentsSet },
                    { label: "Total Talk Time", value: performance.totalTalkTime },
                    { label: "Conversion Rate", value: performance.conversionRate },
                  ].map(s => (
                    <div key={s.label} className="bg-accent/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-lg font-bold text-foreground mt-0.5">{s.value}</p>
                    </div>
                  ))}
                </div>
                {/* Goal progress */}
                <h4 className="text-sm font-medium text-foreground mt-4">Goal Progress</h4>
                {[
                  { label: "Calls", actual: performance.callsMade, target: form.monthlyCallGoal as number },
                  { label: "Policies", actual: performance.policiesSold, target: form.monthlySalesGoal as number },
                  { label: "Appointments", actual: performance.appointmentsSet, target: form.weeklyAppointmentGoal as number },
                ].map(g => {
                  const pct = g.target ? Math.min(100, Math.round((g.actual / g.target) * 100)) : 0;
                  return (
                    <div key={g.label} className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground w-24">{g.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${goalColor(pct)}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-20 text-right">{g.actual}/{g.target}</span>
                    </div>
                  );
                })}
                {/* Recent calls */}
                <h4 className="text-sm font-medium text-foreground mt-4">Recent Calls</h4>
                {performance.recentCalls.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent calls.</p>
                ) : (
                  <div className="space-y-2">
                    {performance.recentCalls.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent/30 text-sm">
                        <span className="text-foreground">{c.contactName}</span>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="text-xs">{c.disposition || "N/A"}</Badge>
                          <span className="text-muted-foreground text-xs">{Math.floor(c.duration / 60)}:{String(c.duration % 60).padStart(2, "0")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select Performance tab to load stats.</p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

// ---- MAIN COMPONENT ----
const UserManagement: React.FC = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; user: UserWithProfile | null; action: "deactivate" | "reactivate" }>({ open: false, user: null, action: "deactivate" });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await usersApi.getAll({ search, role: roleFilter, status: statusFilter });
      setUsers(data);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDeactivateReactivate = async () => {
    const u = confirmDialog.user;
    if (!u) return;
    try {
      if (confirmDialog.action === "deactivate") {
        await usersApi.deactivate(u.id);
        toast({ title: "Deactivated", description: `${u.firstName} ${u.lastName} has been deactivated.` });
      } else {
        await usersApi.reactivate(u.id);
        toast({ title: "Reactivated", description: `${u.firstName} ${u.lastName} has been reactivated.` });
      }
      setConfirmDialog({ open: false, user: null, action: "deactivate" });
      fetchUsers();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResendInvite = async (u: UserWithProfile) => {
    try {
      await usersApi.resendInvite(u.id);
      toast({ title: "Invite resent", description: `Invitation resent to ${u.email}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">User Management</h3>
        <Button onClick={() => setInviteOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Invite User
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Roles</SelectItem>
            <SelectItem value="Admin">Admin</SelectItem>
            <SelectItem value="Team Leader">Team Leader</SelectItem>
            <SelectItem value="Agent">Agent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Users Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No users found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b bg-accent/50">
                <th className="text-left py-3 px-4 font-medium">User</th>
                <th className="text-left py-3 font-medium">Email</th>
                <th className="text-left py-3 font-medium">Role</th>
                <th className="text-left py-3 font-medium">Status</th>
                <th className="text-left py-3 font-medium">Availability</th>
                <th className="text-left py-3 font-medium">Last Login</th>
                <th className="text-right py-3 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr
                  key={u.id}
                  className="border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer"
                  onClick={() => { setSelectedUser(u); setProfileOpen(true); }}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                        {u.firstName[0]}{u.lastName[0]}
                      </div>
                      <span className="font-medium text-foreground">{u.firstName} {u.lastName}</span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{u.email}</td>
                  <td className="py-3"><Badge className={ROLE_BADGE[u.role]}>{u.role}</Badge></td>
                  <td className="py-3"><Badge className={STATUS_BADGE[u.status]}>{u.status}</Badge></td>
                  <td className="py-3"><span className={`w-2.5 h-2.5 rounded-full inline-block ${AVAIL_COLORS[u.availabilityStatus]}`} title={u.availabilityStatus} /></td>
                  <td className="py-3 text-muted-foreground text-xs">{formatDate(u.lastLoginAt)}</td>
                  <td className="py-3 pr-4 text-right" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setSelectedUser(u); setProfileOpen(true); }}>
                          <Pencil className="w-4 h-4 mr-2" /> Edit User
                        </DropdownMenuItem>
                        {u.status === "Active" && u.id !== currentUser?.id && (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setConfirmDialog({ open: true, user: u, action: "deactivate" })}
                          >
                            <Ban className="w-4 h-4 mr-2" /> Deactivate
                          </DropdownMenuItem>
                        )}
                        {(u.status === "Inactive") && (
                          <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, user: u, action: "reactivate" })}>
                            <RefreshCw className="w-4 h-4 mr-2" /> Reactivate
                          </DropdownMenuItem>
                        )}
                        {u.status === "Pending" && (
                          <DropdownMenuItem onClick={() => handleResendInvite(u)}>
                            <Mail className="w-4 h-4 mr-2" /> Resend Invite
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite Modal */}
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onSuccess={fetchUsers} />

      {/* Profile Modal */}
      <UserProfileModal
        user={selectedUser}
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setSelectedUser(null); }}
        onSaved={() => { fetchUsers(); }}
        currentUserId={currentUser?.id || ""}
      />

      {/* Confirm Deactivate/Reactivate */}
      <Dialog open={confirmDialog.open} onOpenChange={v => !v && setConfirmDialog({ open: false, user: null, action: "deactivate" })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmDialog.action === "deactivate" ? "Deactivate User" : "Reactivate User"}</DialogTitle>
            <DialogDescription>
              {confirmDialog.action === "deactivate"
                ? `Are you sure you want to deactivate ${confirmDialog.user?.firstName} ${confirmDialog.user?.lastName}? They will lose access immediately.`
                : `Reactivate ${confirmDialog.user?.firstName} ${confirmDialog.user?.lastName}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog({ open: false, user: null, action: "deactivate" })}>Cancel</Button>
            <Button
              variant={confirmDialog.action === "deactivate" ? "destructive" : "default"}
              onClick={handleDeactivateReactivate}
            >
              {confirmDialog.action === "deactivate" ? "Confirm Deactivate" : "Reactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
