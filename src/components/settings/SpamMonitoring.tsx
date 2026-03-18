import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  RefreshCw, Radar, ChevronRight, Phone, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

type PhoneNumber = {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  status: string | null;
  spam_status: string | null;
  spam_score: number | null;
  spam_checked_at: string | null;
  attestation_level: string | null;
  carrier_reputation_data: any;
  daily_call_count: number | null;
  daily_call_limit: number | null;
  area_code: string | null;
  created_at: string | null;
};

const getSpamBadge = (status: string | null) => {
  switch (status?.toLowerCase()) {
    case "clean":
      return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20">Clean</Badge>;
    case "at_risk":
    case "at risk":
      return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20">At Risk</Badge>;
    case "flagged":
      return <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/20">Flagged</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">Unknown</Badge>;
  }
};

const getAttestationBadge = (level: string | null) => {
  switch (level?.toUpperCase()) {
    case "A":
      return <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">🟢 Full (A)</span>;
    case "B":
      return <span className="text-xs font-medium text-amber-600 dark:text-amber-400">🟡 Partial (B)</span>;
    case "C":
      return <span className="text-xs font-medium text-orange-600 dark:text-orange-400">🟠 Gateway (C)</span>;
    default:
      return <span className="text-xs font-medium text-red-600 dark:text-red-400">🔴 None</span>;
  }
};

const getHealthBadge = (spamStatus: string | null, callCount: number, callLimit: number) => {
  const pct = callLimit > 0 ? (callCount / callLimit) * 100 : 0;
  const isFlagged = spamStatus?.toLowerCase() === "flagged";
  const isAtRisk = spamStatus?.toLowerCase() === "at_risk" || spamStatus?.toLowerCase() === "at risk";

  if (isFlagged || pct >= 80) {
    return <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30">🔴 Critical</Badge>;
  }
  if (isAtRisk || pct >= 50) {
    return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">🟡 Warning</Badge>;
  }
  return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">🟢 Healthy</Badge>;
};

