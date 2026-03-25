import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Plus, Search, MoreHorizontal, X, ChevronDown,
  Shield, User as UserIcon, Users, Pencil, Ban, RefreshCw, Mail,
  Lock, Copy, Camera, ZoomIn, PhoneCall, ShieldCheck, TrendingUp,
  Clock, Percent, Target,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { User, UserProfile, UserRole, OnboardingItem } from "@/lib/types";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const US_STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",
  DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",
  MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",
  WI:"Wisconsin",WY:"Wyoming",
};

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

// ---- STATE MULTI-SELECT (FIXED: handles objects with license numbers) ----
const StateMultiSelect: React.FC<{
  selected: { state: string; licenseNumber: string }[];
  onChange: (v: { state: string; licenseNumber: string }[]) => void;
  disabled?: boolean;
}> = ({ selected, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedStateNames = useMemo(() => selected.map(s => s.state), [selected]);
  
  const filtered = useMemo(() =>
    search
      ? US_STATES.filter(s =>
          s.toLowerCase().includes(search.toLowerCase()) ||
          (US_STATE_NAMES[s] || "").toLowerCase().includes(search.toLowerCase())
        )
      : US_STATES
  , [search]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {selected.map(s => (
          <div key={s.state} className="flex flex-col gap-1.5 p-2 border rounded-md bg-accent/20 min-w-0">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-xs">{s.state}</Badge>
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                  onClick={() => onChange(selected.filter(x => x.state !== s.state))}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <Input
              placeholder="License #"
              value={s.licenseNumber}
              disabled={disabled}
              onChange={e => onChange(selected.map(x => x.state === s.state ? { ...x, licenseNumber: e.target.value } : x))}
              className="h-7 text-[10px] px-2"
            />
          </div>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-10" disabled={disabled}>
            <span className="text-muted-foreground text-sm">
              {selected.length === 0 ? "Add licensed states..." : `Add more states (${selected.length} selected)`}
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-2 border-b">
            <Input
              placeholder="Search states..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8"
              autoFocus
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filtered.map(st => (
              <label key={st} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm">
                <Checkbox
                  checked={selectedStateNames.includes(st)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange([...selected, { state: st, licenseNumber: "" }]);
                    } else {
                      onChange(selected.filter(s => s.state !== st));
                    }
                  }}
                />
                <span className="font-medium">{st}</span>
                <span className="text-muted-foreground text-xs">{US_STATE_NAMES[st]}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

// ---- SINGLE STATE SELECT ----
const SingleStateSelect: React.FC<{
  value?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() =>
    search
      ? US_STATES.filter(s =>
          s.toLowerCase().includes(search.toLowerCase()) ||
          (US_STATE_NAMES[s] || "").toLowerCase().includes(search.toLowerCase())
        )
      : US_STATES
  , [search]);

  return (
    <div>
      {value && (
        <div className="flex flex-wrap gap-1 mb-2">
          <Badge variant="secondary" className="text-xs gap-1 pr-1">
            {value} - {US_STATE_NAMES[value]}
            {!disabled && (
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                onClick={() => onChange("")}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </Badge>
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-10" disabled={disabled}>
            <span className="text-muted-foreground text-sm">
              {value ? `${value} - ${US_STATE_NAMES[value]}` : "Select resident state..."}
            </span>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-2 border-b">
            <Input placeholder="Search states..." value={search} onChange={e => setSearch(e.target.value)} className="h-8" autoFocus />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filtered.map(st => (
              <button
                key={st}
                type="button"
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-sm text-left ${value === st ? "bg-accent" : ""}`}
                onClick={() => { onChange(st); setOpen(false); setSearch(""); }}
              >
                <span className="font-medium">{st}</span>
                <span className="text-muted-foreground text-xs">{US_STATE_NAMES[st]}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

// ---- AVATAR UPLOAD WITH CROP PREVIEW ----
const AvatarUpload: React.FC<{
  currentAvatar?: string;
  initials: string;
  onAvatarChange: (dataUrl: string) => void;
  disabled?: boolean;
}> = ({ currentAvatar, initials, onAvatarChange, disabled }) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [zoom, setZoom] = useState([1]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload JPG, PNG, or GIF only.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirm = () => {
    if (previewUrl) {
      onAvatarChange(previewUrl);
      toast({ title: "Avatar updated", description: "Profile photo has been updated." });
    }
    setCropOpen(false);
    setPreviewUrl(null);
    setZoom([1]);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif" className="hidden" onChange={handleFileSelect} />
      <button
        type="button"
        className="relative w-16 h-16 rounded-full bg-primary/10 text-primary text-xl font-bold flex items-center justify-center overflow-hidden group cursor-pointer"
        onClick={() => !disabled && fileRef.current?.click()}
        disabled={disabled}
      >
        {currentAvatar ? (
          <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" style={{ transform: `scale(${zoom[0]})` }} />
        ) : (
          initials
        )}
        {!disabled && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera className="w-5 h-5 text-white" />
          </div>
        )}
      </button>

      {/* Crop/Preview Modal */}
      <Dialog open={cropOpen} onOpenChange={v => { if (!v) { setCropOpen(false); setPreviewUrl(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Crop Avatar</DialogTitle>
            <DialogDescription>Adjust zoom and confirm your profile photo.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div className="w-40 h-40 rounded-full overflow-hidden border-2 border-border bg-muted flex items-center justify-center">
              {previewUrl && (
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" style={{ transform: `scale(${zoom[0]})` }} />
              )}
            </div>
            <div className="flex items-center gap-3 w-full">
              <ZoomIn className="w-4 h-4 text-muted-foreground" />
              <Slider value={zoom} onValueChange={setZoom} min={1} max={3} step={0.1} className="flex-1" />
              <span className="text-xs text-muted-foreground w-8">{zoom[0].toFixed(1)}x</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCropOpen(false); setPreviewUrl(null); }}>Cancel</Button>
            <Button onClick={handleConfirm}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ---- INVITE MODAL (with Copy Invite Link) ----
const InviteModal: React.FC<{ 
  open: boolean; 
  onClose: () => void; 
  onSuccess: () => void;
  managers: UserWithProfile[];
}> = ({ open, onClose, onSuccess, managers }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [form, setForm] = useState({ 
    firstName: "", 
    lastName: "", 
    email: "", 
    role: "Agent" as UserRole, 
    licensedStates: [] as { state: string; licenseNumber: string }[], 
    commissionLevel: "50%",
    uplineId: null as string | null
  });

  const { organizationId } = useOrganization();

  const handleSubmit = async () => {
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    try {
      // Create invite link and notify backend (Wait for an actual edge function)
      // await usersApi.invite(form, organizationId);
      const link = await usersApi.generateInviteLink({ firstName: form.firstName, lastName: form.lastName, email: form.email, role: form.role, uplineId: form.uplineId }, organizationId);
      console.log("Generated Invite Link:", link);
      toast({ title: "Invitation link generated", description: `You can send this link to ${form.email}` });
      setForm({ firstName: "", lastName: "", email: "", role: "Agent", licensedStates: [], commissionLevel: "50%", uplineId: null });
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
      const link = await usersApi.generateInviteLink({ firstName: form.firstName, lastName: form.lastName, email: form.email, role: form.role, uplineId: form.uplineId }, organizationId);
      await navigator.clipboard.writeText(link);
      toast({ title: "Invite link copied", description: "Invite link copied to clipboard. Link expires after 7 days." });
      // Removed broken pending user creation
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
            <div><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} /></div>
            <div><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} /></div>
          </div>
          <div><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <Label>Upline Manager</Label>
              <Select value={form.uplineId || "_none"} onValueChange={v => setForm(p => ({ ...p, uplineId: v === "_none" ? null : v }))}>
                <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">None</SelectItem>
                  {managers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Licensed States</Label><StateMultiSelect selected={form.licensedStates} onChange={v => setForm(p => ({ ...p, licensedStates: v }))} /></div>
          <div><Label>Commission Level</Label><Input value={form.commissionLevel} onChange={e => setForm(p => ({ ...p, commissionLevel: e.target.value }))} placeholder="e.g. 75%" /></div>
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

// ---- USER PROFILE MODAL ----
const UserProfileModal: React.FC<{
  user: UserWithProfile | null;
  open: boolean;
  onClose: () => void;
  onSaved: (patch?: Partial<UserWithProfile>) => void;
  onDeleted: (id: string) => void;
  currentUserId: string;
  allUsers: UserWithProfile[];
}> = ({ user, open, onClose, onSaved, onDeleted, currentUserId, allUsers }) => {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("profile");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [form, setForm] = useState<Partial<User & UserProfile>>({});
  const [onboardingItems, setOnboardingItems] = useState<OnboardingItem[]>([]);
  const [performance, setPerformance] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [perfLoading, setPerfLoading] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);

  // Agents/Team Leaders for upline dropdown
  const uplineCandidates = useMemo(() =>
    allUsers.filter(u => u.id !== user?.id && (u.role === "Agent" || u.role === "Team Leader" || u.role === "Admin"))
  , [allUsers, user]);

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
        residentState: user.profile.residentState || "",
        commissionLevel: user.profile.commissionLevel,
        uplineId: user.profile.uplineId,
        monthlyCallGoal: user.profile.monthlyCallGoal,
        monthlyPoliciesGoal: user.profile.monthlyPoliciesGoal,
        weeklyAppointmentGoal: user.profile.weeklyAppointmentGoal,
        monthlyTalkTimeGoalHours: user.profile.monthlyTalkTimeGoalHours,
        npn: user.profile.npn || "",
        timezone: user.profile.timezone || "",
      });
      setOnboardingItems([...user.profile.onboardingItems]);
      setAvatarUrl(user.avatar);
      setEditMode(true);
      setTab("profile");
      setPerformance(null);
    }
  }, [user]);

  useEffect(() => {
    if (user && (tab === "performance" || tab === "goals") && !performance) {
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
        status: form.status as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        avatar: avatarUrl,
      });
      await usersApi.updateProfile(user.id, {
        licensedStates: (form.licensedStates as any[]) || [],
        residentState: (form.residentState as string) || "",
        commissionLevel: (form.commissionLevel as string) || "0%",
        uplineId: form.uplineId === "_none" ? null : form.uplineId,
        npn: (form.npn as string) || "",
        timezone: (form.timezone as string) || "Eastern Time (US & Canada)",
      });
      toast({ title: "Changes saved successfully" });
      setEditMode(false);
      onSaved({ id: user.id, role: form.role as UserRole, status: form.status as any, firstName: form.firstName as string, lastName: form.lastName as string });
    } catch (e: any) {
      toast({ title: "Failed to save changes", description: e.message || "An unknown error occurred", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = (checked: boolean) => {
    setForm(p => ({ ...p, status: checked ? "Active" : "Inactive" }));
  };

  const handleSaveGoals = async () => {
    setSaving(true);
    try {
      await usersApi.updateProfile(user.id, {
        monthlyCallGoal: form.monthlyCallGoal as number,
        monthlyPoliciesGoal: form.monthlyPoliciesGoal as number,
        weeklyAppointmentGoal: form.weeklyAppointmentGoal as number,
        monthlyTalkTimeGoalHours: form.monthlyTalkTimeGoalHours as number,
      });
      toast({ title: "Saved", description: "Goals updated successfully." });
      onSaved();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
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
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
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
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResetPassword = async () => {
    try {
      await usersApi.resetPassword(user.email);
      toast({ title: "Password reset email sent", description: `Password reset email sent to ${user.email}` });
      setResetPwOpen(false);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteUser = async () => {
    setSaving(true);
    try {
      await usersApi.deleteUser(user.id);
      toast({ title: "User deleted successfully" });
      setDeleteConfirmOpen(false);
      onClose();
      onDeleted(user.id);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      console.error(e);
      toast({ title: "Failed to delete user. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onboardingPct = onboardingItems.length ? Math.round(onboardingItems.filter(i => i.completed).length / onboardingItems.length * 100) : 0;

  const goalActuals = {
    callsMonth: performance?.callsMonthly ?? 0,
    policiesMonth: performance?.policiesMonthly ?? 0,
    appointmentsWeek: performance?.appsWeekly ?? 0,
    talkTimeMonth: performance?.talkTimeMonthlyHours ?? 0,
  };

  const isSelf = user.id === currentUserId;

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="w-[850px] max-w-[95vw] h-[720px] max-h-[92vh] flex flex-col overflow-hidden p-0">
          <div className="p-6 pb-0 flex items-start justify-between flex-shrink-0">
            <div className="flex items-center gap-4">
              <AvatarUpload
                currentAvatar={avatarUrl}
                initials={initials}
                onAvatarChange={setAvatarUrl}
                disabled={!editMode}
              />
              <div>
                <h2 className="text-xl font-bold text-foreground">{user.firstName} {user.lastName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={ROLE_BADGE[user.role]}>{user.role}</Badge>
                  <Badge className={STATUS_BADGE[user.status]}>{user.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Last login: {formatDate(user.lastLoginAt)}</p>
              </div>
            </div>
            {/* Header Right spacer if needed */}
          </div>

          <div className="px-6 mt-4 flex-shrink-0">
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
                <TabsTrigger value="goals" className="flex-1">Goals</TabsTrigger>
                <TabsTrigger value="onboarding" className="flex-1">Onboarding</TabsTrigger>
                <TabsTrigger value="performance" className="flex-1">Performance</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-6 pt-0 mt-4">
            <Tabs value={tab} className="mt-0 border-none shadow-none">
              {/* Profile Tab Section */}
              <TabsContent value="profile" className="space-y-4 mt-0">
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
                        onCheckedChange={handleToggleStatus}
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-auto gap-1.5"
                              disabled={isSelf}
                              onClick={() => !isSelf && setResetPwOpen(true)}
                            >
                              <Lock className="w-3.5 h-3.5" />
                              Reset Password
                            </Button>
                          </TooltipTrigger>
                          {isSelf && (
                            <TooltipContent>
                              <p>Use Profile Settings to change your own password</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
                <div><Label>Licensed States</Label><StateMultiSelect selected={(form.licensedStates as any[]) || []} onChange={v => setForm(p => ({ ...p, licensedStates: v }))} disabled={!editMode} /></div>
                <div><Label>Resident State</Label><SingleStateSelect value={form.residentState as string} onChange={v => setForm(p => ({ ...p, residentState: v }))} disabled={!editMode} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Commission Level</Label><Input value={form.commissionLevel as string} disabled={!editMode} onChange={e => setForm(p => ({ ...p, commissionLevel: e.target.value }))} placeholder="e.g. 75%" /></div>
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
                      <Button
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 mr-auto"
                        onClick={() => setDeleteConfirmOpen(true)}
                      >
                        Delete User
                      </Button>
                    )}
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSaveProfile} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
                  </div>
                )}
              </TabsContent>

              {/* Goals Tab Section */}
              <TabsContent value="goals" className="space-y-4 mt-0">
                {perfLoading && (
                  <div className="grid grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}
                  </div>
                )}
                
                {!perfLoading && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: "Monthly Calls Goal", key: "monthlyCallGoal", actual: goalActuals.callsMonth, icon: PhoneCall, color: "text-blue-500", bg: "bg-blue-500/10" },
                        { label: "Monthly Policies Goal", key: "monthlyPoliciesGoal", actual: goalActuals.policiesMonth, icon: ShieldCheck, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                        { label: "Weekly Appointments Goal", key: "weeklyAppointmentGoal", actual: goalActuals.appointmentsWeek, icon: Users, color: "text-amber-500", bg: "bg-amber-500/10" },
                        { label: "Monthly Talk Time (hrs)", key: "monthlyTalkTimeGoalHours", actual: Math.round(goalActuals.talkTimeMonth), icon: TrendingUp, color: "text-purple-500", bg: "bg-purple-500/10" },
                      ].map(g => {
                        const Icon = g.icon;
                        const target = (form as any)[g.key] as number || 1;
                        const pct = Math.min(100, Math.round((g.actual / target) * 100));
                        return (
                          <div key={g.key} className="bg-card/50 border rounded-xl p-3.5 space-y-3 shadow-sm hover:border-primary/30 transition-colors relative overflow-hidden group">
                            <div className={`absolute -right-4 -top-4 w-16 h-16 rounded-full ${g.bg} opacity-20 blur-2xl group-hover:opacity-40 transition-opacity`} />
                            
                            <div className="flex items-center justify-between relative z-10">
                              <div className="flex items-center gap-2.5">
                                <div className={`p-1.5 rounded-lg ${g.bg} border border-white/10 shadow-sm`}>
                                  <Icon className={`w-3.5 h-3.5 ${g.color}`} />
                                </div>
                                <Label className="text-[10px] font-bold text-foreground/70 uppercase tracking-widest">{g.label}</Label>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-muted-foreground font-black uppercase tracking-tighter opacity-70">Target</span>
                                <Input
                                  type="number"
                                  className="w-14 h-7 text-[11px] font-black bg-muted/30 border-none shadow-inner text-center p-0 focus-visible:ring-1 focus-visible:ring-primary/30"
                                  value={(form as any)[g.key] || 0}
                                  onChange={e => setForm(p => ({ ...p, [g.key]: parseInt(e.target.value) || 0 }))}
                                />
                              </div>
                            </div>
                            
                            <div className="space-y-2 relative z-10">
                              <div className="flex items-end justify-between px-0.5">
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase leading-none mb-1" >Status</span>
                                  <span className={`text-sm font-black tabular-nums tracking-tight ${pct >= 80 ? "text-emerald-500" : pct >= 50 ? "text-amber-500" : "text-rose-500"}`}>
                                    {g.actual} / {target}
                                  </span>
                                </div>
                                <span className={`text-[10px] font-black tabular-nums bg-accent/80 px-2 py-0.5 rounded-full border border-white/5`}>
                                  {pct}%
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden border border-white/5 shadow-inner">
                                <div className={`h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(0,0,0,0.2)] ${goalColor(pct)}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-end pt-4 border-t mt-4">
                      <Button onClick={handleSaveGoals} disabled={saving} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 px-8 h-9 font-bold uppercase tracking-widest text-[10px] group">
                        {saving ? "Saving..." : (
                          <>
                            Save Performance Goals
                            <TrendingUp className="w-3.5 h-3.5 ml-2 group-hover:translate-y-[-1px] transition-transform" />
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Onboarding Tab Section */}
              <TabsContent value="onboarding" className="space-y-4 mt-0">
                <div className="flex items-center justify-between p-1">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground mb-1.5">Completion: {onboardingPct}%</p>
                    <Progress value={onboardingPct} className="h-2" />
                  </div>
                  <Button variant="outline" size="sm" className="ml-6" onClick={handleResetOnboarding}>Reset Checklist</Button>
                </div>
                <div className="grid grid-cols-1 gap-2 mt-2">
                  {onboardingItems.map(item => (
                    <label key={item.key} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors">
                      <Checkbox checked={item.completed} onCheckedChange={(c) => handleToggleOnboarding(item.key, !!c)} />
                      <span className={`flex-1 text-sm ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>{item.label}</span>
                      {item.completedAt && <span className="text-xs text-muted-foreground">{new Date(item.completedAt).toLocaleDateString()}</span>}
                    </label>
                  ))}
                </div>
              </TabsContent>

              {/* Performance Tab Section */}
              <TabsContent value="performance" className="space-y-6 mt-0">
                {perfLoading && (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
                  </div>
                )}
                
                {!perfLoading && performance && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: "Calls Made", value: performance.callsMonthly, icon: PhoneCall, color: "text-blue-500" },
                        { label: "Policies Sold", value: performance.policiesMonthly, icon: ShieldCheck, color: "text-emerald-500" },
                        { label: "Apps Set", value: performance.appsWeekly, icon: Users, color: "text-amber-500" },
                        { label: "Talk Time", value: `${performance.talkTimeMonthlyHours.toFixed(1)}h`, icon: Clock, color: "text-purple-500" },
                        { label: "Conv. Rate", value: performance.conversionRate, icon: Percent, color: "text-rose-500" },
                      ].map(s => {
                        const Icon = s.icon;
                        return (
                          <div key={s.label} className="bg-accent/40 rounded-xl p-3.5 border border-white/5 shadow-sm group hover:bg-accent/60 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                              <Icon className={`w-3.5 h-3.5 ${s.color} opacity-75`} />
                              <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{s.label}</p>
                            </div>
                            <p className="text-xl font-black text-foreground tabular-nums tracking-tight">{s.value}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <Target className="w-4 h-4 text-primary" />
                        <h4 className="text-sm font-bold text-foreground/80 tracking-tight uppercase">Current Goal Progress</h4>
                      </div>
                      <div className="space-y-4 bg-accent/20 rounded-2xl p-5 border border-white/5">
                        {[
                          { label: "Monthly Calls", actual: performance.callsMonthly, target: form.monthlyCallGoal as number },
                          { label: "Monthly Policies", actual: performance.policiesMonthly, target: form.monthlyPoliciesGoal as number },
                          { label: "Weekly Appointments", actual: performance.appsWeekly, target: form.weeklyAppointmentGoal as number },
                        ].map(g => {
                          const pct = g.target ? Math.min(100, Math.round((g.actual / g.target) * 100)) : 0;
                          return (
                            <div key={g.label} className="space-y-1.5">
                              <div className="flex items-center justify-between px-0.5">
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{g.label}</span>
                                <span className="text-[11px] font-black text-foreground tabular-nums">
                                  {g.actual} <span className="text-muted-foreground/50 mx-1">/</span> {g.target}
                                  <span className={`ml-2 ${pct >= 80 ? "text-emerald-500" : pct >= 50 ? "text-amber-500" : "text-rose-500"}`}>({pct}%)</span>
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-muted/50 overflow-hidden border border-white/5">
                                <div className={`h-full rounded-full transition-all duration-1000 ${goalColor(pct)} shadow-[0_0_8px_rgba(0,0,0,0.1)]`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-4">Recent Calls</h4>
                      {!performance.recentCalls || performance.recentCalls.length === 0 ? (
                        <div className="py-8 text-center border rounded-lg bg-accent/10">
                          <p className="text-sm text-muted-foreground">No recent calls recorded.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {performance.recentCalls.map((c: any) => (
                            <div key={c.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-accent/30 border text-sm">
                              <span className="text-foreground font-medium">{c.contactName}</span>
                              <div className="flex items-center gap-4">
                                <Badge variant="outline" className="text-[10px] uppercase font-bold">{c.disposition || "N/A"}</Badge>
                                <span className="text-muted-foreground font-mono text-xs">{Math.floor(c.duration / 60)}:{String(c.duration % 60).padStart(2, "0")}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {!perfLoading && !performance && (
                  <div className="py-12 text-center border rounded-lg bg-accent/10">
                    <p className="text-sm text-muted-foreground">Data failed to load. Please try again.</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>


      {/* Reset Password Confirmation */}
      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Send password reset email to {user.email}? This will send them a link to create a new password.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwOpen(false)}>Cancel</Button>
            <Button onClick={handleResetPassword}>Send Reset Email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete {user.firstName} {user.lastName}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={saving}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ---- MAIN COMPONENT ----
const UserManagement: React.FC = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { profile: currentProfile } = useAuth();
  const { organizationId } = useOrganization();
  const [allUsers, setAllUsers] = useState<UserWithProfile[]>([]);
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
      setAllUsers(data);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  const filteredUsers = useMemo(() => {
    if (!currentProfile) return [];
    
    return allUsers.filter(u => {
      const role = currentProfile.role?.toLowerCase();
      
      // Admin sees everyone (case-insensitive check already handled by .toLowerCase())
      if (role === "admin") return true;
      
      // Team Leader sees themselves and their team
      if (role === "team leader") {
        return u.id === currentProfile.id || u.profile.uplineId === currentProfile.id;
      }
      
      // Agent sees only themselves
      if (role === "agent") {
        return u.id === currentProfile.id;
      }
      
      // Default to showing only themselves if role is unrecognized but they are logged in
      return u.id === currentProfile.id;
    });
  }, [allUsers, currentProfile]);

  const users = filteredUsers; // Use filtered list for display

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDeactivateReactivate = async () => {
    const u = confirmDialog.user;
    if (!u) return;
    const targetId = u.id;
    try {
      if (confirmDialog.action === "deactivate") {
        await usersApi.deactivate(targetId);
        toast({ title: "Deactivated", description: `${u.firstName} ${u.lastName} has been deactivated.` });
        setAllUsers(prev => prev.map(usr => usr.id === targetId ? { ...usr, status: "Inactive" as any } : usr));
      } else {
        await usersApi.reactivate(targetId);
        toast({ title: "Reactivated", description: `${u.firstName} ${u.lastName} has been reactivated.` });
        setAllUsers(prev => prev.map(usr => usr.id === targetId ? { ...usr, status: "Active" as any } : usr));
      }
      setConfirmDialog({ open: false, user: null, action: "deactivate" });
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResendInvite = async (u: UserWithProfile) => {
    try {
      await usersApi.resendInvite(u.email);
      toast({ title: "Invite resent", description: `Invitation resent to ${u.email}` });
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCopyInviteLink = async (u: UserWithProfile) => {
    try {
      const link = await usersApi.generateInviteLink({ firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role }, organizationId);
      await navigator.clipboard.writeText(link);
      toast({ title: "Invite link copied", description: "Invite link copied to clipboard." });
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
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
          <Input placeholder="Search by name or email..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
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
                <th className="text-left py-3 font-medium">Manager</th>
                <th className="text-left py-3 font-medium">Status</th>
                <th className="text-left py-3 font-medium">Availability</th>
                <th className="text-right py-3 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr
                  key={u.id}
                  className="border-b last:border-0 hover:bg-accent/30 transition-colors cursor-pointer"
                  onClick={() => { setSelectedUser(u); setProfileOpen(true); }}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center overflow-hidden">
                        {u.avatar ? (
                          <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          `${u.firstName[0]}${u.lastName[0]}`
                        )}
                      </div>
                      <span className="font-medium text-foreground">{u.firstName} {u.lastName}</span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{u.email}</td>
                  <td className="py-3"><Badge className={ROLE_BADGE[u.role]}>{u.role}</Badge></td>
                  <td className="py-3 text-muted-foreground text-xs">
                    {u.profile.uplineId ? (
                      allUsers.find(manager => manager.id === u.profile.uplineId) 
                        ? `${allUsers.find(manager => manager.id === u.profile.uplineId)?.firstName} ${allUsers.find(manager => manager.id === u.profile.uplineId)?.lastName}`
                        : "Unknown"
                    ) : "-"}
                  </td>
                  <td className="py-3"><Badge className={STATUS_BADGE[u.status]}>{u.status}</Badge></td>
                  <td className="py-3"><span className={`w-2.5 h-2.5 rounded-full inline-block ${AVAIL_COLORS[u.availabilityStatus]}`} title={u.availabilityStatus} /></td>
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
                        {u.status === "Inactive" && (
                          <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, user: u, action: "reactivate" })}>
                            <RefreshCw className="w-4 h-4 mr-2" /> Reactivate
                          </DropdownMenuItem>
                        )}
                        {u.status === "Pending" && (
                          <>
                            <DropdownMenuItem onClick={() => handleResendInvite(u)}>
                              <Mail className="w-4 h-4 mr-2" /> Resend Invite
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyInviteLink(u)}>
                              <Copy className="w-4 h-4 mr-2" /> Copy Link
                            </DropdownMenuItem>
                          </>
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
      <InviteModal 
        open={inviteOpen} 
        onClose={() => setInviteOpen(false)} 
        onSuccess={fetchUsers} 
        managers={allUsers.filter(u => u.role === "Admin" || u.role === "Team Leader")}
      />

      {/* Profile Modal */}
      <UserProfileModal
        user={selectedUser}
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setSelectedUser(null); }}
        onSaved={(patch) => { if (patch?.id) setAllUsers(prev => prev.map(u => u.id === patch.id! ? { ...u, ...patch } : u)); }}
        onDeleted={(id) => {
          setAllUsers(prev => prev.filter(u => u.id !== id));
          setProfileOpen(false);
          setSelectedUser(null);
        }}
        currentUserId={currentUser?.id || ""}
        allUsers={users}
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
