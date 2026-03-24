import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const COMMISSION_LEVELS = ["Street", "105%", "110%", "115%", "120%", "125%"];

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export default function ProfileSetupModal({ open, onClose, onComplete }: Props) {
  const { profile, updateProfile } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [residentState, setResidentState] = useState("");
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  const [commissionLevel, setCommissionLevel] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Populate fields from profile when modal opens
  useEffect(() => {
    if (open && profile) {
      setFirstName(profile.first_name ?? "");
      setLastName(profile.last_name ?? "");
      setPhone(profile.phone ?? "");
      setResidentState(profile.resident_state ?? "");
      setLicensedStates(profile.licensed_states ?? []);
      setCommissionLevel(profile.commission_level ?? "");
      setErrors({});
    }
  }, [open, profile]);

  const validate = (): Record<string, string> => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = "First name is required";
    if (!lastName.trim()) newErrors.lastName = "Last name is required";
    if (!phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) newErrors.phone = "Phone must have at least 10 digits";
    }
    if (!residentState) newErrors.residentState = "Resident state is required";
    return newErrors;
  };

  const handleSave = async () => {
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setIsSaving(true);
    try {
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        resident_state: residentState,
        licensed_states: licensedStates,
        ...(commissionLevel ? { commission_level: commissionLevel } : {}),
      });
      toast.success("Profile saved! Welcome to AgentFlow.", { duration: 3000 });
      onComplete();
    } catch {
      toast.error("Failed to save profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const allSelected = licensedStates.length === US_STATES.length;

  const toggleSelectAll = () => {
    setLicensedStates(allSelected ? [] : [...US_STATES]);
  };

  const toggleState = (state: string) => {
    setLicensedStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state]
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            Step 1 of 1 — Profile Setup
          </p>
          <DialogTitle className="text-2xl font-bold">
            Welcome to AgentFlow 👋
          </DialogTitle>
          <DialogDescription>
            Let's get your profile set up. This only takes a minute.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* First Name */}
          <div className="space-y-1">
            <Label htmlFor="psm-firstName">First Name</Label>
            <Input
              id="psm-firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
            />
            {errors.firstName && (
              <p className="text-sm text-destructive">{errors.firstName}</p>
            )}
          </div>

          {/* Last Name */}
          <div className="space-y-1">
            <Label htmlFor="psm-lastName">Last Name</Label>
            <Input
              id="psm-lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
            {errors.lastName && (
              <p className="text-sm text-destructive">{errors.lastName}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1">
            <Label htmlFor="psm-phone">Phone Number</Label>
            <Input
              id="psm-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
            />
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone}</p>
            )}
          </div>

          {/* Resident State */}
          <div className="space-y-1">
            <Label>Resident State</Label>
            <Select value={residentState} onValueChange={setResidentState}>
              <SelectTrigger>
                <SelectValue placeholder="Select your resident state" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.residentState && (
              <p className="text-sm text-destructive">{errors.residentState}</p>
            )}
          </div>

          {/* Licensed States */}
          <div className="space-y-1">
            <Label>
              Licensed States{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <div className="border border-border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Checkbox
                  id="psm-select-all"
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                />
                <label
                  htmlFor="psm-select-all"
                  className="text-sm font-medium cursor-pointer select-none"
                >
                  Select All
                </label>
              </div>
              {US_STATES.map((state) => (
                <div key={state} className="flex items-center gap-2">
                  <Checkbox
                    id={`psm-state-${state}`}
                    checked={licensedStates.includes(state)}
                    onCheckedChange={() => toggleState(state)}
                  />
                  <label
                    htmlFor={`psm-state-${state}`}
                    className="text-sm cursor-pointer select-none"
                  >
                    {state}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Commission Level */}
          <div className="space-y-1">
            <Label>
              Commission Level{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Select value={commissionLevel} onValueChange={setCommissionLevel}>
              <SelectTrigger>
                <SelectValue placeholder="Select commission level" />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Skip for now
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
