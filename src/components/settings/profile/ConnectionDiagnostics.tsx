import React, { useEffect, useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTwilio } from "@/contexts/TwilioContext";
import { getCurrentIdentity, getTwilioDevice } from "@/lib/twilio-voice";
import { getPhonePresence } from "@/lib/phonePresenceClient";

/**
 * Inbound Calling v2 — read-only phone connection diagnostics (implementation_plan.md rev 3 §8.2 P17):
 * Device state and identity, the current presence generation (registration id / seq / last write
 * result) and the agent-perceived ring measurements (Device `incoming` → `cancel`, ms) so live tests
 * report observed timing next to the provider setting instead of assuming a band.
 */
export const ConnectionDiagnostics: React.FC = () => {
  const { status, callState, errorMessage } = useTwilio();
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [open]);

  void tick;
  const device = getTwilioDevice();
  const snap = getPhonePresence().snapshot();
  const last = snap.history[snap.history.length - 1];
  const rings = [...snap.rings].reverse().slice(0, 10);

  return (
    <Card className="border-border/60 shadow-sm" data-testid="connection-diagnostics">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between text-left">
              <span>
                <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" aria-hidden /> Phone connection diagnostics</CardTitle>
                <CardDescription>Device: {status}{callState !== "idle" ? ` · call ${callState}` : ""}</CardDescription>
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[180px_1fr]">
              <dt className="text-muted-foreground">Device state</dt><dd>{device?.state ?? "(none)"}{errorMessage ? ` — ${errorMessage}` : ""}</dd>
              <dt className="text-muted-foreground">Identity</dt><dd className="break-all">{getCurrentIdentity() ?? "(none)"}</dd>
              <dt className="text-muted-foreground">Registration generation</dt><dd className="break-all">{snap.registrationId ?? "(none)"} · seq {snap.seq} · {snap.registered ? "registered" : "not registered"}</dd>
              <dt className="text-muted-foreground">Last presence write</dt>
              <dd>{last ? `${new Date(last.at).toLocaleTimeString()} · ${last.state}${last.detail ? ` (${last.detail})` : ""} · ${typeof last.result === "string" ? last.result : last.result ? (last.result.applied ? "applied" : last.result.reason) : "no result"}` : "(none yet)"}</dd>
            </dl>
            <div>
              <p className="mb-1 font-medium">Ring measurements (browser incoming → cancel)</p>
              {rings.length === 0 ? (
                <p className="text-xs text-muted-foreground">No unanswered rings measured in this session yet.</p>
              ) : (
                <ul className="space-y-0.5 text-xs">
                  {rings.map((r, i) => (
                    <li key={`${r.at}-${i}`}>{new Date(r.at).toLocaleTimeString()} · {(r.ms / 1000).toFixed(1)} s · {r.outcome}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Provider setting: the organization's browser ring seconds (default 20). Twilio may hold the leg up to about five seconds longer; the SDK waits up to two seconds for the ringtone before reporting incoming. Compare, do not assume.</p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default ConnectionDiagnostics;
