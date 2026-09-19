import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * The Call Forwarding inputs. Presentational only — the owning section holds the values, the Zod
 * result and the save. A field error clears as soon as the agent edits that field.
 */
export const CallForwardingFormFields: React.FC<{
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  mobile: string;
  onMobileChange: (mobile: string) => void;
  mobileError?: string;
  greeting: string;
  onGreetingChange: (greeting: string) => void;
  greetingError?: string;
  greetingMaxLength: number;
}> = ({
  enabled,
  onEnabledChange,
  mobile,
  onMobileChange,
  mobileError,
  greeting,
  onGreetingChange,
  greetingError,
  greetingMaxLength,
}) => (
  <>
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm font-medium text-foreground">Forward unanswered calls</p>
      <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Forward unanswered calls" />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="call-forwarding-mobile" className="text-sm font-medium">
        Mobile number
      </Label>
      <Input
        id="call-forwarding-mobile"
        type="tel"
        autoComplete="tel"
        placeholder="(555) 123-4567"
        value={mobile}
        onChange={(e) => onMobileChange(e.target.value)}
        aria-invalid={Boolean(mobileError)}
        className="sm:max-w-xs"
      />
      {mobileError ? (
        <p className="text-xs text-destructive" data-testid="call-forwarding-mobile-error">
          {mobileError}
        </p>
      ) : null}
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="call-forwarding-greeting" className="text-sm font-medium">
        Voicemail greeting
      </Label>
      <Textarea
        id="call-forwarding-greeting"
        value={greeting}
        maxLength={greetingMaxLength}
        onChange={(e) => onGreetingChange(e.target.value)}
        placeholder="Hi, you've reached … leave a message and I'll call you right back."
        className="min-h-[72px] resize-none"
      />
      {greetingError ? (
        <p className="text-xs text-destructive" data-testid="call-forwarding-greeting-error">
          {greetingError}
        </p>
      ) : null}
    </div>
  </>
);

export default CallForwardingFormFields;
