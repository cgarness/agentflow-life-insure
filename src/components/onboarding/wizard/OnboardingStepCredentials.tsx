import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_STATE_NAMES, US_TIMEZONES } from "@/constants/us-geo";
import { cn } from "@/lib/utils";

interface Props {
  npn: string;
  licensedStates: string[];
  timezone: string;
  commissionDigits: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ npn: string; licensedStates: string[]; timezone: string; commissionDigits: string }>) => void;
}

export function OnboardingStepCredentials({
  npn,
  licensedStates,
  timezone,
  commissionDigits,
  errors,
  onChange,
}: Props) {
  const all = licensedStates.length === US_STATE_NAMES.length;
  const toggleAll = () => {
    onChange({ licensedStates: all ? [] : [...US_STATE_NAMES] });
  };
  const toggleOne = (state: string) => {
    onChange({
      licensedStates: licensedStates.includes(state)
        ? licensedStates.filter((s) => s !== state)
        : [...licensedStates, state],
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Your credentials</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Everything on this step is optional. Add what you have now; you can always update these later in settings.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ob-npn">National Producer Number (NPN) (optional)</Label>
        <Input
          id="ob-npn"
          value={npn}
          onChange={(e) => onChange({ npn: e.target.value })}
          placeholder="e.g. 12345678"
          className={cn(errors.npn && "border-destructive")}
        />
        {errors.npn && <p className="text-xs text-destructive">{errors.npn}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>Licensed states (optional)</Label>
        <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2 bg-muted/10">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Checkbox id="ob-ls-all" checked={all} onCheckedChange={toggleAll} />
            <label htmlFor="ob-ls-all" className="text-sm font-medium cursor-pointer">
              Select all
            </label>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {US_STATE_NAMES.map((state) => (
              <div key={state} className="flex items-center gap-2">
                <Checkbox
                  id={`ob-ls-${state}`}
                  checked={licensedStates.includes(state)}
                  onCheckedChange={() => toggleOne(state)}
                />
                <label htmlFor={`ob-ls-${state}`} className="text-xs text-muted-foreground cursor-pointer truncate">
                  {state}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Your timezone (optional)</Label>
        <Select value={timezone} onValueChange={(v) => onChange({ timezone: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {US_TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ob-commission">Commission level (optional)</Label>
        <Input
          id="ob-commission"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="e.g. 105"
          value={commissionDigits}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "");
            onChange({ commissionDigits: next });
          }}
          className={cn(errors.commissionDigits && "border-destructive")}
        />
        <p className="text-xs text-muted-foreground">Numbers only (no % sign).</p>
        {errors.commissionDigits && <p className="text-xs text-destructive">{errors.commissionDigits}</p>}
      </div>
    </div>
  );
}
