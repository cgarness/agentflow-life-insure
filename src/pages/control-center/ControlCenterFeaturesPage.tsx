import React, { useMemo, useState } from "react";
import { ListChecks, Plus, Search } from "lucide-react";
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
import FeatureTable from "@/components/control-center/features/FeatureTable";
import FeatureFormModal from "@/components/control-center/features/FeatureFormModal";
import {
  useControlCenterFeatures,
  useDeleteControlCenterFeature,
} from "@/hooks/useControlCenterFeatures";
import {
  FEATURE_PRIORITIES,
  FEATURE_PRIORITY_LABELS,
  FEATURE_STATUSES,
  FEATURE_STATUS_LABELS,
} from "@/lib/control-center/constants";
import type { ControlCenterFeature } from "@/lib/control-center/types";

const ANY = "__any__";

const ControlCenterFeaturesPage: React.FC = () => {
  const { data, isLoading } = useControlCenterFeatures();
  const deleteMut = useDeleteControlCenterFeature();
  const features = data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ControlCenterFeature | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ControlCenterFeature | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ANY);
  const [priorityFilter, setPriorityFilter] = useState<string>(ANY);
  const [categoryFilter, setCategoryFilter] = useState<string>(ANY);

  const categories = useMemo(() => {
    const set = new Set<string>();
    features.forEach((f) => set.add(f.category));
    return Array.from(set).sort();
  }, [features]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return features.filter((f) => {
      if (statusFilter !== ANY && f.status !== statusFilter) return false;
      if (priorityFilter !== ANY && f.priority !== priorityFilter) return false;
      if (categoryFilter !== ANY && f.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.feature_key.toLowerCase().includes(q) ||
        (f.description?.toLowerCase().includes(q) ?? false) ||
        (f.owner?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [features, statusFilter, priorityFilter, categoryFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (f: ControlCenterFeature) => {
    setEditing(f);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("Feature deleted");
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
          <h1 className="text-2xl font-semibold text-slate-100">Feature Tracker</h1>
          <p className="text-sm text-slate-400">Build status across the platform.</p>
        </div>
        <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add feature
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, key, owner…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {FEATURE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {FEATURE_STATUS_LABELS[s]}
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
            {FEATURE_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {FEATURE_PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {categories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 uppercase tracking-wider">Category:</span>
          <button
            type="button"
            onClick={() => setCategoryFilter(ANY)}
            className={`text-xs px-2 py-1 rounded ${
              categoryFilter === ANY
                ? "bg-slate-700 text-slate-100"
                : "bg-slate-900 text-slate-400 hover:bg-slate-800"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoryFilter(c)}
              className={`text-xs px-2 py-1 rounded ${
                categoryFilter === c
                  ? "bg-slate-700 text-slate-100"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading features…</div>
      ) : features.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="No features tracked yet"
          description="Add the first feature to start tracking build status, ownership, and priorities."
          action={
            <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add feature
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No features match these filters"
          description="Try clearing the search or selecting different filters."
        />
      ) : (
        <FeatureTable features={filtered} onEdit={openEdit} onDelete={setPendingDelete} />
      )}

      <FeatureFormModal open={modalOpen} onOpenChange={setModalOpen} feature={editing} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-slate-950 text-slate-100 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete feature?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.name && <strong className="text-slate-200">{pendingDelete.name}</strong>}{" "}
              will be permanently removed. Linked issues stay but lose the feature reference.
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

export default ControlCenterFeaturesPage;
