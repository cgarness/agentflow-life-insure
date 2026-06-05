import React, { useMemo, useState } from "react";
import { Megaphone, Plus, Search } from "lucide-react";
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
import TrackerMarketingTable from "@/components/control-center/tracker/TrackerMarketingTable";
import MarketingClaimCard from "@/components/control-center/tracker/cards/MarketingClaimCard";
import TrackerMarketingClaimFormModal from "@/components/control-center/tracker/TrackerMarketingClaimFormModal";
import { useDeleteTrackerClaim } from "@/hooks/useControlCenterTracker";
import {
  TRACKER_ACTION_NEEDED_LABELS,
  TRACKER_ACTIONS_NEEDED,
  TRACKER_PRIORITIES,
  TRACKER_PRIORITY_LABELS,
  TRACKER_REALITY_STATUS_LABELS,
  TRACKER_REALITY_STATUSES,
  type TrackerMarketingClaim,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

const ANY = "__any__";

interface Props {
  systems: TrackerSystem[];
  claims: TrackerMarketingClaim[];
}

const TrackerMarketingRealityTab: React.FC<Props> = ({ systems, claims }) => {
  const deleteMut = useDeleteTrackerClaim();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrackerMarketingClaim | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TrackerMarketingClaim | null>(null);

  const [search, setSearch] = useState("");
  const [realityFilter, setRealityFilter] = useState(ANY);
  const [actionFilter, setActionFilter] = useState(ANY);
  const [priorityFilter, setPriorityFilter] = useState(ANY);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return claims.filter((c) => {
      if (realityFilter !== ANY && c.reality_status !== realityFilter) return false;
      if (actionFilter !== ANY && c.action_needed !== actionFilter) return false;
      if (priorityFilter !== ANY && c.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        c.feature_claim.toLowerCase().includes(q) ||
        c.claim_key.toLowerCase().includes(q) ||
        (c.marketed_location?.toLowerCase().includes(q) ?? false) ||
        (c.notes?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [claims, realityFilter, actionFilter, priorityFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (c: TrackerMarketingClaim) => {
    setEditing(c);
    setModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success("Claim deleted");
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
          What we market vs. what actually ships. Non-accurate rows are highlighted.
        </p>
        <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
          <Plus className="h-4 w-4 mr-1.5" />
          Add claim
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search claim, location, notes…"
            className="pl-9"
          />
        </div>
        <Select value={realityFilter} onValueChange={setRealityFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Reality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All reality</SelectItem>
            {TRACKER_REALITY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRACKER_REALITY_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All actions</SelectItem>
            {TRACKER_ACTIONS_NEEDED.map((a) => (
              <SelectItem key={a} value={a}>
                {TRACKER_ACTION_NEEDED_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Select value={priorityFilter} onValueChange={setPriorityFilter}>
        <SelectTrigger className="w-full md:w-56">
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

      {claims.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-8 w-8" />}
          title="No marketing claims tracked yet"
          description="Add a claim to compare marketing copy against shipped reality."
          action={
            <Button onClick={openCreate} className="bg-sky-600 hover:bg-sky-500 text-white">
              <Plus className="h-4 w-4 mr-1.5" />
              Add claim
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No claims match these filters" description="Try clearing the search or filters." />
      ) : (
        <>
          <div className="hidden md:block">
            <TrackerMarketingTable
              claims={filtered}
              onEdit={openEdit}
              onDelete={setPendingDelete}
            />
          </div>
          <div className="md:hidden space-y-3">
            {filtered.map((c) => (
              <MarketingClaimCard
                key={c.id}
                claim={c}
                onEdit={openEdit}
                onDelete={setPendingDelete}
              />
            ))}
          </div>
        </>
      )}

      <TrackerMarketingClaimFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        claim={editing}
        systems={systems}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-slate-950 text-slate-100 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete claim?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete?.feature_claim && (
                <strong className="text-slate-200">{pendingDelete.feature_claim}</strong>
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

export default TrackerMarketingRealityTab;
