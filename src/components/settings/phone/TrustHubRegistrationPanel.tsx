import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RefreshCw, Link2 } from "lucide-react";
import { toE164Plus } from "@/utils/phoneUtils";
import {
  trustHubRegistrationSchema,
  TRUST_HUB_BUSINESS_TYPES,
  type TrustHubRegistrationFormInput,
} from "./trustHubRegistrationSchema";
import type { TrustNumberRow } from "./trustHubTypes";

type TwilioTrustHubResponse = {
  status?: string;
  profile_sid?: string;
  error?: string;
  results?: { twilio_sid: string; ok: boolean; error?: string }[];
};

const REVIEW_STATUSES = new Set(["draft", "pending-review", "in-review"]);

type Props = {
  canManageTrustHub: boolean;
  trustHubProfileSid: string | null;
  numbers: TrustNumberRow[];
  formatPhone: (n: string) => string;
  onRefresh: () => Promise<void>;
};

const emptyForm: TrustHubRegistrationFormInput = {
  business_name: "",
  business_type: "llc",
  ein: "",
  address_street: "",
  address_city: "",
  address_state: "",
  address_zip: "",
  contact_first_name: "",
  contact_last_name: "",
  contact_email: "",
  contact_phone: "",
  website: "",
};

export const TrustHubRegistrationPanel: React.FC<Props> = ({
  canManageTrustHub,
  trustHubProfileSid,
  numbers,
  formatPhone,
  onRefresh,
}) => {
  const [form, setForm] = useState<TrustHubRegistrationFormInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [twilioStatus, setTwilioStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignmentBySid, setAssignmentBySid] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const runCheckStatus = useCallback(async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke<TwilioTrustHubResponse>("twilio-trust-hub", {
        body: { action: "check-status" },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.status) setTwilioStatus(data.status);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reach Trust Hub";
      toast.error(msg);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (trustHubProfileSid) void runCheckStatus();
    else setTwilioStatus(null);
  }, [trustHubProfileSid, runCheckStatus]);

  const handleRegister = async () => {
    setFieldErrors({});
    const parsed = trustHubRegistrationSchema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      toast.error("Please fix the highlighted fields.");
      return;
    }
    const v = parsed.data;
    setRegistering(true);
    try {
      const { data, error } = await supabase.functions.invoke<TwilioTrustHubResponse>("twilio-trust-hub", {
        body: {
          action: "register",
          business_name: v.business_name,
          business_type: v.business_type,
          ein: v.ein,
          address_street: v.address_street,
          address_city: v.address_city,
          address_state: v.address_state,
          address_zip: v.address_zip,
          contact_first_name: v.contact_first_name,
          contact_last_name: v.contact_last_name,
          contact_email: v.contact_email,
          contact_phone: toE164Plus(v.contact_phone),
          website: v.website || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success("Submitted to Twilio Trust Hub — status is pending review.");
      setTwilioStatus("pending-review");
      await onRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      toast.error(msg);
    } finally {
      setRegistering(false);
    }
  };

  const handleAssignNumbers = async () => {
    const sids = numbers
      .filter((n) => n.status === "active" && n.twilio_sid && n.trust_hub_status !== "approved")
      .map((n) => String(n.twilio_sid));
    if (sids.length === 0) {
      toast.message("Every active number is already marked approved for Trust Hub.");
      return;
    }
    setAssigning(true);
    setAssignmentBySid({});
    try {
      const { data, error } = await supabase.functions.invoke<TwilioTrustHubResponse>("twilio-trust-hub", {
        body: { action: "assign-numbers", twilio_sids: sids },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const map: Record<string, { ok: boolean; error?: string }> = {};
      for (const r of data?.results ?? []) {
        map[r.twilio_sid] = { ok: r.ok, error: r.error };
      }
      setAssignmentBySid(map);
      const okCount = (data?.results ?? []).filter((r) => r.ok).length;
      toast.success(okCount ? `Linked ${okCount} number(s) to Trust Hub.` : "No numbers were linked.");
      await onRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Assignment failed";
      toast.error(msg);
    } finally {
      setAssigning(false);
    }
  };

  const statusBadge = () => {
    const st = twilioStatus ?? "—";
    if (st === "twilio-approved") {
      return <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/20">Approved</Badge>;
    }
    if (st === "twilio-rejected") {
      return <Badge variant="destructive">Rejected</Badge>;
    }
    if (REVIEW_STATUSES.has(st)) {
      return <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25">Under review</Badge>;
    }
    return <Badge variant="outline">{st}</Badge>;
  };

  const showRegistrationForm = canManageTrustHub && !trustHubProfileSid;

  return (
    <div className="space-y-5">
      {trustHubProfileSid ? (
        <div className="rounded-lg border border-border/50 bg-muted/15 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <p className="text-sm font-medium text-foreground">Twilio review status</p>
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge()}
              <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => void runCheckStatus()}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-1.5">Check status</span>
              </Button>
            </div>
          </div>
          <code className="text-xs font-mono text-muted-foreground break-all block">{trustHubProfileSid}</code>
          {twilioStatus && REVIEW_STATUSES.has(twilioStatus) && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Under review — Twilio typically completes this within 1–5 business days. Use Check status after you hear back from Twilio.
            </p>
          )}
          {twilioStatus === "twilio-rejected" && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Twilio did not approve this profile. Open a ticket with Twilio support from your Twilio Console for the exact rejection reason and next steps.
            </p>
          )}
          {twilioStatus === "twilio-approved" && canManageTrustHub && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" size="sm" disabled={assigning} onClick={() => void handleAssignNumbers()}>
                {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                <span className="ml-1.5">Assign active numbers</span>
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Links purchased numbers to this profile so carriers can raise SHAKEN/STIR attestation.
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 bg-muted/15 p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">Trust Hub status</p>
          {!canManageTrustHub ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Only an agency Admin can submit your business to Twilio Trust Hub. Ask your administrator to complete this from Phone settings.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Register your life insurance agency so Twilio can verify the business behind your outbound calls — this is the biggest lever for legitimate caller ID and answer rates.
            </p>
          )}
        </div>
      )}

      {showRegistrationForm && (
        <div className="rounded-lg border border-border/60 p-4 space-y-4">
          <p className="text-sm font-medium">Business details</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="th-business-name">Legal business name</Label>
              <Input
                id="th-business-name"
                value={form.business_name}
                onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
              />
              {fieldErrors.business_name && <p className="text-xs text-destructive">{fieldErrors.business_name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Business type</Label>
              <Select
                value={form.business_type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, business_type: v as TrustHubRegistrationFormInput["business_type"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {TRUST_HUB_BUSINESS_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.business_type && <p className="text-xs text-destructive">{fieldErrors.business_type}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-ein">EIN (9 digits)</Label>
              <Input
                id="th-ein"
                inputMode="numeric"
                autoComplete="off"
                placeholder="12-3456789"
                value={form.ein}
                onChange={(e) => setForm((f) => ({ ...f, ein: e.target.value }))}
              />
              {fieldErrors.ein && <p className="text-xs text-destructive">{fieldErrors.ein}</p>}
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="th-street">Street address</Label>
              <Input
                id="th-street"
                value={form.address_street}
                onChange={(e) => setForm((f) => ({ ...f, address_street: e.target.value }))}
              />
              {fieldErrors.address_street && <p className="text-xs text-destructive">{fieldErrors.address_street}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-city">City</Label>
              <Input id="th-city" value={form.address_city} onChange={(e) => setForm((f) => ({ ...f, address_city: e.target.value }))} />
              {fieldErrors.address_city && <p className="text-xs text-destructive">{fieldErrors.address_city}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="th-state">State</Label>
                <Input
                  id="th-state"
                  maxLength={2}
                  placeholder="TX"
                  value={form.address_state}
                  onChange={(e) => setForm((f) => ({ ...f, address_state: e.target.value.toUpperCase() }))}
                />
                {fieldErrors.address_state && <p className="text-xs text-destructive">{fieldErrors.address_state}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="th-zip">ZIP</Label>
                <Input id="th-zip" value={form.address_zip} onChange={(e) => setForm((f) => ({ ...f, address_zip: e.target.value }))} />
                {fieldErrors.address_zip && <p className="text-xs text-destructive">{fieldErrors.address_zip}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-fn">Contact first name</Label>
              <Input id="th-fn" value={form.contact_first_name} onChange={(e) => setForm((f) => ({ ...f, contact_first_name: e.target.value }))} />
              {fieldErrors.contact_first_name && <p className="text-xs text-destructive">{fieldErrors.contact_first_name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-ln">Contact last name</Label>
              <Input id="th-ln" value={form.contact_last_name} onChange={(e) => setForm((f) => ({ ...f, contact_last_name: e.target.value }))} />
              {fieldErrors.contact_last_name && <p className="text-xs text-destructive">{fieldErrors.contact_last_name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-email">Contact email</Label>
              <Input
                id="th-email"
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
              />
              {fieldErrors.contact_email && <p className="text-xs text-destructive">{fieldErrors.contact_email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-phone">Contact phone (E.164)</Label>
              <Input
                id="th-phone"
                placeholder="+15551234567"
                value={form.contact_phone}
                onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
              />
              {fieldErrors.contact_phone && <p className="text-xs text-destructive">{fieldErrors.contact_phone}</p>}
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="th-web">Website (optional)</Label>
              <Input
                id="th-web"
                placeholder="https://www.youragency.com"
                value={form.website ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              />
            </div>
          </div>
          <Button type="button" disabled={registering} onClick={() => void handleRegister()}>
            {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className={registering ? "ml-2" : ""}>Submit to Trust Hub</span>
          </Button>
        </div>
      )}

      {numbers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Per-number reputation</p>
          <ul className="max-h-52 overflow-y-auto divide-y divide-border/60 rounded-lg border border-border/50">
            {numbers.map((n) => {
              const att = (n.shaken_stir_attestation || n.attestation_level || "—").toString();
              const th = (n.trust_hub_status || "—").toString();
              const sid = n.twilio_sid ?? "";
              const assignHint = sid && assignmentBySid[sid];
              return (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="font-mono text-foreground">{formatPhone(n.phone_number)}</span>
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        STIR {att}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        Trust {th}
                      </Badge>
                    </div>
                    {assignHint && (
                      <span className={`text-[10px] ${assignHint.ok ? "text-emerald-600" : "text-destructive"}`}>
                        {assignHint.ok ? "Linked to profile" : assignHint.error || "Link failed"}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