const SpamMonitoring: React.FC = () => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [scanningIndex, setScanningIndex] = useState<number | null>(null);

  const { data: phoneNumbers, refetch, isLoading } = useQuery({
    queryKey: ["phone-numbers-spam"],
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

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCheckSpamNow = async () => {
    if (!phoneNumbers?.length) return;
    setIsScanning(true);

    for (let i = 0; i < phoneNumbers.length; i++) {
      setScanningIndex(i);
      await new Promise((r) => setTimeout(r, 300));
    }
    setScanningIndex(null);

    const { error } = await supabase.functions.invoke("spam-check-cron");
    if (error) {
      toast.error("Failed to check spam status");
    } else {
      toast.success("Spam check completed! Refreshing data...");
      refetch();
    }
    setIsScanning(false);
  };

  const cleanCount = phoneNumbers?.filter((p) => p.spam_status?.toLowerCase() === "clean").length ?? 0;
  const atRiskCount = phoneNumbers?.filter((p) => ["at_risk", "at risk"].includes(p.spam_status?.toLowerCase() ?? "")).length ?? 0;
  const flaggedCount = phoneNumbers?.filter((p) => p.spam_status?.toLowerCase() === "flagged").length ?? 0;

  // Empty state
  if (!isLoading && (!phoneNumbers || phoneNumbers.length === 0)) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Spam Monitoring</h3>
        <div className="flex flex-col items-center justify-center py-16 text-center bg-card border rounded-xl">
          <Phone className="w-12 h-12 text-muted-foreground mb-4" />
          <h4 className="text-lg font-semibold text-foreground mb-1">No Phone Numbers Yet</h4>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Add phone numbers in Phone Management to start monitoring spam reputation.
          </p>
          <Button variant="outline" onClick={() => {
            const params = new URLSearchParams(window.location.search);
            params.set("section", "phone-system");
            window.history.replaceState(null, "", `?${params.toString()}`);
            window.location.reload();
          }}>
            Add Phone Number
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Radar className="w-5 h-5 text-primary" /> Spam Monitoring
          </h3>
          <p className="text-sm text-muted-foreground">Monitor phone number reputation and carrier blocking rates</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isScanning}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={handleCheckSpamNow} disabled={isScanning}>
            {isScanning ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Scanning...</> : "Check Spam Now"}
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="flex flex-wrap gap-4">
        {[
          { label: "Clean", count: cleanCount, color: "bg-emerald-500" },
          { label: "At Risk", count: atRiskCount, color: "bg-amber-500" },
          { label: "Flagged", count: flaggedCount, color: "bg-red-500" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm text-foreground">
            <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
            <span className="font-medium">{s.count}</span>
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-accent/50 text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3 text-left font-medium">Phone Number</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-left font-medium">Score</th>
                <th className="px-3 py-3 text-left font-medium">Attestation</th>
                <th className="px-3 py-3 text-left font-medium">Calls Today</th>
                <th className="px-3 py-3 text-left font-medium">Limit</th>
                <th className="px-3 py-3 text-left font-medium">Last Checked</th>
                <th className="px-3 py-3 text-left font-medium">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {phoneNumbers?.map((num, idx) => {
                const isExpanded = expandedRows.has(num.id);
                const callCount = num.daily_call_count ?? 0;
                const callLimit = num.daily_call_limit ?? 100;
                const callPct = callLimit > 0 ? Math.min((callCount / callLimit) * 100, 100) : 0;
                const score = num.spam_score ?? 0;
                const isScanningRow = isScanning && scanningIndex === idx;
                const carrierData = num.carrier_reputation_data as any;

                return (
                  <React.Fragment key={num.id}>
                    <motion.tr
                      onClick={() => toggleRow(num.id)}
                      className="cursor-pointer hover:bg-accent/30 transition-colors"
                      animate={isScanningRow ? { backgroundColor: ["hsl(var(--card))", "hsl(142 76% 36% / 0.15)", "hsl(var(--card))"] } : {}}
                      transition={isScanningRow ? { duration: 0.6, ease: "easeInOut" } : {}}
                    >
                      <td className="px-3 py-3">
                        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </motion.div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-foreground">{num.phone_number}</td>
                      <td className="px-3 py-3">{getSpamBadge(num.spam_status)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium w-6">{score}</span>
                          <Progress value={score} className="h-1.5 w-16" />
                        </div>
                      </td>
                      <td className="px-3 py-3">{getAttestationBadge(num.attestation_level)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{callCount}</span>
                          <Progress value={callPct} className="h-1.5 w-12" />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{callLimit}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {num.spam_checked_at
                          ? formatDistanceToNow(new Date(num.spam_checked_at), { addSuffix: true })
                          : "Never"}
                      </td>
                      <td className="px-3 py-3">{getHealthBadge(num.spam_status, callCount, callLimit)}</td>
                    </motion.tr>

                    {/* Expanded row */}
                    <AnimatePresence>
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 py-4 bg-accent/20 border-t">
                                <CarrierDetails data={carrierData} />
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

const CarrierDetails: React.FC<{ data: any }> = ({ data }) => {
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No carrier data available. Run spam check to get detailed carrier breakdown.
      </p>
    );
  }

  const carriers = data.carriers || data.carrier_results;
  const networkAnalysis = data.network_analysis;

  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold text-foreground">Carrier Analysis</h5>
      {carriers && Array.isArray(carriers) ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {carriers.map((c: any, i: number) => (
            <div key={i} className="bg-card border rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground capitalize">{c.name || c.carrier || "Unknown"}</span>
                {c.blocking_rate != null && (
                  <Badge className={c.blocking_rate > 5
                    ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
                    : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  }>
                    {c.blocking_rate}% blocked
                  </Badge>
                )}
              </div>
              {c.spam_label && <p className="text-xs text-red-500 font-medium">{c.spam_label}</p>}
              {c.completion_rate != null && (
                <p className="text-xs text-muted-foreground">Completion: {c.completion_rate}%</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No carrier breakdown available.</p>
      )}

      {networkAnalysis && (
        <div className="pt-2">
          <h5 className="text-sm font-semibold text-foreground mb-2">Network Analysis</h5>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Calls", value: networkAnalysis.total_calls },
              { label: "Flagged Calls", value: networkAnalysis.flagged_calls },
              { label: "Avg Answer Rate", value: networkAnalysis.average_answer_rate != null ? `${networkAnalysis.average_answer_rate}%` : "N/A" },
            ].map((s) => (
              <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SpamMonitoring;
