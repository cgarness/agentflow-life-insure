import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronRight, Flag, Loader2, Phone, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CarrierReputationPanel } from "@/components/settings/phone/CarrierReputationPanel";
import { AGENTFLOW_SUPABASE_PROJECT_REF } from "@/config/supabaseProject";

type PhoneNumber = {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  status: string | null;
  spam_status: string | null;
  spam_score: number | null;
  spam_checked_at: string | null;
  attestation_level: string | null;
  carrier_reputation_data: unknown;
  daily_call_count: number | null;
  daily_call_limit: number | null;
  created_at: string | null;
  last_outbound_shaken_stir: string | null;
};

const normStatus = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "_");

const getAttestationBadge = (level: string | null) => {
  switch (level?.toUpperCase()) {
    case "A":
      return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">A</Badge>;
    case "B":
      return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">B</Badge>;
    case "C":
      return <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30">C</Badge>;
    default:
      return <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30">Unknown</Badge>;
  }
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

const getSpamLikelyLabel = (status: string | null): { text: string; variant: "yes" | "maybe" | "no" | "unknown" } => {
  const n = normStatus(status);
  if (n === "flagged") return { text: "High", variant: "yes" };
  if (n === "at_risk") return { text: "Medium", variant: "maybe" };
  if (n === "clean") return { text: "Low", variant: "no" };
  if (n === "insufficient_data") return { text: "Unknown", variant: "unknown" };
  if (n === "evaluating") return { text: "Evaluating", variant: "unknown" };
  return { text: "Unknown", variant: "unknown" };
};

const spamLikelyBadge = (status: string | null) => {
  const { text, variant } = getSpamLikelyLabel(status);
  if (variant === "no") {
    return (
      <Badge
        className="h-6 w-6 justify-center border-emerald-500/30 bg-emerald-500/15 px-0 text-emerald-700 dark:text-emerald-400"
        title={`${text} spam likelihood`}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="sr-only">{text}</span>
      </Badge>
    );
  }
  if (variant === "maybe") {
    return (
      <Badge
        className="h-6 w-6 justify-center border-amber-500/30 bg-amber-500/15 px-0 text-amber-800 dark:text-amber-400"
        title={`${text} spam likelihood`}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="sr-only">{text}</span>
      </Badge>
    );
  }
  if (variant === "yes") {
    return (
      <Badge
        className="h-6 w-6 justify-center border-red-500/30 bg-red-500/15 px-0 text-red-700 dark:text-red-400"
        title={`${text} spam likelihood`}
      >
        <Flag className="h-3.5 w-3.5" />
        <span className="sr-only">{text}</span>
      </Badge>
    );
  }
  return (
    <Badge
      className="h-6 w-6 justify-center border-slate-500/30 bg-slate-500/15 px-0 text-slate-600 dark:text-slate-400"
      title={`${text} spam likelihood`}
    >
      <span className="text-xs font-semibold">?</span>
      <span className="sr-only">{text}</span>
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
  if (s === "A" || s === "B" || s === "C") return s;
  const word = s.match(/\b([ABC])\b/);
  if (word) return word[1]!;
  const letters = s.replace(/[^ABC]/g, "");
  if (letters.includes("A")) return "A";
  if (letters.includes("B")) return "B";
  if (letters.includes("C")) return "C";
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
  if (signal === "good") {
    return (
      <Badge
        className="h-6 w-6 justify-center border-emerald-500/30 bg-emerald-500/15 px-0 text-emerald-700 dark:text-emerald-400"
        title="Check"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="sr-only">Check</span>
      </Badge>
    );
  }
  if (signal === "warning") {
    return (
      <Badge
        className="h-6 w-6 justify-center border-amber-500/30 bg-amber-500/15 px-0 text-amber-800 dark:text-amber-400"
        title="Warning"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="sr-only">Warning</span>
      </Badge>
    );
  }
  if (signal === "bad") {
    return (
      <Badge
        className="h-6 w-6 justify-center border-red-500/30 bg-red-500/15 px-0 text-red-700 dark:text-red-400"
        title="Flag"
      >
        <Flag className="h-3.5 w-3.5" />
        <span className="sr-only">Flag</span>
      </Badge>
    );
  }
  return (
    <Badge
      className="h-6 w-6 justify-center border-slate-500/30 bg-slate-500/15 px-0 text-slate-600 dark:text-slate-400"
      title="Unknown"
    >
      <span className="text-xs font-semibold">?</span>
      <span className="sr-only">Unknown</span>
    </Badge>
  );
}

const NumberReputation: React.FC = () => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [bulkScanning, setBulkScanning] = useState(false);
  const [scanningIds, setScanningIds] = useState<string[]>([]);

  const { data: phoneNumbers, refetch, isLoading } = useQuery({
    queryKey: ["phone-numbers-reputation"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("phone_numbers")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const phoneRows = (data as PhoneNumber[]) ?? [];
      if (phoneRows.length === 0) return phoneRows;

      const numbers = phoneRows.map((row) => row.phone_number);
      const { data: callsData, error: callsError } = await supabase
        .from("calls")
        .select("caller_id_used, direction, created_at, shaken_stir")
        .in("caller_id_used", numbers)
        .order("created_at", { ascending: false })
        .limit(500);
      if (callsError) {
        console.warn("[NumberReputation] unable to load calls attestation:", callsError.message);
      }

      const lastOutboundByNumber = new Map<string, string | null>();
      for (const call of callsData ?? []) {
        const callerId = call.caller_id_used;
        if (!callerId || lastOutboundByNumber.has(callerId)) continue;
        if (!isOutboundDirection(call.direction)) continue;
        lastOutboundByNumber.set(callerId, normalizeAttestationLetter(call.shaken_stir));
      }

      return phoneRows.map((row) => ({
        ...row,
        last_outbound_shaken_stir: lastOutboundByNumber.get(row.phone_number) ?? null,
      }));
    },
  });

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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

  const handleCheckAll = async () => {
    if (!phoneNumbers?.length) return;
    setBulkScanning(true);
    try {
      let ok = 0;
      for (let i = 0; i < phoneNumbers.length; i++) {
        const n = phoneNumbers[i];
        setScanningIds([n.id]);
        await new Promise((r) => setTimeout(r, 200));
        try {
          await withClientTimeout(
            invokeReputationCheck(n.phone_number),
            CHECK_TIMEOUT_MS,
            "Check timed out after 90 seconds. Twilio may still be compiling this report — refresh in a minute.",
          );
          ok++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`${n.phone_number}: ${msg}`);
        }
      }
      toast.success(ok === phoneNumbers.length ? "All lines scanned." : `Scanned ${ok} of ${phoneNumbers.length} lines (see errors).`);
      await refetch();
    } finally {
      setBulkScanning(false);
      setScanningIds([]);
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
      toast.error(msg);
    } finally {
      setScanningIds([]);
      await refetch();
    }
  };

  const busy = bulkScanning || scanningIds.length > 0;

  if (!isLoading && (!phoneNumbers || phoneNumbers.length === 0)) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Number reputation</h3>
          <p className="text-sm text-muted-foreground">
            One place to watch caller ID health, attestation, and spam labeling signals.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <Phone className="mb-4 h-12 w-12 text-muted-foreground" />
          <h4 className="mb-1 text-lg font-semibold text-foreground">No active numbers</h4>
          <p className="mb-4 max-w-sm text-sm text-muted-foreground">
            Add Twilio numbers under Phone System to monitor reputation here.
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Number reputation</h3>
          <p className="text-sm text-muted-foreground">
            Clean table view of your caller ID reputation, attestation, and carrier signals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={busy}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" onClick={handleCheckAll} disabled={busy || !phoneNumbers?.length}>
            {bulkScanning ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Scanning all…
              </>
            ) : (
              <>
                <Shield className="mr-1 h-4 w-4" /> Scan all lines
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-r from-sky-50 via-blue-50 to-indigo-50 text-slate-700 dark:from-accent/60 dark:via-accent/50 dark:to-accent/40 dark:text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3 text-left font-medium">Phone number</th>
                <th className="px-3 py-3 text-left font-medium">Attestation</th>
                <th className="px-3 py-3 text-left font-medium">Spam likely</th>
                <th className="px-3 py-3 text-left font-medium">AT&amp;T</th>
                <th className="px-3 py-3 text-left font-medium">Verizon</th>
                <th className="px-3 py-3 text-left font-medium">T-Mobile</th>
                <th className="px-3 py-3 text-left font-medium">Last check</th>
                <th className="px-3 py-3 text-left font-medium">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-border">
              {phoneNumbers?.map((num) => {
                const expanded = expandedRows.has(num.id);
                const scanning = scanningIds.includes(num.id);
                const attestation =
                  normalizeAttestationLetter(num.last_outbound_shaken_stir) ??
                  getAttestationFromLatestTwilio(num.carrier_reputation_data, num.attestation_level);
                return (
                  <React.Fragment key={num.id}>
                    <motion.tr
                      onClick={() => toggleRow(num.id)}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-sky-50/70 dark:hover:bg-accent/30",
                        scanning && "bg-cyan-500/[0.07]",
                      )}
                      animate={
                        scanning
                          ? {
                              boxShadow: [
                                "inset 0 0 0 0 rgba(34,211,238,0)",
                                "inset 0 0 0 1px rgba(34,211,238,0.45)",
                                "inset 0 0 0 0 rgba(34,211,238,0)",
                              ],
                            }
                          : {}
                      }
                      transition={scanning ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : {}}
                    >
                      <td className="relative px-3 py-3 align-middle">
                        <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </motion.div>
                        {scanning && (
                          <motion.div
                            className="pointer-events-none absolute left-2 h-9 w-1 rounded-full bg-gradient-to-b from-transparent via-cyan-400 to-transparent opacity-90 motion-reduce:hidden"
                            animate={{ top: ["10%", "62%", "10%"] }}
                            transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
                          />
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-foreground">{num.phone_number}</td>
                      <td className="px-3 py-3">{getAttestationBadge(attestation)}</td>
                      <td className="px-3 py-3">{spamLikelyBadge(num.spam_status)}</td>
                      <td className="px-3 py-3">{carrierBadge(getCarrierSignal(num.carrier_reputation_data, "AT&T"))}</td>
                      <td className="px-3 py-3">{carrierBadge(getCarrierSignal(num.carrier_reputation_data, "Verizon"))}</td>
                      <td className="px-3 py-3">{carrierBadge(getCarrierSignal(num.carrier_reputation_data, "T-Mobile"))}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {num.spam_checked_at
                          ? formatDistanceToNow(new Date(num.spam_checked_at), { addSuffix: true })
                          : "Never"}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="font-mono text-xs"
                          disabled={busy}
                          onClick={() => handleCheckOne(num.id, num.phone_number)}
                        >
                          {scanning ? (
                            <>
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              Scanning
                            </>
                          ) : (
                            "Check"
                          )}
                        </Button>
                      </td>
                    </motion.tr>

                    <AnimatePresence>
                      {expanded && (
                        <tr>
                          <td colSpan={9} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22 }}
                              className="overflow-hidden border-t border-slate-200 bg-slate-50/70 dark:border-border dark:bg-accent/20"
                            >
                              <div className="px-5 py-4">
                                <CarrierReputationPanel data={num.carrier_reputation_data} />
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default NumberReputation;
