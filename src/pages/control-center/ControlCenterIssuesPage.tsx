import React, { useMemo, useState } from "react";
import { AlertOctagon, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EmptyState from "@/components/control-center/EmptyState";
import IssueTable from "@/components/control-center/issues/IssueTable";
import IssueFormModal from "@/components/control-center/issues/IssueFormModal";
import {
  useControlCenterIssues,
  useDeleteControlCenterIssue,
} from "@/hooks/useControlCenterIssues";
import { useControlCenterFeatures } from "@/hooks/useControlCenterFeatures";
import {
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABELS,
  ISSUE_SOURCES,
  ISSUE_SOURCE_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
} from "@/lib/control-center/constants";
import type { ControlCenterIssue } from "@/lib/control-center/types";

const ANY = "__any__";

const ControlCenterIssuesPage: React.FC = () => {
  const issuesQ = useControlCenterIssues();
  const featuresQ = useControlCenterFeatures();
  const deleteMut = useDeleteControlCenterIssue();
  const issues = issuesQ.data ?? [];
  const features = featuresQ.data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ControlCenterIssue | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ControlCenterIssue | null>(null);

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>(ANY);
  const [statusFilter, setStatusFilter] = useState<string>(ANY);
  const [sourceFilter, setSourceFilter] = useState<string>(ANY);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((i) => {
      if (severityFilter !== ANY && i.severity !== severityFilter) return false;
      if (statusFilter !== ANY && i.status !== statusFilter) return false;
      if (sourceFilter !== ANY && i.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        (i.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [issues, severityFilter, statusFilter, sourceFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (i: ControlCenterIssue) => {
    setEditing(i);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("Issue deleted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast.error(msg);
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Issue Tracker</h1>
          <p className="text-sm text-slate-400">
            Broken areas, known problems, blockers, and risks.
          </p>
        </div>
        <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add issue
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or description…"
            className="pl-9"
          />
        </div>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All severities</SelectItem>
            {ISSUE_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {ISSUE_SEVERITY_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {ISSUE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ISSUE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All sources</SelectItem>
            {ISSUE_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {ISSUE_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {issuesQ.isLoading ? (
        <div className="text-sm text-slate-500">Loading issues…</div>
      ) : issues.length === 0 ? (
        <EmptyState
          icon={<AlertOctagon className="h-8 w-8" />}
          title="No issues tracked yet"
          description="Log the first issue to start tracking severity, status, and source."
          action={
            <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add issue
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No issues match these filters"
          description="Try clearing the search or selecting different filters."
        />
      ) : (
        <IssueTable
          issues={filtered}
          features={features}
          onEdit={openEdit}
          onDelete={setPendingDelete}
        />
      )}

      <IssueFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        issue={editing}
        features={features}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-slate-950 text-slate-100 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete issue?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.title && (
                <strong className="text-slate-200">{pendingDelete.title}</strong>
              )}{" "}
              will be permanently removed.
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

export default ControlCenterIssuesPage;
