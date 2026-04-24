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
import { US_STATE_NAMES, US_TIMEZONES, COMMISSION_LEVELS } from "@/constants/us-geo";
import { cn } from "@/lib/utils";

interface Props {
  npn: string;
  licensedStates: string[];
  timezone: string;
  commissionLevel: string;
  commissionReadOnly: boolean;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ npn: string; licensedStates: string[]; timezone: string; commissionLevel: string }>) => void;
}

export function OnboardingStepCredentials({
  npn,
  licensedStates,
  timezone,
  commissionLevel,
  commissionReadOnly,
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
          NPN and licensed states help keep your life insurance work compliant. Timezone is used for callbacks and calendar.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ob-npn">National Producer Number (NPN)</Label>
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
        <Label>Licensed states</Label>
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
        <Label>Your timezone</Label>
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
        <Label>Commission level</Label>
        {commissionReadOnly ? (
          <p className="text-sm py-2 px-3 rounded-md bg-muted text-foreground">{commissionLevel || "—"}</p>
        ) : (
          <Select value={commissionLevel} onValueChange={(v) => onChange({ commissionLevel: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              {COMMISSION_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
