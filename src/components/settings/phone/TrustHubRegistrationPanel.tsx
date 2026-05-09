import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RefreshCw, Link2, CheckCircle2, AlertCircle, Clock, ShieldCheck, Zap, Phone } from "lucide-react";
import { toE164Plus } from "@/utils/phoneUtils";
import {
  trustHubRegistrationSchema,
  TRUST_HUB_BUSINESS_TYPES,
  TRUST_HUB_BUSINESS_INDUSTRIES,
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
  onRefresh: () => Promise<void>;
};

const emptyForm: TrustHubRegistrationFormInput = {
  business_name: "",
  business_type: "llc",
  business_industry: "INSURANCE",
  business_registration_number: "",
  ein: "",
  website: "",
  address_street: "",
  address_city: "",
  address_state: "",
  address_zip: "",
  contact_first_name: "",
  contact_last_name: "",
  contact_email: "",
  contact_phone: "",
  contact_title: "",
  cnam_display_name: "",
  enroll_shaken_stir: true,
  enroll_voice_integrity: true,
  enroll_cnam: false,
};

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-destructive mt-1">{msg}</p>;
}

function SectionCard({
  icon,
  title,
  description,
  badge,
  children,
  enrolled,
  onToggleEnroll,
  enrollLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  enrolled?: boolean;
  onToggleEnroll?: (v: boolean) => void;
  enrollLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border/40 bg-muted/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0 mt-0.5">{icon}</div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground">{title}</h4>
              {badge}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          </div>
        </div>
        {onToggleEnroll !== undefined && (
          <div className="flex items-center gap-2 shrink-0">
            <Checkbox
              id={`enroll-${title}`}
              checked={enrolled}
              onCheckedChange={(v) => onToggleEnroll(!!v)}
            />
            <label htmlFor={`enroll-${title}`} className="text-xs text-muted-foreground cursor-pointer select-none">
              {enrollLabel ?? "Enroll"}
            </label>
          </div>
        )}
      </div>
      {children && <div className="p-4">{children}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const st = status ?? "—";
  if (st === "twilio-approved") {
    return (
      <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/20 gap-1">
        <CheckCircle2 className="h-3 w-3" />Approved
      </Badge>
    );
  }
  if (st === "twilio-rejected") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />Rejected
      </Badge>
    );
  }
  if (REVIEW_STATUSES.has(st)) {
    return (
      <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/25 gap-1">
        <Clock className="h-3 w-3" />Under review
      </Badge>
    );
  }
  if (st === "not-registered" || st === "—") {
    return <Badge variant="outline">Not registered</Badge>;
  }
  return <Badge variant="outline">{st}</Badge>;
}

