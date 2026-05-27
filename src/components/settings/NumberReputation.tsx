import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Flag, Loader2, Phone, Globe, ShieldCheck, Zap, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AGENTFLOW_SUPABASE_PROJECT_REF } from "@/config/supabaseProject";
import { ReputationAiScanner } from "./number-reputation/ReputationAiScanner";
import { useOrganization } from "@/hooks/useOrganization";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

type PhoneNumber = {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  status: string | null;
  spam_status: string | null;
  spam_score: number | null;
  spam_checked_at: string | null;
  attestation_level: string | null;
  /** Signing tier from Twilio Trust Hub SHAKEN/STIR Trust Product (filled on reputation check). */
  shaken_stir_attestation: string | null;
  carrier_reputation_data: unknown;
  daily_call_count: number | null;
  daily_call_limit: number | null;
  created_at: string | null;
  last_outbound_shaken_stir: string | null;
  calls_today: number;
};

const normStatus = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "_");

const getAttestationBadge = (level: string | null) => {
  const l = level?.toUpperCase() || "U";
  const config = {
    A: { color: "emerald", label: "Full (A)", glow: "shadow-[0_0_12px_rgba(16,185,129,0.3)]" },
    B: { color: "amber", label: "Partial (B)", glow: "shadow-[0_0_12px_rgba(245,158,11,0.2)]" },
    C: { color: "red", label: "Gateway (C)", glow: "shadow-[0_0_12px_rgba(239,68,68,0.2)]" },
    U: { color: "slate", label: "Unknown (U)", glow: "" },
  }[l as "A" | "B" | "C" | "U"] || { color: "slate", label: "Unknown", glow: "" };

  return (
    <Badge
      variant="outline"
      className={cn(
        "px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase border-opacity-30",
        config.color === "emerald" && "bg-emerald-500/10 text-emerald-600 border-emerald-500 dark:text-emerald-400",
        config.color === "amber" && "bg-amber-500/10 text-amber-600 border-amber-500 dark:text-amber-400",
        config.color === "red" && "bg-red-500/10 text-red-600 border-red-500 dark:text-red-400",
        config.color === "slate" && "bg-slate-500/10 text-slate-600 border-slate-500 dark:text-slate-400",
        config.glow
      )}
    >
      {config.label}
    </Badge>
  );
};

/** Parse JSON body from FunctionsHttpError.context (non-2xx Edge responses). */
async function readEdgeFunctionErrorBody(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: Response })?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  try {
    const j = (await ctx.clone().json()) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof j.error === "string") parts.push(j.error);
    if (typeof j.detail === "string") parts.push(j.detail);
    if (typeof j.message === "string") parts.push(j.message);
    if (typeof j.step === "string") parts.push(`[${j.step}]`);
    if (j.code != null) parts.push(String(j.code));
    return parts.length ? parts.join(" — ") : null;
  } catch {
    return null;
  }
}

const getSpamLikelyLabel = (status: string | null): { text: string; variant: "yes" | "maybe" | "no" | "unknown" | "evaluating" | "insufficient" } => {
  const n = normStatus(status);
  if (n === "flagged" || n === "spam_likely") return { text: "High / Flagged", variant: "yes" };
  if (n === "at_risk" || n === "watch") return { text: "Medium / At Risk", variant: "maybe" };
  if (n === "clean" || n === "healthy") return { text: "Low / Clean", variant: "no" };
  if (n === "evaluating") return { text: "Evaluating", variant: "evaluating" };
  if (n === "insufficient_data" || n === "insufficient") return { text: "Insufficient Data", variant: "insufficient" };
  return { text: "Unknown", variant: "unknown" };
};

