import React, { useState } from "react";
import { Activity, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EmptyState from "@/components/control-center/EmptyState";
import HealthChecksTable from "@/components/control-center/health/HealthChecksTable";
import HealthCheckFormModal from "@/components/control-center/health/HealthCheckFormModal";
import RunChecksButton from "@/components/control-center/health/RunChecksButton";
import {
  useControlCenterHealthChecks,
  useDeleteControlCenterHealthCheck,
  useRecentHealthCheckRuns,
} from "@/hooks/useControlCenterHealthChecks";
import type { ControlCenterHealthCheck } from "@/lib/control-center/types";

const ControlCenterHealthPage: React.FC = () => {
  const { data, isLoading } = useControlCenterHealthChecks();
  const runsQ = useRecentHealthCheckRuns(10);
  const deleteMut = useDeleteControlCenterHealthCheck();
  const checks = data ?? [];
  const runs = runsQ.data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ControlCenterHealthCheck | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ControlCenterHealthCheck | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (c: ControlCenterHealthCheck) => {
    setEditing(c);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("Health check deleted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast.error(msg);
    } finally {
      setPendingDelete(null);
    }
  };

  const checkNameById = new Map(checks.map((c) => [c.id, c.name] as const));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Health Checks</h1>
          <p className="text-sm text-slate-400">
            Registry of probes. Live execution is not wired in v1; status is manual.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RunChecksButton checks={checks} />
          <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            Add check
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading health checks…</div>
      ) : checks.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title="No health checks registered yet"
          description="Add the first check to populate the registry. v1 records manual status only — no live probes."
          action={
            <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add check
            </Button>
          }
        />
      ) : (
        <HealthChecksTable checks={checks} onEdit={openEdit} onDelete={setPendingDelete} />
      )}

      {runs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Recent runs
          </h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
            {runs.map((r) => (
              <div key={r.id} className="px-4 py-2.5 text-sm flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-slate-200 truncate">
                    {checkNameById.get(r.health_check_id) ?? r.health_check_id}
                  </div>
                  {r.result_summary && (
                    <div className="text-xs text-slate-500 truncate">{r.result_summary}</div>
                  )}
                </div>
                <div className="text-xs text-slate-500 whitespace-nowrap">
                  {new Date(r.started_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <HealthCheckFormModal open={modalOpen} onOpenChange={setModalOpen} check={editing} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-slate-950 text-slate-100 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete health check?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.name && (
                <strong className="text-slate-200">{pendingDelete.name}</strong>
              )}{" "}
              and all of its run history will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ControlCenterHealthPage;
