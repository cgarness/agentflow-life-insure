import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, formatDistanceStrict } from "date-fns";
import { ChevronDown, X, AlertTriangle, CheckCircle2, Clock, Loader2, MinusCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { workflowExecutionApi } from "@/lib/supabase-workflows";
import { actionMeta, type WorkflowExecutionRow, type WorkflowExecutionStepRow, type ActionType } from "@/lib/workflow-types";

interface Props {
  open: boolean;
  workflowId: string;
  onClose: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  running: "bg-blue-500/15 text-blue-500",
  completed: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-rose-500/15 text-rose-500",
  paused: "bg-yellow-500/15 text-yellow-500",
  pending: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"}`}>
    {status}
  </span>
);

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "failed": return <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />;
    case "running": return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case "paused": return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
    case "skipped": return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const WorkflowExecutionLog: React.FC<Props> = ({ open, workflowId, onClose }) => {
  const [executions, setExecutions] = useState<WorkflowExecutionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, WorkflowExecutionStepRow[]>>({});

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const ex = await workflowExecutionApi.listForWorkflow(workflowId, 50);
      setExecutions(ex);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load executions";
      toast({ title: msg, variant: "destructive" });
    } finally { setLoading(false); }
  }, [open, workflowId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (executionId: string) => {
    if (expandedId === executionId) { setExpandedId(null); return; }
    setExpandedId(executionId);
    if (!steps[executionId]) {
      try {
        const s = await workflowExecutionApi.listSteps(executionId);
        setSteps((prev) => ({ ...prev, [executionId]: s }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load steps";
        toast({ title: msg, variant: "destructive" });
      }
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <motion.aside
            initial={{ x: 480, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0 }}
            transition={{ type: "tween", duration: 0.25 }}
            className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-border/50 bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border/50 p-4">
              <h3 className="text-base font-semibold text-foreground">Execution Log</h3>
              <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-accent/40" />)}
                </div>
              ) : executions.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">No executions yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {executions.map((ex) => (
                    <li key={ex.id} className="rounded-lg border border-border/40 bg-background/40">
                      <button
                        type="button"
                        onClick={() => toggle(ex.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30"
                      >
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedId === ex.id ? "rotate-180" : ""}`} />
                        <StatusBadge status={ex.status} />
                        <span className="flex-1 truncate text-xs text-foreground">
                          {ex.contact_type ?? "contact"} · {ex.contact_id?.slice(0, 8) ?? "—"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(ex.started_at), "MMM d, HH:mm")}
                        </span>
                      </button>
                      {expandedId === ex.id && (
                        <ExecutionSteps execution={ex} steps={steps[ex.id]} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

const ExecutionSteps: React.FC<{ execution: WorkflowExecutionRow; steps?: WorkflowExecutionStepRow[] }> = ({ execution, steps }) => (
  <div className="border-t border-border/40 px-3 py-2">
    <div className="mb-2 text-[11px] text-muted-foreground">
      Started {format(new Date(execution.started_at), "MMM d, yyyy HH:mm:ss")} ·{" "}
      {execution.completed_at ? `Completed ${format(new Date(execution.completed_at), "HH:mm:ss")}` : "Running…"}
    </div>
    {execution.error_message && (
      <div className="mb-2 rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-500">
        {execution.error_message}
      </div>
    )}
    {!steps ? (
      <p className="py-2 text-xs text-muted-foreground">Loading steps…</p>
    ) : steps.length === 0 ? (
      <p className="py-2 text-xs text-muted-foreground">No step records.</p>
    ) : (
      <ul className="space-y-1.5">
        {steps.map((s) => <StepRow key={s.id} step={s} />)}
      </ul>
    )}
  </div>
);

const StepRow: React.FC<{ step: WorkflowExecutionStepRow }> = ({ step }) => {
  const out = step.output_data as { action_type?: ActionType; reason?: string; error?: string } | null;
  const meta = actionMeta(out?.action_type);
  const Icon = meta?.icon;
  const dur = step.completed_at && step.started_at
    ? formatDistanceStrict(new Date(step.completed_at), new Date(step.started_at))
    : null;
  const summary = (() => {
    if (step.status === "skipped" && out?.reason) return out.reason;
    if (step.status === "failed" && out?.error) return out.error;
    if (out?.action_type) return meta?.label ?? out.action_type;
    return "Step";
  })();
  return (
    <li className="flex items-center gap-2 rounded bg-background/40 px-2 py-1.5">
      <StatusIcon status={step.status} />
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`flex-1 truncate text-[11px] ${step.status === "failed" ? "text-rose-500" : step.status === "skipped" ? "text-muted-foreground" : "text-foreground"}`}>
        {summary}
      </span>
      {dur && <span className="text-[10px] text-muted-foreground">{dur}</span>}
    </li>
  );
};

export default WorkflowExecutionLog;