const spamLikelyBadge = (status: string | null) => {
  const { text, variant } = getSpamLikelyLabel(status);
  const common = "h-7 w-7 justify-center px-0 transition-all duration-300";
  
  if (variant === "no") {
    return (
      <Badge
        className={cn(common, "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 shadow-[0_0_10px_rgba(16,185,129,0.15)]")}
        title={`${text} spam likelihood: no strong negative signal found.`}
      >
        <CheckCircle2 className="h-4 w-4" />
      </Badge>
    );
  }
  if (variant === "maybe") {
    return (
      <Badge
        className={cn(common, "border-amber-500/30 bg-amber-500/10 text-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.15)]")}
        title={`${text} spam likelihood: possible risk signal.`}
      >
        <AlertTriangle className="h-4 w-4" />
      </Badge>
    );
  }
  if (variant === "yes") {
    return (
      <Badge
        className={cn(common, "border-red-500/30 bg-red-500/10 text-red-600 shadow-[0_0_10px_rgba(239,68,68,0.2)]")}
        title={`${text} spam likelihood: stronger negative signal.`}
      >
        <Flag className="h-4 w-4" />
      </Badge>
    );
  }
  if (variant === "evaluating") {
    return (
      <Badge
        className={cn(common, "border-blue-500/30 bg-blue-500/10 text-blue-500 animate-pulse")}
        title={`${text}: reputation check is in progress or recently requested.`}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
      </Badge>
    );
  }
  if (variant === "insufficient") {
    return (
      <Badge
        className={cn(common, "border-slate-400/30 bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400")}
        title={`${text}: not enough outbound calls for rating (normal).`}
      >
        <span className="text-[10px] font-bold font-mono">i</span>
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(common, "border-slate-500/30 bg-slate-500/10 text-slate-400")}
      title={`${text}: not checked yet or no usable signal.`}
    >
      <span className="text-xs font-bold font-mono">?</span>
    </Badge>
  );
};

type CarrierSignal = "good" | "warning" | "bad" | "unknown";
const CHECK_TIMEOUT_MS = 90_000;

function getAttestationFromLatestTwilio(data: unknown, fallback: string | null): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const computed = (d.computed ?? {}) as Record<string, unknown>;
  const metrics = (computed.metrics ?? {}) as Record<string, unknown>;
  const fromTwilio = metrics.attestation_level;
  if (typeof fromTwilio === "string" && fromTwilio.trim()) {
    return fromTwilio.trim().toUpperCase();
  }
  return fallback;
}

const OUTBOUND_DIRECTIONS = new Set([
  "outbound",
  "outgoing",
  "outgoing_dial",
  "dial_outbound",
]);

function normalizeAttestationLetter(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase().trim();
  if (s === "A" || s === "B" || s === "C" || s === "U") return s;
  const word = s.match(/\b([ABCU])\b/);
  if (word) return word[1]!;
  const letters = s.replace(/[^ABCU]/g, "");
  if (letters.includes("A")) return "A";
  if (letters.includes("B")) return "B";
  if (letters.includes("C")) return "C";
  if (letters.includes("U")) return "U";
  return null;
}

function isOutboundDirection(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = String(raw).toLowerCase().replace(/\s+/g, "_");
  return OUTBOUND_DIRECTIONS.has(normalized);
}

function getCarrierSignal(data: unknown, carrierName: "AT&T" | "Verizon" | "T-Mobile"): CarrierSignal {
  const d = (data ?? {}) as Record<string, unknown>;
  const carriers = (d.carriers ?? d.carrier_results) as unknown[] | undefined;
  if (!Array.isArray(carriers)) return "unknown";
  const key = carrierName.toLowerCase().replace("&", "");
  const hit = carriers.find((c) => {
    const row = c as Record<string, unknown>;
    const n = String(row.name ?? row.carrier ?? "").toLowerCase().replace("&", "");
    return n.includes(key) || (carrierName === "T-Mobile" && (n.includes("tmobile") || n.includes("t mobile")));
  }) as Record<string, unknown> | undefined;
  if (!hit) return "unknown";
  const label = String(hit.spam_label ?? "").toLowerCase();
  if (/flag|spam|block/.test(label)) return "bad";
  const blockingRate = Number(hit.blocking_rate);
  if (Number.isFinite(blockingRate)) {
    if (blockingRate > 5) return "bad";
    if (blockingRate >= 2) return "warning";
    return "good";
  }
  return "unknown";
}

