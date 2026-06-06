import React, { useMemo, useState } from "react";
import { ListChecks, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import TrackerItemsTable from "@/components/control-center/tracker/TrackerItemsTable";
import ItemCard from "@/components/control-center/tracker/cards/ItemCard";
import TrackerItemFormModal from "@/components/control-center/tracker/TrackerItemFormModal";
import TrackerIssueFormModal, {
  type IssuePreset,
} from "@/components/control-center/tracker/TrackerIssueFormModal";
import { useDeleteTrackerItem } from "@/hooks/useControlCenterTracker";
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
  systemNameById: Map<string, string>;
}

const TrackerItemsTab: React.FC<Props> = ({ systems, items, systemNameById }) => {
  const deleteMut = useDeleteTrackerItem();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrackerItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrackerItem | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuePreset, setIssuePreset] = useState<IssuePreset | null>(null);

  const [search, setSearch] = useState("");
  const [systemFilter, setSystemFilter] = useState(ANY);
  const [statusFilter, setStatusFilter] = useState(ANY);
  const [priorityFilter, setPriorityFilter] = useState(ANY);
  const [marketableFilter, setMarketableFilter] = useState(ANY);
  const [prodCriticalOnly, setProdCriticalOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (systemFilter !== ANY && i.system_id !== systemFilter) return false;
      if (statusFilter !== ANY && i.status !== statusFilter) return false;
      if (priorityFilter !== ANY && i.priority !== priorityFilter) return false;
      if (marketableFilter !== ANY && i.marketable_status !== marketableFilter) return false;
      if (prodCriticalOnly && !i.production_critical) return false;
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        i.item_key.toLowerCase().includes(q) ||
        (i.description?.toLowerCase().includes(q) ?? false) ||
        (i.source_of_truth?.toLowerCase().includes(q) ?? false) ||
        (i.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, systemFilter, statusFilter, priorityFilter, marketableFilter, prodCriticalOnly, search]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (i: TrackerItem) => {
    setEditing(i);
    setModalOpen(true);
  };
  const openAddIssue = (i: TrackerItem) => {
    setIssuePreset({ system_id: i.system_id, item_id: i.id });
    setIssueOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("Item deleted");
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
          Concrete capabilities inside each system. {items.length} tracked.
        </p>
        <Button
          onClick={openCreate}
          disabled={systems.length === 0}
          className="bg-sky-600 hover:bg-sky-500 text-white"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add item
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="md:col-span-3 lg:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, source…"
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
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <Select value={marketableFilter} onValueChange={setMarketableFilter}>
          <SelectTrigger className="w-44">
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
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <Switch checked={prodCriticalOnly} onCheckedChange={setProdCriticalOnly} />
          Production critical only
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="No items tracked yet"
          description={
            systems.length === 0
              ? "Add a system first, then add items to it."
              : "Add the first item to a system."
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No items match these filters" description="Try clearing the search or filters." />
      ) : (
        <>
          <div className="hidden md:block">
            <TrackerItemsTable
              items={filtered}
              systemNameById={systemNameById}
              onEdit={openEdit}
              onAddIssue={openAddIssue}
              onDelete={setPendingDelete}
            />
          </div>
          <div className="md:hidden space-y-3">
            {filtered.map((i) => (
              <ItemCard
                key={i.id}
                item={i}
                systemName={systemNameById.get(i.system_id) ?? "—"}
                onEdit={openEdit}
                onAddIssue={openAddIssue}
              />
            ))}
          </div>
        </>
      )}

      <TrackerItemFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        item={editing}
        systems={systems}
      />
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
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.title && (
                <strong className="text-slate-200">{pendingDelete.title}</strong>
              )}{" "}
              will be permanently removed. Linked issues stay but lose the item reference.
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

export default TrackerItemsTab;
