import React, { useState, useRef, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Eye, EyeOff, Lock, Loader2, Upload, User, Globe, Shield, Trash2, Plus,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { Badge } from "@/components/ui/badge";

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

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const CARRIERS = [
  "Aetna",
  "Ambetter",
  "Blue Cross Blue Shield",
  "Cigna",
  "Humana",
  "Molina Healthcare",
  "Mutual of Omaha",
  "UnitedHealthcare",
  "Wellcare",
];

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
  const { registerDirty } = useUnsavedChanges();

  // Profile Info
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [email] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [availability, setAvailability] = useState(profile?.availability_status ?? "Available");
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? "");
  const [npn, setNpn] = useState(profile?.npn ?? "");
  const [stateToAdd, setStateToAdd] = useState("");
  const [licensedStates, setLicensedStates] = useState<Array<{ state: string; licenseNumber: string }>>(profile?.licensed_states || []);
  const [carrierToAdd, setCarrierToAdd] = useState("");
  const [selectedCarriers, setSelectedCarriers] = useState<Array<{ carrier: string; writingNumber: string }>>(profile?.carriers || []);
  const [residentState, setResidentState] = useState(profile?.resident_state ?? "");
  const [commissionLevel, setCommissionLevel] = useState(profile?.commission_level ?? "0%");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<{ firstName?: string; lastName?: string }>({});

  // Track saved profile values for dirty detection
  const [savedProfile, setSavedProfile] = useState({
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    phone: profile?.phone ?? "",
    availability: profile?.availability_status ?? "Available",
    npn: profile?.npn ?? "",
    residentState: profile?.resident_state ?? "",
    licensedStates: JSON.stringify(profile?.licensed_states || []),
    selectedCarriers: JSON.stringify(profile?.carriers || []),
  });

  const isProfileDirty = useMemo(() => (
    firstName !== savedProfile.firstName ||
    lastName !== savedProfile.lastName ||
    phone !== savedProfile.phone ||
    availability !== savedProfile.availability ||
    npn !== savedProfile.npn ||
    residentState !== savedProfile.residentState ||
    JSON.stringify(licensedStates) !== savedProfile.licensedStates ||
    JSON.stringify(selectedCarriers) !== savedProfile.selectedCarriers
  ), [firstName, lastName, phone, availability, npn, residentState, licensedStates, selectedCarriers, savedProfile]);

  useEffect(() => {
    registerDirty("my-profile", isProfileDirty);
    return () => registerDirty("my-profile", false);
  }, [isProfileDirty, registerDirty]);

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
  const [dailyCalls, setDailyCalls] = useState(profile?.monthly_call_goal ?? 50);
  const [monthlyPolicies, setMonthlyPolicies] = useState(profile?.monthly_policies_goal ?? 10);
  const [weeklyAppts, setWeeklyAppts] = useState(profile?.weekly_appointment_goal ?? 15);
  const [monthlyTalkTime, setMonthlyTalkTime] = useState(profile?.monthly_talk_time_goal_hours ?? 40);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalErrors, setGoalErrors] = useState<Record<string, string>>({});

  // Sync dark mode with theme
  const isDark = theme === "dark";

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setPhone(profile.phone || "");
      setAvailability(profile.availability_status || "Available");
      setAvatar(profile.avatar_url || "");
      setLicensedStates(profile.licensed_states || []);
      setSelectedCarriers(profile.carriers || []);
      setDailyCalls(profile.monthly_call_goal || 0);
      setMonthlyPolicies(profile.monthly_policies_goal || 0);
      setWeeklyAppts(profile.weekly_appointment_goal || 0);
      setMonthlyTalkTime(profile.monthly_talk_time_goal_hours || 0);
      setResidentState(profile.resident_state || "");
      setCommissionLevel(profile.commission_level || "0%");
      setNpn(profile.npn || "");
      setWinSound(profile.win_sound_enabled ?? true);
      setEmailNotifs(profile.email_notifications_enabled ?? true);
      setSmsNotifs(profile.sms_notifications_enabled ?? false);
      setPushNotifs(profile.push_notifications_enabled ?? true);
      setTimezone(profile.timezone || "Eastern Time (US & Canada)");
      setSavedProfile({
        firstName: profile.first_name || "",
        lastName: profile.last_name || "",
        phone: profile.phone || "",
        availability: profile.availability_status || "Available",
        npn: profile.npn || "",
        residentState: profile.resident_state || "",
        licensedStates: JSON.stringify(profile.licensed_states || []),
        selectedCarriers: JSON.stringify(profile.carriers || []),
      });
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
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone,
        availability_status: availability,
        licensed_states: licensedStates,
        carriers: selectedCarriers,
        resident_state: residentState,
        npn: npn.trim()
      });
      setSavedProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        availability,
        npn: npn.trim(),
        residentState,
        licensedStates: JSON.stringify(licensedStates),
        selectedCarriers: JSON.stringify(selectedCarriers),
      });
      toast({ title: "Profile updated successfully.", className: "bg-success text-success-foreground" });
    } catch (err: any) {
      toast({ title: "Failed to update profile", description: err.message, variant: "destructive" });
    }
    setProfileSaving(false);
  };

  const addLicensedState = () => {
    if (!stateToAdd || licensedStates.some((item) => item.state === stateToAdd)) return;
    setLicensedStates((prev) => [...prev, { state: stateToAdd, licenseNumber: "" }]);
    setStateToAdd("");
  };

  const updateStateLicenseNumber = (state: string, licenseNumber: string) => {
    setLicensedStates((prev) => prev.map((item) => (item.state === state ? { ...item, licenseNumber } : item)));
  };

  const removeLicensedState = (state: string) => {
    setLicensedStates((prev) => prev.filter((item) => item.state !== state));
  };

  const addCarrier = () => {
    if (!carrierToAdd || selectedCarriers.some((item) => item.carrier === carrierToAdd)) return;
    setSelectedCarriers((prev) => [...prev, { carrier: carrierToAdd, writingNumber: "" }]);
    setCarrierToAdd("");
  };

  const updateCarrierWritingNumber = (carrier: string, writingNumber: string) => {
    setSelectedCarriers((prev) => prev.map((item) => (item.carrier === carrier ? { ...item, writingNumber } : item)));
  };

  const removeCarrier = (carrier: string) => {
    setSelectedCarriers((prev) => prev.filter((item) => item.carrier !== carrier));
  };

  // Password save
  const handleUpdatePassword = async () => {
    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast({ title: "Password updated successfully.", className: "bg-success text-success-foreground" });
    } catch (err: any) {
      toast({ title: "Failed to update password", description: err.message, variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  };

  // Preferences save
  const handleSavePreferences = async () => {
    setPrefSaving(true);
    try {
      await updateProfile({ 
        theme_preference: isDark ? "dark" : "light",
        win_sound_enabled: winSound,
        email_notifications_enabled: emailNotifs,
        sms_notifications_enabled: smsNotifs,
        push_notifications_enabled: pushNotifs,
        timezone: timezone
      });
      toast({ title: "Preferences saved.", className: "bg-success text-success-foreground" });
    } catch (err: any) {
      toast({ title: "Failed to save preferences", description: err.message, variant: "destructive" });
    }
    setPrefSaving(false);
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
    try {
      await updateProfile({ 
        monthly_call_goal: dailyCalls,
        monthly_policies_goal: monthlyPolicies,
        weekly_appointment_goal: weeklyAppts,
        monthly_talk_time_goal_hours: monthlyTalkTime
      });
      toast({ title: "Goals updated.", className: "bg-success text-success-foreground" });
    } catch (err: any) {
      toast({ title: "Failed to save goals", description: err.message, variant: "destructive" });
    }
    setGoalSaving(false);
  };

  const pwStrength = getPasswordStrength(newPw);
  const pwAllFilled = currentPw.length > 0 && newPw.length > 0 && confirmPw.length > 0;
  const pwMismatch = confirmPw.length > 0 && confirmPw !== newPw;
  const showGoals = user.role === "Agent" || user.role === "Team Leader";

  return (
    <div className="space-y-6">
      {/* CARD 1 — Profile Info */}
      <Card className="bg-card border-border rounded-xl mb-6">
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
              <label className="text-sm font-medium text-foreground block mb-1.5">Resident State</label>
              <select
                value={residentState}
                onChange={(e) => setResidentState(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select a state</option>
                {US_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5 flex items-center gap-1.5">
                Commission Level
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Contact your admin to change your commission level</TooltipContent>
                </Tooltip>
              </label>
              <Input value={commissionLevel} readOnly className="bg-muted cursor-not-allowed" />
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
              <label className="text-sm font-medium text-foreground block mb-1.5">NPN (National Producer Number)</label>
              <Input value={npn} onChange={(e) => setNpn(e.target.value)} placeholder="Enter NPN" />
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
                onChange={(e) => setAvailability(e.target.value as any)} // eslint-disable-line @typescript-eslint/no-explicit-any
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {availabilityOptions.map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>
            </div>

          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={handleSaveProfile} disabled={profileSaving} className="px-6 rounded-lg transition-all hover:scale-[1.02]">
              {profileSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</> : "Save Profile Information"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CARD 1.1 — Licensed States */}
      <Card className="bg-card border-border rounded-xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Licensed States</CardTitle>
              <p className="text-xs text-muted-foreground">Manage the states where you are licensed to sell</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row gap-3 items-end bg-accent/30 p-4 rounded-xl border border-border/50">
            <div className="flex-1 w-full space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">Add New State</label>
              <select
                value={stateToAdd}
                onChange={(e) => setStateToAdd(e.target.value)}
                className="w-full h-11 px-4 rounded-lg border border-input bg-background/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
              >
                <option value="">Select a state</option>
                {US_STATES.filter((state) => !licensedStates.some((item) => item.state === state)).map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <Button 
              type="button" 
              onClick={addLicensedState} 
              disabled={!stateToAdd}
              className="h-11 px-6 rounded-lg font-medium transition-all hover:shadow-lg active:scale-95"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add State
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {licensedStates.map(({ state, licenseNumber }) => (
              <div key={state} className="group relative p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all duration-300">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="secondary" className="font-semibold px-2.5 py-0.5 rounded-md bg-primary/5 text-primary border-primary/10">
                    {state}
                  </Badge>
                  <button 
                    type="button" 
                    onClick={() => removeLicensedState(state)} 
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove State"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">License Number</label>
                  <Input
                    value={licenseNumber}
                    onChange={(e) => updateStateLicenseNumber(state, e.target.value)}
                    placeholder="Enter license #"
                    className="h-9 text-sm bg-accent/50 border-0 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
                  />
                </div>
              </div>
            ))}
            {licensedStates.length === 0 && (
              <div className="md:col-span-2 lg:col-span-3 py-12 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl bg-accent/5">
                <Globe className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No states added yet</p>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-border/50">
            <Button onClick={handleSaveProfile} disabled={profileSaving} variant="outline" className="px-6 rounded-lg transition-all hover:bg-primary/5">
              {profileSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</> : "Update Licenses"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CARD 1.2 — Carriers */}
      <Card className="bg-card border-border rounded-xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Insurance Carriers</CardTitle>
              <p className="text-xs text-muted-foreground">Configure your writing numbers for each carrier</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row gap-3 items-end bg-accent/30 p-4 rounded-xl border border-border/50">
            <div className="flex-1 w-full space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1">Select Carrier</label>
              <select
                value={carrierToAdd}
                onChange={(e) => setCarrierToAdd(e.target.value)}
                className="w-full h-11 px-4 rounded-lg border border-input bg-background/50 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
              >
                <option value="">Select a carrier</option>
                {CARRIERS.filter((carrier) => !selectedCarriers.some((item) => item.carrier === carrier)).map((carrier) => (
                  <option key={carrier} value={carrier}>{carrier}</option>
                ))}
              </select>
            </div>
            <Button 
              type="button" 
              onClick={addCarrier} 
              disabled={!carrierToAdd}
              className="h-11 px-6 rounded-lg font-medium transition-all hover:shadow-lg active:scale-95"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add Carrier
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedCarriers.map(({ carrier, writingNumber }) => (
              <div key={carrier} className="group relative p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all duration-300">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="outline" className="font-semibold px-2.5 py-0.5 rounded-md border-primary/20 text-primary bg-primary/5">
                    {carrier}
                  </Badge>
                  <button 
                    type="button" 
                    onClick={() => removeCarrier(carrier)} 
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove Carrier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Writing Number</label>
                  <Input
                    value={writingNumber}
                    onChange={(e) => updateCarrierWritingNumber(carrier, e.target.value)}
                    placeholder="Enter writing #"
                    className="h-9 text-sm bg-accent/50 border-0 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
                  />
                </div>
              </div>
            ))}
            {selectedCarriers.length === 0 && (
              <div className="md:col-span-2 lg:col-span-3 py-12 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl bg-accent/5">
                <Shield className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No carriers configured</p>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-border/50">
            <Button onClick={handleSaveProfile} disabled={profileSaving} variant="outline" className="px-6 rounded-lg transition-all hover:bg-primary/5">
              {profileSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</> : "Update Carriers"}
            </Button>
          </div>
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
