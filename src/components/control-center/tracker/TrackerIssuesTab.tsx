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
import TrackerIssuesTable from "@/components/control-center/tracker/TrackerIssuesTable";
import IssueCard from "@/components/control-center/tracker/cards/IssueCard";
import TrackerIssueFormModal from "@/components/control-center/tracker/TrackerIssueFormModal";
import { useDeleteTrackerIssue } from "@/hooks/useControlCenterTracker";
import {
  TRACKER_ISSUE_SEVERITIES,
  TRACKER_ISSUE_SEVERITY_LABELS,
  TRACKER_ISSUE_STATUS_LABELS,
  TRACKER_ISSUE_STATUSES,
  type TrackerIssue,
  type TrackerItem,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

const ANY = "__any__";

interface Props {
  systems: TrackerSystem[];
  items: TrackerItem[];
  issues: TrackerIssue[];
  systemNameById: Map<string, string>;
}

const TrackerIssuesTab: React.FC<Props> = ({ systems, items, issues, systemNameById }) => {
  const deleteMut = useDeleteTrackerIssue();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrackerIssue | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrackerIssue | null>(null);

  const [search, setSearch] = useState("");
  const [systemFilter, setSystemFilter] = useState(ANY);
  const [severityFilter, setSeverityFilter] = useState(ANY);
  const [statusFilter, setStatusFilter] = useState(ANY);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((i) => {
      if (systemFilter !== ANY && i.system_id !== systemFilter) return false;
      if (severityFilter !== ANY && i.severity !== severityFilter) return false;
      if (statusFilter !== ANY && i.status !== statusFilter) return false;
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        i.issue_key.toLowerCase().includes(q) ||
        (i.description?.toLowerCase().includes(q) ?? false) ||
        (i.next_action?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [issues, systemFilter, severityFilter, statusFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (i: TrackerIssue) => {
    setEditing(i);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("Issue deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-400">Launch blockers and defects. {issues.length} tracked.</p>
        <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add issue
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, next action…"
            className="pl-9"
          />
        </div>
        <Select value={systemFilter} onValueChange={setSystemFilter}>
          <SelectTrigger>
            <SelectValue placeholder="System" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All systems</SelectItem>
            {systems.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All severities</SelectItem>
            {TRACKER_ISSUE_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRACKER_ISSUE_SEVERITY_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-full md:w-56">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All statuses</SelectItem>
          {TRACKER_ISSUE_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {TRACKER_ISSUE_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {issues.length === 0 ? (
        <EmptyState
          icon={<AlertOctagon className="h-8 w-8" />}
          title="No issues tracked yet"
          description="Log a launch blocker or defect to start tracking it."
          action={
            <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add issue
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No issues match these filters" description="Try clearing the search or filters." />
      ) : (
        <>
          <div className="hidden md:block">
            <TrackerIssuesTable
              issues={filtered}
              systemNameById={systemNameById}
              onEdit={openEdit}
              onDelete={setPendingDelete}
            />
          </div>
          <div className="md:hidden space-y-3">
            {filtered.map((i) => (
              <IssueCard
                key={i.id}
                issue={i}
                systemName={i.system_id ? systemNameById.get(i.system_id) ?? null : null}
                onEdit={openEdit}
                onDelete={setPendingDelete}
              />
            ))}
          </div>
        </>
      )}

      <TrackerIssueFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        issue={editing}
        systems={systems}
        items={items}
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

export default TrackerIssuesTab;