function carrierBadge(signal: CarrierSignal) {
  const common = "h-7 w-7 justify-center px-0 transition-all duration-300";
  if (signal === "good") {
    return (
      <Badge
        className={cn(common, "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 shadow-[0_0_10px_rgba(16,185,129,0.15)]")}
        title="Check"
      >
        <CheckCircle2 className="h-4 w-4" />
      </Badge>
    );
  }
  if (signal === "warning") {
    return (
      <Badge
        className={cn(common, "border-amber-500/30 bg-amber-500/10 text-amber-600 shadow-[0_0_10px_rgba(245,158,11,0.15)]")}
        title="Warning"
      >
        <AlertTriangle className="h-4 w-4" />
      </Badge>
    );
  }
  if (signal === "bad") {
    return (
      <Badge
        className={cn(common, "border-red-500/30 bg-red-500/10 text-red-600 shadow-[0_0_10px_rgba(239,68,68,0.2)]")}
        title="Flag"
      >
        <Flag className="h-4 w-4" />
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(common, "border-slate-500/30 bg-slate-500/10 text-slate-400")}
      title="Unknown"
    >
      <span className="text-xs font-bold font-mono">?</span>
    </Badge>
  );
}

function sanitizeError(msg: string): string {
  let clean = msg;
  // Replace Supabase URL or project ref
  clean = clean.replace(/jncvvsvckxhqgqvkppmj/g, "[project]");
  clean = clean.replace(/https:\/\/[a-z0-9]+\.supabase\.co/gi, "[supabase]");
  // Remove raw tokens or JWTs (Bearer eyJ...)
  clean = clean.replace(/Bearer\s+[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_=]+\.?[a-zA-Z0-9-_.+/=]*/g, "Bearer [token]");
  // Remove inline API keys
  clean = clean.replace(/sbp_[a-zA-Z0-9]{40}/g, "[api_key]");
  // Clean up HTTP status errors to be readable
  if (clean.includes("FunctionsHttpError") || clean.includes("Edge Function")) {
    clean = "Reputation check service encountered an issue. Please try again in a few moments.";
  }
  return clean;
}

