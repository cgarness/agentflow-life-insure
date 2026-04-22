import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Loader2, Phone, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ReputationAiScanner } from "@/components/settings/number-reputation/ReputationAiScanner";
import { CarrierReputationPanel } from "@/components/settings/phone/CarrierReputationPanel";

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
};

const normStatus = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "_");

const getAttestationBadge = (level: string | null) => {
  switch (level?.toUpperCase()) {
    case "A":
      return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">A</Badge>;
    case "B":
      return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">B</Badge>;
    case "C":
      return <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30">C</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">Unknown</Badge>;
  }
};

const getSpamLikelyLabel = (status: string | null): { text: string; variant: "yes" | "maybe" | "no" | "unknown" } => {
  const n = normStatus(status);
  if (n === "flagged") return { text: "Yes", variant: "yes" };
  if (n === "at_risk") return { text: "Elevated", variant: "maybe" };
  if (n === "clean") return { text: "No", variant: "no" };
  if (n === "insufficient_data") return { text: "Unknown", variant: "unknown" };
  if (n === "evaluating") return { text: "Evaluating", variant: "unknown" };
  return { text: "Unknown", variant: "unknown" };
};

const spamLikelyBadge = (status: string | null) => {
  const { text, variant } = getSpamLikelyLabel(status);
  const cls =
    variant === "yes"
      ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
      : variant === "maybe"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
        : variant === "no"
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
          : "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30";
  return (
    <Badge className={cn("border", cls)} title="Carrier spam labels are partial; Unknown means not enough signal yet.">
      {text}
    </Badge>
  );
};

/** Overall 0–100 health: prefer stored spam_score; else derive from status + daily volume. */
function computeHealthScore(row: PhoneNumber): { score: number; label: "Good" | "Watch" | "Action" } {
  if (row.spam_score != null && !Number.isNaN(row.spam_score)) {
    const s = Math.max(0, Math.min(100, row.spam_score));
    return {
      score: s,
      label: s >= 80 ? "Good" : s >= 60 ? "Watch" : "Action",
    };
  }
  const n = normStatus(row.spam_status);
  const callCount = row.daily_call_count ?? 0;
  const callLimit = row.daily_call_limit ?? 100;
  const pct = callLimit > 0 ? (callCount / callLimit) * 100 : 0;
  if (n === "flagged" || pct >= 85) return { score: 42, label: "Action" };
  if (n === "at_risk" || pct >= 55) return { score: 68, label: "Watch" };
  if (n === "clean") return { score: 92, label: "Good" };
  if (n === "insufficient_data") return { score: 72, label: "Watch" };
  if (n === "evaluating") return { score: 70, label: "Watch" };
  return { score: 65, label: "Watch" };
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
      return data as PhoneNumber[];
    },
  });

  const activeCount = phoneNumbers?.length ?? 0;

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

  const invokeReputationCheck = async (e164: string) => {
    const { data, error } = await supabase.functions.invoke<ReputationFnResponse>("twilio-reputation-check", {
      body: { phone_number: e164 },
    });
    if (error) throw new Error(error.message);
    const payload = data as ReputationFnResponse | null;
    if (payload?.error) {
      const err = payload.error;
      throw new Error(typeof err === "string" ? err : JSON.stringify(err));
    }
    return payload;
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
          await invokeReputationCheck(n.phone_number);
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
      const payload = await invokeReputationCheck(e164);
      toast.success(payload?.message ?? `Updated ${e164}`);
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Check failed";
      toast.error(msg);
    } finally {
      setScanningIds([]);
    }
  };

  const busy = bulkScanning || scanningIds.length > 0;

  if (!isLoading && (!phoneNumbers || phoneNumbers.length === 0)) {
    return (
      <div className="space-y-5">
        <ReputationAiScanner activeLineCount={0} />
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
      <ReputationAiScanner activeLineCount={activeCount} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Number reputation</h3>
          <p className="text-sm text-muted-foreground">
            Checks call Twilio Voice Insights (7-day window). Each line allows up to three checks per UTC day (Super
            Admin: unlimited). A scan can take up to a minute while Twilio builds the report.
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

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-accent/50 text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3 text-left font-medium">Phone number</th>
                <th className="px-3 py-3 text-left font-medium">Health</th>
                <th className="px-3 py-3 text-left font-medium">Attestation</th>
                <th className="px-3 py-3 text-left font-medium">Spam likely</th>
                <th className="px-3 py-3 text-left font-medium">Last check</th>
                <th className="px-3 py-3 text-left font-medium">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {phoneNumbers?.map((num) => {
                const expanded = expandedRows.has(num.id);
                const scanning = scanningIds.includes(num.id);
                const health = computeHealthScore(num);
                return (
                  <React.Fragment key={num.id}>
                    <motion.tr
                      onClick={() => toggleRow(num.id)}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-accent/30",
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
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <span className="text-sm font-semibold tabular-nums">{health.score}</span>
                          <Badge
                            className={cn(
                              "w-fit border text-xs",
                              health.label === "Good" &&
                                "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                              health.label === "Watch" &&
                                "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400",
                              health.label === "Action" &&
                                "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
                            )}
                          >
                            {health.label}
                          </Badge>
                          <Progress value={health.score} className="hidden h-1.5 w-20 sm:block md:w-28" />
                        </div>
                      </td>
                      <td className="px-3 py-3">{getAttestationBadge(num.attestation_level)}</td>
                      <td className="px-3 py-3">{spamLikelyBadge(num.spam_status)}</td>
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
                          <td colSpan={7} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22 }}
                              className="overflow-hidden border-t border-border bg-accent/20"
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
