import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { Loader2, User, Lock } from "lucide-react";
import { CommissionGate } from "@/components/PermissionGate";
import { ProfileAvatarUploader } from "./ProfileAvatarUploader";
import { z } from "zod";

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const availabilityOptions = [
  { label: "Available" },
  { label: "On Break" },
  { label: "Do Not Disturb" },
  { label: "Offline" },
] as const;

const profileInfoSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50, "First name is too long"),
  lastName: z.string().trim().min(1, "Last name is required").max(50, "Last name is too long"),
  phone: z.string().optional(),
  availability: z.string(),
  residentState: z.string().optional(),
  npn: z.string().trim().optional(),
});

type ProfileInfoErrors = {
  firstName?: string;
  lastName?: string;
};

export const ProfileInfoCard: React.FC = () => {
  const { user, profile, updateProfile } = useAuth();
  const { registerDirty } = useUnsavedChanges();

  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [availability, setAvailability] = useState(profile?.availability_status ?? "Available");
  const [residentState, setResidentState] = useState(profile?.resident_state ?? "");
  const [npn, setNpn] = useState(profile?.npn ?? "");

  const [profileSaving, setProfileSaving] = useState(false);
  const [errors, setErrors] = useState<ProfileInfoErrors>({});

  const [saved, setSaved] = useState({
    firstName: profile?.first_name ?? "",
    lastName: profile?.last_name ?? "",
    phone: profile?.phone ?? "",
    availability: profile?.availability_status ?? "Available",
    residentState: profile?.resident_state ?? "",
    npn: profile?.npn ?? "",
  });

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setPhone(profile.phone || "");
      setAvailability(profile.availability_status || "Available");
      setResidentState(profile.resident_state || "");
      setNpn(profile.npn || "");
      setSaved({
        firstName: profile.first_name || "",
        lastName: profile.last_name || "",
        phone: profile.phone || "",
        availability: profile.availability_status || "Available",
        residentState: profile.resident_state || "",
        npn: profile.npn || "",
      });
    }
  }, [profile]);

  const isDirty = useMemo(() => {
    return (
      firstName !== saved.firstName ||
      lastName !== saved.lastName ||
      phone !== saved.phone ||
      availability !== saved.availability ||
      residentState !== saved.residentState ||
      npn !== saved.npn
    );
  }, [firstName, lastName, phone, availability, residentState, npn, saved]);

  useEffect(() => {
    registerDirty("profile-info", isDirty);
    return () => registerDirty("profile-info", false);
  }, [isDirty, registerDirty]);

  const handleSaveProfile = async () => {
    const result = profileInfoSchema.safeParse({
      firstName,
      lastName,
      phone,
      availability,
      residentState,
      npn,
    });

    if (!result.success) {
      const fieldErrors: ProfileInfoErrors = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === "firstName") fieldErrors.firstName = err.message;
        if (err.path[0] === "lastName") fieldErrors.lastName = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setProfileSaving(true);
    try {
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone,
        availability_status: availability,
        resident_state: residentState,
        npn: npn.trim(),
      });
      setSaved({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        availability,
        residentState,
        npn: npn.trim(),
      });
      toast({
        title: "Profile updated successfully.",
        className: "bg-success text-success-foreground",
      });
    } catch (err: any) {
      toast({
        title: "Failed to update profile",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveAvatar = async (base64Data: string) => {
    await updateProfile({ avatar_url: base64Data });
  };

  if (!user) return null;

  const initials = `${(profile?.first_name || "?")[0]}${(profile?.last_name || "?")[0]}`;

  return (
    <Card className="bg-card border-border rounded-xl mb-6">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Profile Information</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Your name, contact details, and availability</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <ProfileAvatarUploader
          avatarUrl={profile?.avatar_url ?? ""}
          onSave={handleSaveAvatar}
          initials={initials}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">First Name *</label>
            <Input
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value.slice(0, 50));
                setErrors((p) => ({ ...p, firstName: undefined }));
              }}
            />
            {errors.firstName && <p className="text-xs text-destructive mt-1">{errors.firstName}</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Last Name *</label>
            <Input
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value.slice(0, 50));
                setErrors((p) => ({ ...p, lastName: undefined }));
              }}
            />
            {errors.lastName && <p className="text-xs text-destructive mt-1">{errors.lastName}</p>}
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
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <CommissionGate metric="View Own Commission Percentage">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5 flex items-center gap-1.5">
                Commission Level
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Contact your admin to change your commission level</TooltipContent>
                </Tooltip>
              </label>
              <Input value={profile?.commission_level ?? "0%"} readOnly className="bg-muted cursor-not-allowed" />
            </div>
          </CommissionGate>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5 flex items-center gap-1.5">
              Email Address
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>Contact your admin to change your email</TooltipContent>
              </Tooltip>
            </label>
            <Input value={user?.email ?? ""} readOnly className="bg-muted cursor-not-allowed" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Phone Number</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">
              NPN (National Producer Number)
            </label>
            <Input value={npn} onChange={(e) => setNpn(e.target.value)} placeholder="Enter NPN" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Role</label>
            <div className="h-10 flex items-center">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                {profile?.role || "Agent"}
              </span>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Availability Status</label>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {availabilityOptions.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-start pt-4 border-t border-border/50">
          <Button onClick={handleSaveProfile} disabled={profileSaving || !isDirty} className="px-6 rounded-lg">
            {profileSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...
              </>
            ) : (
              "Save Profile Information"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