const NumberReputation: React.FC = () => {
  const [scanningIds, setScanningIds] = useState<string[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const { organizationId } = useOrganization();

  const { data: phoneNumbers, refetch, isLoading } = useQuery({
    queryKey: ["phone-numbers-reputation", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("phone_numbers")
        .select("*")
        .eq("status", "active")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const phoneRows = (data as PhoneNumber[]) ?? [];
      if (phoneRows.length === 0) return phoneRows;

      const numbers = phoneRows.map((row) => row.phone_number);
      const { data: callsData, error: callsError } = await supabase
        .from("calls")
        .select("caller_id_used, direction, created_at, shaken_stir")
        .eq("organization_id", organizationId)
        .in("caller_id_used", numbers)
        .order("created_at", { ascending: false })
        .limit(500);
      if (callsError) {
        console.warn("[NumberReputation] unable to load calls attestation:", callsError.message);
      }

      const lastOutboundByNumber = new Map<string, string | null>();
      const callsTodayByNumber = new Map<string, number>();
      const now = new Date();
      const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const localDayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      for (const call of callsData ?? []) {
        const callerId = call.caller_id_used;
        if (!callerId) continue;
        if (!isOutboundDirection(call.direction)) continue;
        const created = call.created_at ? new Date(call.created_at) : null;
        if (created && created >= localDayStart && created < localDayEnd) {
          callsTodayByNumber.set(callerId, (callsTodayByNumber.get(callerId) ?? 0) + 1);
        }
        if (lastOutboundByNumber.has(callerId)) continue;
        lastOutboundByNumber.set(callerId, normalizeAttestationLetter(call.shaken_stir));
      }

      return phoneRows.map((row) => ({
        ...row,
        last_outbound_shaken_stir: lastOutboundByNumber.get(row.phone_number) ?? null,
        calls_today: callsTodayByNumber.get(row.phone_number) ?? 0,
      }));
    },
  });

  type ReputationFnResponse = {
    success?: boolean;
    error?: string | Record<string, unknown>;
    message?: string;
    spam_status?: string;
    spam_score?: number | null;
  };

  /** Fresh user JWT for Edge. Avoids 401 when the cached session is stale. */
  const getAccessTokenForEdge = async (): Promise<string> => {
    const { data: refreshed, error: refErr } = await supabase.auth.refreshSession();
    const t = refreshed.session?.access_token;
    if (t) return t;
    if (refErr) console.warn("[NumberReputation] refreshSession:", refErr.message);
    const { data: { session }, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) throw new Error(sessErr.message);
    if (!session?.access_token) {
      throw new Error("Your session expired. Refresh the page and sign in again, then retry the check.");
    }
    return session.access_token;
  };

  const invokeReputationCheck = async (e164: string) => {
    const accessToken = await getAccessTokenForEdge();
    const { data, error } = await supabase.functions.invoke<ReputationFnResponse>("twilio-reputation-check", {
      body: { phone_number: e164 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      // Twilio report polling can run ~30–45s; default client timeouts are too short.
      timeout: 150_000,
    });
    if (error) {
      const bodyHint = await readEdgeFunctionErrorBody(error);
      const base = String(error.message || "");
      const combined = bodyHint ? `${base} (${bodyHint})` : base;
      const httpStatus = (error as { context?: Response }).context?.status;
      const is401 = httpStatus === 401;
      if (is401) {
        throw new Error(
          `${combined} — Confirm the request URL is ` +
            `https://${AGENTFLOW_SUPABASE_PROJECT_REF}.supabase.co/functions/v1/twilio-reputation-check. ` +
            `If the host is already correct, sign out and sign back in (stale session), then retry.`,
        );
      }
      if (/abort|timed?\s*out|timeout/i.test(base)) {
        throw new Error(
          "The reputation check took too long and was cancelled. Twilio is still building the report — wait ~1 minute and click Check again.",
        );
      }
      throw new Error(combined);
    }
    const payload = data as ReputationFnResponse | null;
    if (payload?.error) {
      const err = payload.error;
      throw new Error(typeof err === "string" ? err : JSON.stringify(err));
    }
    return payload;
  };

  const withClientTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const handleCheckOne = async (id: string, e164: string) => {
    setScanningIds([id]);
    try {
      const payload = await withClientTimeout(
        invokeReputationCheck(e164),
        CHECK_TIMEOUT_MS,
        "Check timed out after 90 seconds. Twilio may still be compiling this report — refresh in a minute.",
      );
      toast.success(payload?.message ?? `Updated ${e164}`);
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Check failed";
      toast.error(sanitizeError(msg));
    } finally {
      setScanningIds([]);
      await refetch();
    }
  };

  const busy = scanningIds.length > 0;

  if (!isLoading && (!phoneNumbers || phoneNumbers.length === 0)) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Number Reputation</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor caller ID health, attestation, spam-label signals, and recent outbound activity. These are signals, not guarantees.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <Phone className="mb-4 h-12 w-12 text-muted-foreground" />
          <h4 className="mb-1 text-lg font-semibold text-foreground">No active numbers</h4>
          <p className="mb-4 max-w-sm text-sm text-muted-foreground">
            Add phone numbers under Phone System to monitor reputation here.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams(window.location.search);
              params.set("section", "phone-system");
              window.history.replaceState(null, "", `?${params.toString()}`);
              window.location.reload();
            }}
          >
            Go to Phone System
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Number Reputation</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor caller ID health, attestation, spam-label signals, and recent outbound activity. These are signals, not guarantees.
          </p>
        </div>

        <ReputationAiScanner activeLineCount={phoneNumbers?.length || 0} />

        {/* Reputation Guide and Legend collapsible card */}
        <div className="rounded-xl border border-slate-200/60 bg-white/50 p-4 text-xs dark:border-white/10 dark:bg-[#0c1220]/80">
          <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setShowGuide(!showGuide)}>
            <div className="flex items-center gap-2 text-foreground font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Reputation Signal Guide &amp; Legend</span>
            </div>
            <span className="text-primary hover:underline text-[11px] font-semibold">{showGuide ? "Hide Guide" : "Show Guide"}</span>
          </div>
          {showGuide && (
            <div className="grid gap-4 sm:grid-cols-3 mt-3 pt-3 border-t border-border/40 text-muted-foreground animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Spam Heuristics</p>
                <ul className="space-y-1 pl-1 list-none">
                  <li><span className="font-medium text-emerald-600 dark:text-emerald-400">Low / Clean:</span> No strong negative signal.</li>
                  <li><span className="font-medium text-amber-600 dark:text-amber-400">Medium / At Risk:</span> Possible risk signal.</li>
                  <li><span className="font-medium text-red-600 dark:text-red-400">High / Flagged:</span> Strong negative signal.</li>
                  <li><span className="font-medium text-blue-500">Evaluating:</span> Scan in progress.</li>
                  <li><span className="font-medium text-slate-500">Insufficient Data:</span> Low outbound call volume (normal).</li>
                  <li><span className="font-medium text-slate-400">Unknown:</span> Check has not been run yet.</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Attestation (SHAKEN/STIR)</p>
                <ul className="space-y-1 pl-1 list-none">
                  <li><span className="font-bold text-foreground">A (Full):</span> Strongest identity confidence. verified caller and number.</li>
                  <li><span className="font-bold text-foreground">B (Partial):</span> Verified caller but not number association.</li>
                  <li><span className="font-bold text-foreground">C (Gateway):</span> Call routed via gateway; unverified identity.</li>
                  <li><span className="font-bold text-foreground">U (Unknown):</span> Insufficient data or unverified.</li>
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Network Specific Signals</p>
                <p className="leading-relaxed">
                  AT&amp;T, Verizon, and T-Mobile columns show specific spam-label reports when available. A missing or "?" signal is normal (especially for lower call volumes) and is <span className="font-semibold text-foreground">not</span> a negative reputation mark.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/50 shadow-xl shadow-slate-200/40 backdrop-blur-sm dark:border-white/10 dark:bg-[#0c1220]/80 dark:shadow-none">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.03] via-transparent to-cyan-500/[0.03]" />
          
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200/60 dark:border-white/10">
                  <th className="px-5 py-4 text-left font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-cyan-500" />
                      Phone number
                    </div>
                  </th>
                  <th className="px-4 py-4 text-left font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      Attestation
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] p-2 text-xs font-sans text-left">
                          <p className="font-semibold mb-1">SHAKEN/STIR Attestation Levels:</p>
                          <ul className="list-disc pl-3 space-y-1">
                            <li><strong>A (Full):</strong> Strongest identity confidence. verified caller and number.</li>
                            <li><strong>B (Partial):</strong> Verified caller but not number association.</li>
                            <li><strong>C (Gateway):</strong> Call routed via gateway; unverified identity.</li>
                            <li><strong>U (Unknown):</strong> Not enough data.</li>
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th className="px-4 py-4 text-left font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      Spam likely
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] p-2 text-xs font-sans text-left">
                          <p className="font-semibold mb-1">Spam Status Explanation:</p>
                          <ul className="list-disc pl-3 space-y-1">
                            <li><strong>Low / Clean:</strong> No strong negative signal.</li>
                            <li><strong>Medium / At Risk:</strong> Possible risk signal.</li>
                            <li><strong>High / Flagged:</strong> Strong negative signal.</li>
                            <li><strong>Evaluating:</strong> Reputation check is in progress.</li>
                            <li><strong>Insufficient Data:</strong> Low outbound volume. This is normal and NOT a negative mark.</li>
                            <li><strong>Unknown:</strong> Not checked yet.</li>
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th className="px-4 py-4 text-left font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 text-center">
                    Calls today
                  </th>
                  <th className="px-3 py-4 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex items-center justify-center gap-1">
                      AT&amp;T
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-2 text-xs font-sans text-left">
                          AT&amp;T network signal. A missing/unknown (?) signal is normal and NOT a negative mark.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th className="px-3 py-4 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex items-center justify-center gap-1">
                      Verizon
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-2 text-xs font-sans text-left">
                          Verizon network signal. A missing/unknown (?) signal is normal and NOT a negative mark.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th className="px-3 py-4 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    <div className="flex items-center justify-center gap-1">
                      T-Mobile
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[200px] p-2 text-xs font-sans text-left">
                          T-Mobile network signal. A missing/unknown (?) signal is normal and NOT a negative mark.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th className="px-4 py-4 text-left font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Last check
                  </th>
                  <th className="px-5 py-4 text-right font-mono text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {phoneNumbers?.map((num, idx) => {
                  const scanning = scanningIds.includes(num.id);
                  const attestation =
                    normalizeAttestationLetter(num.last_outbound_shaken_stir) ??
                    normalizeAttestationLetter(num.shaken_stir_attestation) ??
                    normalizeAttestationLetter(num.attestation_level) ??
                    getAttestationFromLatestTwilio(num.carrier_reputation_data, num.attestation_level);
                  
                  return (
                    <motion.tr
                      key={num.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05, duration: 0.3 }}
                      className={cn(
                        "group/row transition-all duration-300",
                        scanning ? "bg-cyan-500/[0.03] dark:bg-cyan-500/[0.05]" : "hover:bg-slate-50/50 dark:hover:bg-white/[0.02]"
                      )}
                    >
                      <td className="px-5 py-5">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-bold tracking-tight text-slate-900 dark:text-white">
                            {num.phone_number}
                          </span>
                          {num.friendly_name && (
                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                              {num.friendly_name}
                            </span>
                          )}
                          {scanning && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <motion.div
                                  className="h-full bg-cyan-400"
                                  animate={{ x: ["-100%", "100%"] }}
                                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                />
                              </div>
                              <span className="text-[10px] font-bold uppercase tracking-tighter text-cyan-500 animate-pulse">
                                Scanning...
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-5">{getAttestationBadge(attestation)}</td>
                      <td className="px-4 py-5">{spamLikelyBadge(num.spam_status)}</td>
                      <td className="px-4 py-5 text-center">
                        <div className="inline-flex items-center gap-1 rounded-full bg-slate-100/50 px-2.5 py-1 font-mono text-[11px] font-bold text-slate-700 dark:bg-white/5 dark:text-slate-300">
                          <Zap className={cn("h-3 w-3", num.calls_today > 0 ? "text-amber-500" : "text-slate-400")} />
                          {num.calls_today}
                        </div>
                      </td>
                      <td className="px-3 py-5 text-center">{carrierBadge(getCarrierSignal(num.carrier_reputation_data, "AT&T"))}</td>
                      <td className="px-3 py-5 text-center">{carrierBadge(getCarrierSignal(num.carrier_reputation_data, "Verizon"))}</td>
                      <td className="px-3 py-5 text-center">{carrierBadge(getCarrierSignal(num.carrier_reputation_data, "T-Mobile"))}</td>
                      <td className="px-4 py-5">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {num.spam_checked_at
                            ? formatDistanceToNow(new Date(num.spam_checked_at), { addSuffix: true })
                            : "Never"}
                        </span>
                      </td>
                      <td className="px-5 py-5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleCheckOne(num.id, num.phone_number)}
                          className={cn(
                            "h-8 border-slate-200 bg-white px-3 font-mono text-[10px] font-bold uppercase tracking-widest transition-all hover:border-cyan-500/50 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-cyan-500/10",
                            scanning && "border-cyan-400/50 bg-cyan-50 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400"
                          )}
                        >
                          {scanning ? (
                            <>
                              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                              Checking...
                            </>
                          ) : (
                            "Check"
                          )}
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default NumberReputation;
