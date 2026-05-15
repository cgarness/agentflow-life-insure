import React, { useState } from "react";
import { Plus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { workflowFolderApi } from "@/lib/supabase-workflow-folders";
import type { WorkflowFolderRow, WorkflowRow } from "@/lib/workflow-types";
import NewFolderModal from "./NewFolderModal";

export const ALL_TAB = "__all__";
export const UNFILED_TAB = "__unfiled__";

interface Props {
  folders: WorkflowFolderRow[];
  workflows: WorkflowRow[];
  organizationId: string;
  activeFolderId: string;
  onActiveChange: (id: string) => void;
  onFoldersChanged: () => void;
}

const WorkflowFolderTabs: React.FC<Props> = ({
  folders, workflows, organizationId, activeFolderId, onActiveChange, onFoldersChanged,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowFolderRow | null>(null);

  const unfiledCount = workflows.filter((w) => !w.folder_id).length;
  const countFor = (id: string) => workflows.filter((w) => w.folder_id === id).length;

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (folder: WorkflowFolderRow) => { setEditing(folder); setModalOpen(true); };

  const handleSubmit = async (input: { name: string; color: string }) => {
    if (editing) {
      await workflowFolderApi.update(editing.id, input);
      toast({ title: "Folder updated" });
    } else {
      await workflowFolderApi.create({ ...input, organization_id: organizationId });
      toast({ title: "Folder created" });
    }
    onFoldersChanged();
  };

  const handleDelete = async (folder: WorkflowFolderRow) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Workflows will be moved to Unfiled.`)) return;
    try {
      await workflowFolderApi.delete(folder.id);
      toast({ title: "Folder deleted" });
      if (activeFolderId === folder.id) onActiveChange(ALL_TAB);
      onFoldersChanged();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to delete folder", variant: "destructive" });
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <TabPill
          active={activeFolderId === ALL_TAB}
          onClick={() => onActiveChange(ALL_TAB)}
          label="All"
          count={workflows.length}
        />
        <TabPill
          active={activeFolderId === UNFILED_TAB}
          onClick={() => onActiveChange(UNFILED_TAB)}
          label="Unfiled"
          count={unfiledCount}
        />
        {folders.map((f) => (
          <div key={f.id} className="flex items-center">
            <TabPill
              active={activeFolderId === f.id}
              onClick={() => onActiveChange(f.id)}
              label={f.name}
              count={countFor(f.id)}
              color={f.color ?? undefined}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`${f.name} menu`}
                  className="-ml-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(f)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDelete(f)} className="text-rose-500 focus:text-rose-500">
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-3 w-3" /> New folder
        </button>
      </div>

      <NewFolderModal
        open={modalOpen}
        initial={editing}
        onOpenChange={setModalOpen}
        onSubmit={handleSubmit}
      />
    </>
  );
};

const TabPill: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}> = ({ active, onClick, label, count, color }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground"
        : "bg-card/60 text-foreground hover:bg-accent"
    }`}
  >
    {color && (
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    )}
    {label}
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
      active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-accent/60 text-muted-foreground"
    }`}>{count}</span>
  </button>
);

export default WorkflowFolderTabs;