export const TrustHubRegistrationPanel: React.FC<Props> = ({
  canManageTrustHub,
  trustHubProfileSid,
  numbers,
  onRefresh,
}) => {
  const [form, setForm] = useState<TrustHubRegistrationFormInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [twilioStatus, setTwilioStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const set = <K extends keyof TrustHubRegistrationFormInput>(key: K, val: TrustHubRegistrationFormInput[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const runCheckStatus = useCallback(async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke<TwilioTrustHubResponse>("twilio-trust-hub", {
        body: { action: "check-status" },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      if (data?.status) setTwilioStatus(data.status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach Trust Hub");
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
    if (!parsed.data.enroll_shaken_stir && !parsed.data.enroll_voice_integrity && !parsed.data.enroll_cnam) {
      toast.error("Select at least one program to enroll in.");
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
          business_industry: v.business_industry,
          ein: v.ein,
          address_street: v.address_street,
          address_city: v.address_city,
          address_state: v.address_state,
          address_zip: v.address_zip,
          contact_first_name: v.contact_first_name,
          contact_last_name: v.contact_last_name,
          contact_title: v.contact_title || undefined,
          contact_email: v.contact_email,
          contact_phone: toE164Plus(v.contact_phone),
          website: v.website || undefined,
          cnam_display_name: v.enroll_cnam && v.cnam_display_name ? v.cnam_display_name : undefined,
          enroll_shaken_stir: v.enroll_shaken_stir,
          enroll_voice_integrity: v.enroll_voice_integrity,
          enroll_cnam: v.enroll_cnam,
        },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      toast.success("Submitted to Twilio Trust Hub — status is pending review.");
      setTwilioStatus("pending-review");
      await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Registration failed");
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
    try {
      const { data, error } = await supabase.functions.invoke<TwilioTrustHubResponse>("twilio-trust-hub", {
        body: { action: "assign-numbers", twilio_sids: sids },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      const okCount = (data?.results ?? []).filter((r) => r.ok).length;
      toast.success(okCount ? `Linked ${okCount} number(s) to Trust Hub.` : "No numbers were linked.");
      await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  };

  // ── Registered state ──────────────────────────────────────────────────────
  if (trustHubProfileSid) {
    return (
      <div className="space-y-6">
        {/* Status banner */}
        <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Trust Hub Profile</p>
              <code className="text-xs font-mono text-muted-foreground break-all block mt-1">{trustHubProfileSid}</code>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={twilioStatus} />
              <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => void runCheckStatus()}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-1.5">Refresh status</span>
              </Button>
            </div>
          </div>

          {twilioStatus && REVIEW_STATUSES.has(twilioStatus) && (
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
              ⏳ Under review — Twilio typically completes verification within 1–5 business days.
              Check back after hearing from Twilio.
            </p>
          )}
          {twilioStatus === "twilio-rejected" && (
            <p className="text-xs text-destructive leading-relaxed border-t border-border/40 pt-3">
              ✗ Twilio rejected this profile. Open a support ticket in your{" "}
              <a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="underline">Twilio Console</a>{" "}
              for the exact rejection reason.
            </p>
          )}
        </div>

        {/* Assign numbers (only when approved) */}
        {twilioStatus === "twilio-approved" && canManageTrustHub && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold text-foreground">Profile Approved</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Link your purchased phone numbers to this Trust Hub profile so carriers can raise SHAKEN/STIR attestation.
            </p>
            <Button type="button" size="sm" disabled={assigning} onClick={() => void handleAssignNumbers()}>
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              <span className="ml-1.5">Assign active numbers to Trust Hub</span>
            </Button>
          </div>
        )}

        {/* Numbers status table */}
        {numbers.filter((n) => n.status === "active").length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Numbers</p>
            <div className="rounded-lg border border-border/40 overflow-hidden">
              {numbers.filter((n) => n.status === "active").map((n, i) => (
                <div key={n.twilio_sid ?? i} className="flex items-center justify-between px-3 py-2 border-b border-border/30 last:border-0">
                  <span className="text-sm font-mono text-foreground">{n.friendly_name || n.phone_number}</span>
                  {n.trust_hub_status === "approved"
                    ? <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-600/20 text-[10px]">Linked</Badge>
                    : <Badge variant="outline" className="text-[10px]">Not linked</Badge>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Registration form ──────────────────────────────────────────────────────
  if (!canManageTrustHub) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/15 p-4">
        <p className="text-sm font-medium text-foreground">Trust Hub not yet registered</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Only an agency Admin can submit your business to Twilio Trust Hub. Ask your administrator to complete this from Phone settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Complete this form to register your life insurance agency with Twilio Trust Hub. This creates a verified business identity
          that helps carriers recognize your calls as legitimate, improving answer rates and reducing spam flags.
          Twilio will review your submission within 1–5 business days.
        </p>
      </div>

      {/* Program Selection */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">Select Programs</p>

        <SectionCard
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          title="SHAKEN/STIR"
          description="Verifies caller identity using encrypted digital signatures. Raises your attestation level so carriers display Verified Caller instead of Spam Risk. US phone numbers only."
          enrolled={form.enroll_shaken_stir}
          onToggleEnroll={(v) => set("enroll_shaken_stir", v)}
          enrollLabel="Enroll"
        />

        <SectionCard
          icon={<Zap className="h-4 w-4 text-primary" />}
          title="Voice Integrity"
          description="Remediates spam labels on your phone numbers. Registers your numbers with analytic engines for select US carriers so they're treated as verified business traffic."
          enrolled={form.enroll_voice_integrity}
          onToggleEnroll={(v) => set("enroll_voice_integrity", v)}
          enrollLabel="Enroll"
        />

        <SectionCard
          icon={<Phone className="h-4 w-4 text-primary" />}
          title="CNAM (Caller ID Name)"
          description="Displays your business name on outbound calls to US landlines. Enter up to 15 characters — this is what recipients will see when you call."
          enrolled={form.enroll_cnam}
          onToggleEnroll={(v) => set("enroll_cnam", v)}
          enrollLabel="Enroll"
        >
          {form.enroll_cnam && (
            <div className="space-y-1.5">
              <Label htmlFor="th-cnam">Display name (max 15 chars)</Label>
              <Input
                id="th-cnam"
                maxLength={15}
                placeholder="APEX INSURANCE"
                value={form.cnam_display_name ?? ""}
                onChange={(e) => set("cnam_display_name", e.target.value.toUpperCase())}
              />
              <p className="text-[11px] text-muted-foreground">{(form.cnam_display_name ?? "").length}/15 characters — use ALL CAPS, no special characters</p>
              <FieldError msg={fieldErrors.cnam_display_name} />
            </div>
          )}
        </SectionCard>
      </div>

      {/* Business Information */}
      <div className="rounded-xl border border-border/60 p-4 space-y-4">
        <p className="text-sm font-semibold text-foreground">Business Information</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="th-business-name">Legal business name *</Label>
            <Input
              id="th-business-name"
              value={form.business_name}
              onChange={(e) => set("business_name", e.target.value)}
              placeholder="Apex Life Insurance LLC"
            />
            <FieldError msg={fieldErrors.business_name} />
          </div>

          <div className="space-y-1.5">
            <Label>Business type *</Label>
            <Select
              value={form.business_type}
              onValueChange={(v) => set("business_type", v as TrustHubRegistrationFormInput["business_type"])}
            >
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {TRUST_HUB_BUSINESS_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError msg={fieldErrors.business_type} />
          </div>

          <div className="space-y-1.5">
            <Label>Industry *</Label>
            <Select
              value={form.business_industry ?? "INSURANCE"}
              onValueChange={(v) => set("business_industry", v as TrustHubRegistrationFormInput["business_industry"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRUST_HUB_BUSINESS_INDUSTRIES.map((ind) => (
                  <SelectItem key={ind} value={ind}>{ind.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="th-ein">EIN (Federal Tax ID) *</Label>
            <Input
              id="th-ein"
              inputMode="numeric"
              autoComplete="off"
              placeholder="12-3456789"
              value={form.ein}
              onChange={(e) => set("ein", e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">9 digits — dashes OK</p>
            <FieldError msg={fieldErrors.ein} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="th-web">Business website</Label>
            <Input
              id="th-web"
              placeholder="https://www.youragency.com"
              value={form.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Business Address */}
      <div className="rounded-xl border border-border/60 p-4 space-y-4">
        <p className="text-sm font-semibold text-foreground">Business Address</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="th-street">Street address *</Label>
            <Input
              id="th-street"
              value={form.address_street}
              onChange={(e) => set("address_street", e.target.value)}
              placeholder="123 Main St"
            />
            <FieldError msg={fieldErrors.address_street} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="th-city">City *</Label>
            <Input id="th-city" value={form.address_city} onChange={(e) => set("address_city", e.target.value)} placeholder="Dallas" />
            <FieldError msg={fieldErrors.address_city} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="th-state">State *</Label>
              <Input
                id="th-state"
                maxLength={2}
                placeholder="TX"
                value={form.address_state}
                onChange={(e) => set("address_state", e.target.value.toUpperCase())}
              />
              <FieldError msg={fieldErrors.address_state} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="th-zip">ZIP *</Label>
              <Input id="th-zip" value={form.address_zip} onChange={(e) => set("address_zip", e.target.value)} placeholder="75201" />
              <FieldError msg={fieldErrors.address_zip} />
            </div>
          </div>
        </div>
      </div>

      {/* Authorized Representative */}
      <div className="rounded-xl border border-border/60 p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Authorized Representative</p>
          <p className="text-xs text-muted-foreground mt-0.5">The person legally authorized to represent your business to Twilio.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="th-fn">First name *</Label>
            <Input id="th-fn" value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} />
            <FieldError msg={fieldErrors.contact_first_name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="th-ln">Last name *</Label>
            <Input id="th-ln" value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} />
            <FieldError msg={fieldErrors.contact_last_name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="th-title">Job title</Label>
            <Input id="th-title" value={form.contact_title ?? ""} onChange={(e) => set("contact_title", e.target.value)} placeholder="Owner, CEO, Principal Agent" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="th-phone">Business phone *</Label>
            <Input
              id="th-phone"
              placeholder="+15551234567"
              value={form.contact_phone}
              onChange={(e) => set("contact_phone", e.target.value)}
            />
            <FieldError msg={fieldErrors.contact_phone} />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="th-email">Business email *</Label>
            <Input
              id="th-email"
              type="email"
              value={form.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
              placeholder="you@youragency.com"
            />
            <FieldError msg={fieldErrors.contact_email} />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-1">
        <Button type="button" disabled={registering} onClick={() => void handleRegister()} className="px-6">
          {registering ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : "Submit to Twilio Trust Hub"}
        </Button>
        <p className="text-xs text-muted-foreground">Twilio reviews submissions within 1–5 business days.</p>
      </div>
    </div>
  );
};
