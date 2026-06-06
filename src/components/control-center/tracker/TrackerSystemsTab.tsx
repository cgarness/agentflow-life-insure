import React, { useMemo, useState } from "react";
import { Boxes, Plus, Search } from "lucide-react";
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
import TrackerSystemsTable from "@/components/control-center/tracker/TrackerSystemsTable";
import SystemCard from "@/components/control-center/tracker/cards/SystemCard";
import TrackerSystemFormModal from "@/components/control-center/tracker/TrackerSystemFormModal";
import TrackerIssueFormModal, {
  type IssuePreset,
} from "@/components/control-center/tracker/TrackerIssueFormModal";
import { useDeleteTrackerSystem } from "@/hooks/useControlCenterTracker";
import {
  TRACKER_MARKETABLE_LABELS,
  TRACKER_MARKETABLE_STATUSES,
  TRACKER_PRIORITIES,
  TRACKER_PRIORITY_LABELS,
  TRACKER_STATUSES,
  TRACKER_STATUS_LABELS,
  type TrackerItem,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

const ANY = "__any__";

interface Props {
  systems: TrackerSystem[];
  items: TrackerItem[];
  completionBySystem: Map<string, number>;
  openIssuesBySystem: Map<string, number>;
}

const TrackerSystemsTab: React.FC<Props> = ({
  systems,
  items,
  completionBySystem,
  openIssuesBySystem,
}) => {
  const deleteMut = useDeleteTrackerSystem();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrackerSystem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrackerSystem | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuePreset, setIssuePreset] = useState<IssuePreset | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ANY);
  const [priorityFilter, setPriorityFilter] = useState(ANY);
  const [marketableFilter, setMarketableFilter] = useState(ANY);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return systems.filter((s) => {
      if (statusFilter !== ANY && s.status !== statusFilter) return false;
      if (priorityFilter !== ANY && s.priority !== priorityFilter) return false;
      if (marketableFilter !== ANY && s.marketable_status !== marketableFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.system_key.toLowerCase().includes(q) ||
        (s.plain_english_summary?.toLowerCase().includes(q) ?? false) ||
        (s.owner?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [systems, statusFilter, priorityFilter, marketableFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (s: TrackerSystem) => {
    setEditing(s);
    setModalOpen(true);
  };
  const openAddIssue = (s: TrackerSystem) => {
    setIssuePreset({ system_id: s.id });
    setIssueOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("System deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-slate-400">
          Major systems in AgentFlow, with derived completion and open-issue counts.
        </p>
        <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add system
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, key, summary…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {TRACKER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRACKER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All priorities</SelectItem>
            {TRACKER_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {TRACKER_PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={marketableFilter} onValueChange={setMarketableFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Marketable" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All marketable</SelectItem>
            {TRACKER_MARKETABLE_STATUSES.map((m) => (
              <SelectItem key={m} value={m}>
                {TRACKER_MARKETABLE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {systems.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="No systems tracked yet"
          description="Add the first system to start tracking launch readiness."
          action={
            <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add system
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No systems match these filters" description="Try clearing the search or filters." />
      ) : (
        <>
          <div className="hidden md:block">
            <TrackerSystemsTable
              systems={filtered}
              completionBySystem={completionBySystem}
              openIssuesBySystem={openIssuesBySystem}
              onEdit={openEdit}
              onAddIssue={openAddIssue}
              onDelete={setPendingDelete}
            />
          </div>
          <div className="md:hidden space-y-3">
            {filtered.map((s) => (
              <SystemCard
                key={s.id}
                system={s}
                completion={completionBySystem.get(s.id) ?? 0}
                openIssues={openIssuesBySystem.get(s.id) ?? 0}
                onEdit={openEdit}
                onAddIssue={openAddIssue}
              />
            ))}
          </div>
        </>
      )}

      <TrackerSystemFormModal open={modalOpen} onOpenChange={setModalOpen} system={editing} />
      <TrackerIssueFormModal
        open={issueOpen}
        onOpenChange={setIssueOpen}
        issue={null}
        systems={systems}
        items={items}
        preset={issuePreset}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-slate-950 text-slate-100 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete system?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.name && (
                <strong className="text-slate-200">{pendingDelete.name}</strong>
              )}{" "}
              and all its items will be permanently removed. Linked issues stay but lose the
              system reference.
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

export default TrackerSystemsTab;
