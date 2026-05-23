import React from "react";
import { FileText, Plus, Search, MoreVertical, Loader2, Copy, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PRODUCT_TYPES } from "./callScriptSchema";
import { productBadgeClass } from "./callScriptConstants";
import { timeAgo } from "./callScriptUtils";
import type { Script } from "./callScriptTypes";

interface CallScriptsListProps {
  scripts: Script[];
  filtered: Script[];
  selectedId: string | null;
  search: string;
  filterType: string;
  loading: boolean;
  canManage: boolean;
  renamingId: string | null;
  renameValue: string;
  renameError: string | null;
  renameRef: React.RefObject<HTMLInputElement>;
  onSearchChange: (v: string) => void;
  onFilterChange: (v: string) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRenameValueChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameStart: (id: string) => void;
  onToggleActive: (id: string, current: boolean) => void;
  onDuplicate: (id: string) => void;
  onRequestDelete: (s: Script) => void;
}

export const CallScriptsList: React.FC<CallScriptsListProps> = ({
  scripts,
  filtered,
  selectedId,
  search,
  filterType,
  loading,
  canManage,
  renamingId,
  renameValue,
  renameError,
  renameRef,
  onSearchChange,
  onFilterChange,
  onSelect,
  onAdd,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  onToggleActive,
  onDuplicate,
  onRequestDelete,
}) => {
  return (
    <div className="w-[35%] border-r flex flex-col">
      <div className="p-3 space-y-2 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search scripts..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 bg-accent"
          />
        </div>
        <Select value={filterType} onValueChange={onFilterChange}>
          <SelectTrigger className="h-9 bg-accent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {PRODUCT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto min-h-[400px]">
        {loading && scripts.length > 0 ? (
          <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : scripts.length === 0 && !search && filterType === "all" ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              {canManage ? "No scripts yet. Click Add Script to get started." : "No scripts available yet."}
            </p>
            {canManage && (
              <Button size="sm" onClick={onAdd} className="gap-2">
                <Plus className="w-4 h-4" /> Add Script
              </Button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <Search className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No scripts match your search. Try adjusting your filters.</p>
          </div>
        ) : (
          filtered.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b sidebar-transition ${selectedId === s.id ? "bg-primary/10" : "hover:bg-accent/50"
                } ${!s.active ? "opacity-50" : ""}`}
            >
              <div className="flex-1 min-w-0">
                {canManage && renamingId === s.id ? (
                  <>
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={(e) => onRenameValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onRenameCommit();
                        if (e.key === "Escape") onRenameCancel();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      maxLength={60}
                      className={`text-sm font-semibold bg-accent text-foreground rounded px-2 py-0.5 w-full border focus:outline-none focus:ring-1 ${renameError ? "border-destructive focus:ring-destructive" : "focus:ring-primary"}`}
                    />
                    {renameError && <p className="text-[11px] text-destructive mt-0.5">{renameError}</p>}
                  </>
                ) : (
                  <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${productBadgeClass[s.productType]}`}>
                    {s.productType}
                  </span>
                  <span className="text-[11px] text-muted-foreground min-w-max shrink-0">{timeAgo(s.updatedAt)}</span>
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={s.active}
                    onCheckedChange={() => onToggleActive(s.id, s.active)}
                    className="scale-75"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded hover:bg-accent">
                        <MoreVertical className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onRenameStart(s.id)}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit Name
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDuplicate(s.id)}>
                        <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRequestDelete(s)} className="text-destructive focus:text-destructive">
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
