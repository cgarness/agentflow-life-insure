import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { US_TIMEZONES } from "@/constants/us-geo";
import { cn } from "@/lib/utils";

export type TeamSizeIntent = "solo" | "small" | "large";

interface FounderProps {
  mode: "founder";
  agencyName: string;
  agencyTimezone: string;
  teamSize: TeamSizeIntent;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ agencyName: string; agencyTimezone: string; teamSize: TeamSizeIntent }>) => void;
}

interface InviteProps {
  mode: "invite";
  orgName: string;
  role: string;
  uplineLabel: string | null;
}

type Props = FounderProps | InviteProps;

export function OnboardingStepAgency(props: Props) {
  if (props.mode === "invite") {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Your agency</h2>
          <p className="text-sm text-muted-foreground mt-1">
            You are joining an existing AgentFlow workspace. Confirm the details below.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agency</p>
            <p className="text-base font-semibold text-foreground">{props.orgName}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your role</p>
            <p className="text-base text-foreground">{props.role}</p>
          </div>
          {props.uplineLabel && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upline</p>
              <p className="text-base text-foreground">{props.uplineLabel}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { agencyName, agencyTimezone, teamSize, errors, onChange } = props;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Your agency</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Name your agency, set a default timezone for scheduling, and tell us roughly how many producers you expect.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ob-agency">Agency display name</Label>
        <Input
          id="ob-agency"
          value={agencyName}
          onChange={(e) => onChange({ agencyName: e.target.value })}
          className={cn(errors.agencyName && "border-destructive")}
        />
        {errors.agencyName && <p className="text-xs text-destructive">{errors.agencyName}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>Agency default timezone</Label>
        <Select value={agencyTimezone} onValueChange={(v) => onChange({ agencyTimezone: v })}>
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
      <div className="space-y-2">
        <Label>How many agents do you expect?</Label>
        <RadioGroup
          value={teamSize}
          onValueChange={(v) => onChange({ teamSize: v as TeamSizeIntent })}
          className="space-y-2"
        >
          <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
            <RadioGroupItem value="solo" id="ob-ts-solo" />
            <span className="text-sm">Just me</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
            <RadioGroupItem value="small" id="ob-ts-sm" />
            <span className="text-sm">2–10 producers</span>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/40">
            <RadioGroupItem value="large" id="ob-ts-lg" />
            <span className="text-sm">10+ producers</span>
          </label>
        </RadioGroup>
      </div>
    </div>
  );
}
