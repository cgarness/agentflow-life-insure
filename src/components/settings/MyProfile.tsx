import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Eye, EyeOff, Lock, Loader2, Upload, User,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const US_TIMEZONES = [
  "Eastern Time (US & Canada)",
  "Central Time (US & Canada)",
  "Mountain Time (US & Canada)",
  "Pacific Time (US & Canada)",
  "Alaska Time",
  "Hawaii Time",
];

const availabilityOptions = [
  { label: "Available", dotClass: "bg-success" },
  { label: "On Break", dotClass: "bg-warning" },
  { label: "Do Not Disturb", dotClass: "bg-destructive" },
  { label: "Offline", dotClass: "bg-muted-foreground/50" },
] as const;

function getPasswordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[!@#$%^&*]/.test(pw)) score++;
  const levels = [
    { label: "Weak", width: "25%", color: "bg-destructive", textColor: "text-destructive" },
    { label: "Fair", width: "50%", color: "bg-orange-500", textColor: "text-orange-500" },
    { label: "Strong", width: "75%", color: "bg-yellow-500", textColor: "text-yellow-500" },
    { label: "Very Strong", width: "100%", color: "bg-success", textColor: "text-success" },
  ];
  return score === 0 ? null : levels[score - 1];
}

const MyProfile: React.FC = () => {
  const { user, profile, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();

  // Profile Info
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [email] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [availability, setAvailability] = useState(profile?.availability_status ?? "Available");
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<{ firstName?: string; lastName?: string }>({});

  // Avatar crop modal
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropPreview, setCropPreview] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  // Preferences
  const [winSound, setWinSound] = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [smsNotifs, setSmsNotifs] = useState(false);
  const [pushNotifs, setPushNotifs] = useState(true);
  const [timezone, setTimezone] = useState("Eastern Time (US & Canada)");
  const [prefSaving, setPrefSaving] = useState(false);

  // Goals
  const [dailyCalls, setDailyCalls] = useState(50);
  const [monthlyPolicies, setMonthlyPolicies] = useState(10);
  const [weeklyAppts, setWeeklyAppts] = useState(15);
  const [monthlyTalkTime, setMonthlyTalkTime] = useState(40 * 60);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalErrors, setGoalErrors] = useState<Record<string, string>>({});

  // Sync dark mode with theme
  const isDark = theme === "dark";

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name);
      setLastName(profile.last_name);
      setPhone(profile.phone ?? "");
      setAvailability(profile.availability_status);
      setAvatar(profile.avatar_url ?? "");
    }
  }, [profile]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <User className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">No profile found</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }

  const initials = `${(profile?.first_name || "?")[0]}${(profile?.last_name || "?")[0]}`;

  // Avatar upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload a JPG, PNG, or WebP image.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropPreview(reader.result as string);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSaveAvatar = () => {
    setAvatar(cropPreview);
    updateProfile({ avatar_url: cropPreview });
    setCropModalOpen(false);
    toast({ title: "Profile photo updated.", className: "bg-success text-success-foreground" });
  };

  // Profile save
  const handleSaveProfile = async () => {
    const errors: typeof profileErrors = {};
    if (!firstName.trim()) errors.firstName = "First name is required";
    if (!lastName.trim()) errors.lastName = "Last name is required";
    setProfileErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setProfileSaving(true);
    try {
      await updateProfile({ first_name: firstName.trim(), last_name: lastName.trim(), phone, availability_status: availability });
      toast({ title: "Profile updated successfully.", className: "bg-success text-success-foreground" });
    } catch (err: any) {
      toast({ title: "Failed to update profile", description: err.message, variant: "destructive" });
    }
    setProfileSaving(false);
  };

  // Password save
  const handleUpdatePassword = async () => {
    setPwSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    if (currentPw !== "password") {
      setPwSaving(false);
      toast({ title: "Current password is incorrect.", variant: "destructive" });
      return;
    }
    setPwSaving(false);
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    toast({ title: "Password updated successfully.", className: "bg-success text-success-foreground" });
  };

  // Preferences save
  const handleSavePreferences = async () => {
    setPrefSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    setPrefSaving(false);
    toast({ title: "Preferences saved.", className: "bg-success text-success-foreground" });
  };

  // Goals save
  const handleSaveGoals = async () => {
    const errors: Record<string, string> = {};
    if (dailyCalls < 0) errors.dailyCalls = "Must be 0 or greater";
    if (monthlyPolicies < 0) errors.monthlyPolicies = "Must be 0 or greater";
    if (weeklyAppts < 0) errors.weeklyAppts = "Must be 0 or greater";
    if (monthlyTalkTime < 0) errors.monthlyTalkTime = "Must be 0 or greater";
    setGoalErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setGoalSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    setGoalSaving(false);
    toast({ title: "Goals updated.", className: "bg-success text-success-foreground" });
  };

  const pwStrength = getPasswordStrength(newPw);
  const pwAllFilled = currentPw.length > 0 && newPw.length > 0 && confirmPw.length > 0;
  const pwMismatch = confirmPw.length > 0 && confirmPw !== newPw;
  const showGoals = user.role === "Agent" || user.role === "Team Leader";

  return (
    <div className="space-y-2">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">My Profile</h2>
        <p className="text-sm text-muted-foreground">Manage your personal account settings</p>
      </div>

      {/* CARD 1 — Profile Info */}
      <Card className="bg-card border-border rounded-lg mb-6">
        <CardHeader><CardTitle className="text-base">Profile Information</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-primary flex items-center justify-center text-primary-foreground text-2xl font-bold shrink-0">
              {avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : initials}
            </div>
            <div>
              <Button variant="outline" size="sm" className="rounded-md" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-1.5" /> Upload Photo
              </Button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelect} />
            </div>
          </div>

          {/* Form */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">First Name *</label>
              <Input value={firstName} onChange={(e) => { setFirstName(e.target.value.slice(0, 50)); setProfileErrors((p) => ({ ...p, firstName: undefined })); }} />
              {profileErrors.firstName && <p className="text-xs text-destructive mt-1">{profileErrors.firstName}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Last Name *</label>
              <Input value={lastName} onChange={(e) => { setLastName(e.target.value.slice(0, 50)); setProfileErrors((p) => ({ ...p, lastName: undefined })); }} />
              {profileErrors.lastName && <p className="text-xs text-destructive mt-1">{profileErrors.lastName}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5 flex items-center gap-1.5">
                Email Address
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Contact your admin to change your email</TooltipContent>
                </Tooltip>
              </label>
              <Input value={email} readOnly className="bg-muted cursor-not-allowed" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Phone Number</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Role</label>
              <div className="h-10 flex items-center">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">{user.role}</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Availability Status</label>
              <select
                value={availability}
                onChange={(e) => setAvailability(e.target.value as any)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {availabilityOptions.map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <Button onClick={handleSaveProfile} disabled={profileSaving} className="px-6">
            {profileSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</> : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* CARD 2 — Change Password */}
      <Card className="bg-card border-border rounded-lg mb-6">
        <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <PasswordField label="Current Password" value={currentPw} onChange={setCurrentPw} show={showCurrentPw} onToggle={() => setShowCurrentPw(!showCurrentPw)} />
          <div>
            <PasswordField label="New Password" value={newPw} onChange={setNewPw} show={showNewPw} onToggle={() => setShowNewPw(!showNewPw)} />
            {newPw && pwStrength && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${pwStrength.color} transition-all duration-300`} style={{ width: pwStrength.width }} />
                  </div>
                  <span className={`text-xs font-medium ${pwStrength.textColor} whitespace-nowrap`}>{pwStrength.label}</span>
                </div>
              </div>
            )}
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              <li>At least 8 characters</li>
              <li>One uppercase letter</li>
              <li>One number</li>
              <li>One special character (!@#$%^&*)</li>
            </ul>
          </div>
          <div>
            <PasswordField label="Confirm New Password" value={confirmPw} onChange={setConfirmPw} show={showConfirmPw} onToggle={() => setShowConfirmPw(!showConfirmPw)} />
            {pwMismatch && <p className="text-xs text-destructive mt-1">Passwords do not match</p>}
          </div>
          <Button onClick={handleUpdatePassword} disabled={!pwAllFilled || pwMismatch || pwSaving} className="px-6">
            {pwSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Updating...</> : "Update Password"}
          </Button>
        </CardContent>
      </Card>

      {/* CARD 3 — Preferences */}
      <Card className="bg-card border-border rounded-lg mb-6">
        <CardHeader><CardTitle className="text-base">Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Dark Mode</p>
              <p className="text-xs text-muted-foreground">Toggle between dark and light interface</p>
            </div>
            <Switch checked={isDark} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Win Sound</p>
              <p className="text-xs text-muted-foreground">Play a celebration sound when a policy is sold</p>
            </div>
            <Switch checked={winSound} onCheckedChange={setWinSound} />
          </div>
          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold text-foreground mb-3">Notifications</p>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Email Notifications</p>
                  <p className="text-xs text-muted-foreground">Receive updates and alerts via email</p>
                </div>
                <Switch checked={emailNotifs} onCheckedChange={setEmailNotifs} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">SMS Notifications</p>
                  <p className="text-xs text-muted-foreground">Get text message alerts for important events</p>
                </div>
                <Switch checked={smsNotifs} onCheckedChange={setSmsNotifs} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Desktop Push Notifications</p>
                  <p className="text-xs text-muted-foreground">Show browser notifications for real-time updates</p>
                </div>
                <Switch checked={pushNotifs} onCheckedChange={setPushNotifs} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Timezone</p>
            </div>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {US_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          <Button onClick={handleSavePreferences} disabled={prefSaving} className="px-6">
            {prefSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</> : "Save Preferences"}
          </Button>
        </CardContent>
      </Card>

      {/* CARD 4 — Agent Goals */}
      {showGoals && (
        <Card className="bg-card border-border rounded-lg mb-6">
          <CardHeader><CardTitle className="text-base">My Goals</CardTitle></CardHeader>
          <CardContent className="space-y-4 max-w-md">
            <GoalField label="Daily Calls Goal" unit="calls per day" value={dailyCalls} onChange={setDailyCalls} error={goalErrors.dailyCalls} />
            <GoalField label="Monthly Policies Goal" unit="policies per month" value={monthlyPolicies} onChange={setMonthlyPolicies} error={goalErrors.monthlyPolicies} />
            <GoalField label="Weekly Appointments Goal" unit="appointments per week" value={weeklyAppts} onChange={setWeeklyAppts} error={goalErrors.weeklyAppts} />
            <GoalField label="Monthly Talk Time Goal" unit="minutes per month" value={monthlyTalkTime} onChange={setMonthlyTalkTime} error={goalErrors.monthlyTalkTime} />
            <Button onClick={handleSaveGoals} disabled={goalSaving} className="px-6">
              {goalSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</> : "Save Goals"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Crop Modal */}
      {cropModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm shadow-lg">
            <h3 className="text-sm font-semibold text-foreground mb-4">Crop Photo</h3>
            <div className="w-48 h-48 rounded-full overflow-hidden mx-auto border-2 border-border mb-4">
              <img src={cropPreview} alt="Crop preview" className="w-full h-full object-cover" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCropModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveAvatar}>Save Photo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Sub-components
function PasswordField({ label, value, onChange, show, onToggle }: { label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground block mb-1.5">{label}</label>
      <div className="relative">
        <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function GoalField({ label, unit, value, onChange, error }: { label: string; unit: string; value: number; onChange: (v: number) => void; error?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <Input type="number" min={0} step={1} value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)} className="mt-1" />
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

export default MyProfile;
