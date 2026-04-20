import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { twilioCredentialsFormSchema } from "./twilioCredentialsSchema";

function maskSid(value: string, showFull: boolean, dirty: boolean): string {
  if (!value) return "";
  if (showFull || dirty) return value;
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
}

type Props = {
  accountSid: string;
  setAccountSid: (v: string) => void;
  authToken: string;
  setAuthToken: (v: string) => void;
  apiKeySid: string;
  setApiKeySid: (v: string) => void;
  apiKeySecret: string;
  setApiKeySecret: (v: string) => void;
  applicationSid: string;
  setApplicationSid: (v: string) => void;
  recordingEnabled: boolean;
  setRecordingEnabled: (v: boolean) => void;
  hasChanges: boolean;
  saving: boolean;
  onSave: () => Promise<void>;
  testing: boolean;
  onTest: () => Promise<void>;
  testResult: { success: boolean; message: string } | null;
};

export const TwilioCredentialsSection: React.FC<Props> = ({
  accountSid,
  setAccountSid,
  authToken,
  setAuthToken,
  apiKeySid,
  setApiKeySid,
  apiKeySecret,
  setApiKeySecret,
  applicationSid,
  setApplicationSid,
  recordingEnabled,
  setRecordingEnabled,
  hasChanges,
  saving,
  onSave,
  testing,
  onTest,
  testResult,
}) => {
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [showApiKeySecret, setShowApiKeySecret] = useState(false);
  const [acctFocus, setAcctFocus] = useState(false);
  const [apiKeyFocus, setApiKeyFocus] = useState(false);
  const [acctDirty, setAcctDirty] = useState(false);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);

  const handleSaveClick = async () => {
    const parsed = twilioCredentialsFormSchema.safeParse({
      accountSid,
      authToken,
      apiKeySid: apiKeySid.trim(),
      apiKeySecret,
      applicationSid: applicationSid.trim(),
    });
    if (!parsed.success) {
      const first = parsed.error.flatten().fieldErrors;
      const msg =
        first.accountSid?.[0] ||
        first.authToken?.[0] ||
        first.apiKeySid?.[0] ||
        first.apiKeySecret?.[0] ||
        first.applicationSid?.[0] ||
        "Check your Twilio fields";
      toast.error(msg);
      return;
    }
    await onSave();
  };

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/40 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Phone className="w-5 h-5 text-primary" />
          Twilio connection
        </CardTitle>
        <CardDescription>
          Account credentials for Voice and messaging. Keys stay in your agency row in Supabase — never in the browser bundle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Account SID</label>
            <Input
              value={maskSid(accountSid, acctFocus, acctDirty)}
              readOnly={!acctFocus && !acctDirty && !!accountSid}
              onChange={(e) => {
                setAcctDirty(true);
                setAccountSid(e.target.value);
              }}
              onFocus={() => setAcctFocus(true)}
              onBlur={() => setAcctFocus(false)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">Only the last four characters show until you click in the field.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Auth token</label>
            <div className="relative">
              <Input
                type={showAuthToken ? "text" : "password"}
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Primary auth token"
                className="pr-10 font-mono text-sm"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowAuthToken(!showAuthToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showAuthToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">API Key SID</label>
            <Input
              value={maskSid(apiKeySid, apiKeyFocus, apiKeyDirty)}
              readOnly={!apiKeyFocus && !apiKeyDirty && !!apiKeySid}
              onChange={(e) => {
                setApiKeyDirty(true);
                setApiKeySid(e.target.value);
              }}
              onFocus={() => setApiKeyFocus(true)}
              onBlur={() => setApiKeyFocus(false)}
              placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">API Key secret</label>
            <div className="relative">
              <Input
                type={showApiKeySecret ? "text" : "password"}
                value={apiKeySecret}
                onChange={(e) => setApiKeySecret(e.target.value)}
                placeholder="Stored with your other phone flags"
                className="pr-10 font-mono text-sm"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowApiKeySecret(!showApiKeySecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKeySecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium text-foreground">TwiML App SID</label>
            <Input
              value={applicationSid}
              onChange={(e) => setApplicationSid(e.target.value)}
              placeholder="APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Call recording</p>
            <p className="text-xs text-muted-foreground">When on, eligible outbound legs can be recorded per your Twilio webhook rules.</p>
          </div>
          <Switch checked={recordingEnabled} onCheckedChange={setRecordingEnabled} />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
          <Button type="button" onClick={handleSaveClick} disabled={saving || !hasChanges}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…
              </>
            ) : (
              "Save phone settings"
            )}
          </Button>
          <Button type="button" variant="outline" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Test connection
          </Button>
          {testResult && (
            <span
              className={`inline-flex items-center gap-1.5 text-sm ${
                testResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              }`}
            >
              {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {testResult.message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
