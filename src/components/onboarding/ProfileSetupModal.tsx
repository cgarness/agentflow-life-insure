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
import { PhoneInput } from "@/components/shared/PhoneInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
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
import { cn } from "@/lib/utils";

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
      <DialogContent className="sm:max-w-[480px] w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl bg-card rounded-xl">
        <DialogHeader className="p-5 border-b border-primary/10 bg-primary/[0.03]">
          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1.5 opacity-70">
            Step 1 of 1 — Profile Setup
          </p>
          <DialogTitle className="text-xl font-bold tracking-tight text-primary flex items-center gap-2">
            Welcome to AgentFlow 👋
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-[11px] mt-1">
            Let's get your profile set up. This only takes a minute.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/20">
          <div className="grid grid-cols-2 gap-4">
            {/* First Name */}
            <div className="space-y-1.5">
              <Label htmlFor="psm-firstName" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">First Name</Label>
              <Input
                id="psm-firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className={cn("h-9 text-xs shadow-sm bg-muted/20 border-border", errors.firstName && "border-destructive ring-destructive/20")}
              />
              {errors.firstName && (
                <p className="text-[10px] font-bold text-destructive">{errors.firstName}</p>
              )}
            </div>

            {/* Last Name */}
            <div className="space-y-1.5">
              <Label htmlFor="psm-lastName" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Last Name</Label>
              <Input
                id="psm-lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className={cn("h-9 text-xs shadow-sm bg-muted/20 border-border", errors.lastName && "border-destructive ring-destructive/20")}
              />
              {errors.lastName && (
                <p className="text-[10px] font-bold text-destructive">{errors.lastName}</p>
              )}
            </div>
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="psm-phone" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Phone Number</Label>
            <PhoneInput
              id="psm-phone"
              value={phone}
              onChange={(val) => setPhone(normalizePhoneNumber(val))}
              placeholder="(555)555-5555"
              className={cn("h-9 text-xs shadow-sm bg-muted/20 border-border", errors.phone && "border-destructive ring-destructive/20")}
            />
            {errors.phone && (
              <p className="text-[10px] font-bold text-destructive">{errors.phone}</p>
            )}
          </div>

          <div className="h-px bg-border/50 my-2" />

          {/* Resident State */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Resident State</Label>
            <Select value={residentState} onValueChange={setResidentState}>
              <SelectTrigger className={cn("h-9 text-xs shadow-sm bg-muted/20 border-border", errors.residentState && "border-destructive ring-destructive/20")}>
                <SelectValue placeholder="Select your resident state" />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                {US_STATES.map((state) => (
                  <SelectItem key={state} value={state} className="text-xs">
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.residentState && (
              <p className="text-[10px] font-bold text-destructive">{errors.residentState}</p>
            )}
          </div>

          {/* Licensed States */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Licensed States{" "}
              <span className="text-muted-foreground font-normal lowercase">(optional)</span>
            </Label>
            <div className="border border-border rounded-lg p-3 bg-muted/10 max-h-40 overflow-y-auto space-y-2 scrollbar-thin">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <Checkbox
                  id="psm-select-all"
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  className="rounded-sm"
                />
                <label
                  htmlFor="psm-select-all"
                  className="text-[11px] font-bold text-foreground cursor-pointer select-none"
                >
                  Select All States
                </label>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1.5">
                {US_STATES.map((state) => (
                  <div key={state} className="flex items-center gap-2">
                    <Checkbox
                      id={`psm-state-${state}`}
                      checked={licensedStates.includes(state)}
                      onCheckedChange={() => toggleState(state)}
                      className="rounded-sm h-3.5 w-3.5"
                    />
                    <label
                      htmlFor={`psm-state-${state}`}
                      className="text-[10px] text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    >
                      {state}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Commission Level */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Commission Level{" "}
              <span className="text-muted-foreground font-normal lowercase">(optional)</span>
            </Label>
            <Select value={commissionLevel} onValueChange={setCommissionLevel}>
              <SelectTrigger className="h-9 text-xs shadow-sm bg-muted/20 border-border text-foreground">
                <SelectValue placeholder="Select commission level" />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                {COMMISSION_LEVELS.map((level) => (
                  <SelectItem key={level} value={level} className="text-xs">
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="p-5 border-t border-border bg-muted/5 flex items-center justify-end gap-3 sm:justify-end">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose} 
            disabled={isSaving}
            className="h-9 px-4 text-[10px] font-bold uppercase text-muted-foreground hover:bg-muted transition-colors"
          >
            Skip for now
          </Button>
          <Button 
            size="sm" 
            onClick={handleSave} 
            disabled={isSaving}
            className="h-9 px-6 text-[10px] font-bold uppercase tracking-widest bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:translate-y-[-1px] transition-all"
          >
            {isSaving ? "Saving..." : "Save Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
