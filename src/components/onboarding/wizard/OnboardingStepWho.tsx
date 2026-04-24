import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATE_NAMES } from "@/constants/us-geo";
import { cn } from "@/lib/utils";

interface Props {
  firstName: string;
  lastName: string;
  phone: string;
  residentState: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ firstName: string; lastName: string; phone: string; residentState: string }>) => void;
}

export function OnboardingStepWho({
  firstName,
  lastName,
  phone,
  residentState,
  errors,
  onChange,
}: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Who are you?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          We use this for caller notes and account recovery — not for caller ID on outbound calls. You can add a profile photo anytime under Settings → My Profile.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ob-fn">First name</Label>
          <Input
            id="ob-fn"
            value={firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            className={cn(errors.firstName && "border-destructive")}
          />
          {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-ln">Last name</Label>
          <Input
            id="ob-ln"
            value={lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            className={cn(errors.lastName && "border-destructive")}
          />
          {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ob-phone">Phone (internal contact)</Label>
        <PhoneInput
          id="ob-phone"
          value={phone}
          onChange={(v) => onChange({ phone: normalizePhoneNumber(v) })}
          className={cn(errors.phone && "border-destructive")}
        />
        {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>Resident state</Label>
        <Select value={residentState} onValueChange={(v) => onChange({ residentState: v })}>
          <SelectTrigger className={cn(errors.residentState && "border-destructive")}>
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent>
            {US_STATE_NAMES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.residentState && <p className="text-xs text-destructive">{errors.residentState}</p>}
      </div>
    </div>
  );
}
