import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  FileText, Plus, Search, MoreVertical, Bold, Italic, Underline,
  List, ListOrdered, Heading, ChevronDown, Eye, Pencil, Loader2, Copy, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

type ProductType = "Term Life" | "Whole Life" | "IUL" | "Final Expense" | "Annuities" | "Custom";

interface Script {
  id: string;
  name: string;
  productType: ProductType;
  active: boolean;
  content: string;
  modifiedAt: Date;
}

const PRODUCT_TYPES: ProductType[] = ["Term Life", "Whole Life", "IUL", "Final Expense", "Annuities", "Custom"];

const productBadgeClass: Record<ProductType, string> = {
  "Term Life": "bg-blue-500/15 text-blue-500 border-blue-500/30",
  "Whole Life": "bg-purple-500/15 text-purple-500 border-purple-500/30",
  "IUL": "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  "Final Expense": "bg-orange-500/15 text-orange-500 border-orange-500/30",
  "Annuities": "bg-green-500/15 text-green-500 border-green-500/30",
  "Custom": "bg-muted text-muted-foreground border-border",
};

const MERGE_FIELDS = [
  "{{contact_first_name}}",
  "{{contact_last_name}}",
  "{{agent_name}}",
  "{{product_name}}",
  "{{company_name}}",
];

const MERGE_PREVIEW: Record<string, string> = {
  "{{contact_first_name}}": "John",
  "{{contact_last_name}}": "Smith",
  "{{agent_name}}": "Chris",
  "{{product_name}}": "",
  "{{company_name}}": "AgentFlow",
};

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `Modified ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Modified ${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `Modified ${days} day${days > 1 ? "s" : ""} ago`;
}

function wordCount(text: string): number {
  const stripped = text.replace(/[#*_\->\[\]()]/g, "").trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

const CallScripts: React.FC = () => {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [editorContent, setEditorContent] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add script modal
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ProductType>("Term Life");
  const [newActive, setNewActive] = useState(true);
  const [newNameError, setNewNameError] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);

  // Unsaved changes dialog
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const selected = scripts.find((s) => s.id === selectedId) ?? null;

  // Filter & search
  const filtered = scripts.filter((s) => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || s.productType === filterType;
    return matchSearch && matchType;
  });

  const selectScript = useCallback(
    (id: string) => {
      if (editorDirty && selectedId && selectedId !== id) {
        setPendingSelect(id);
        return;
      }
      const s = scripts.find((x) => x.id === id);
      if (s) {
        setSelectedId(id);
        setEditorContent(s.content);
        setEditorDirty(false);
        setPreviewMode(false);
      }
    },
    [editorDirty, selectedId, scripts]
  );

  const confirmLeave = () => {
    if (pendingSelect) {
      const s = scripts.find((x) => x.id === pendingSelect);
      if (s) {
        setSelectedId(pendingSelect);
        setEditorContent(s.content);
        setEditorDirty(false);
        setPreviewMode(false);
      }
      setPendingSelect(null);
    }
  };

  // Add script
  const handleAdd = () => {
    if (!newName.trim()) {
      setNewNameError(true);
      return;
    }
    const s: Script = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      productType: newType,
      active: newActive,
      content: "",
      modifiedAt: new Date(),
    };
    setScripts((prev) => [s, ...prev]);
    setSelectedId(s.id);
    setEditorContent("");
    setEditorDirty(false);
    setPreviewMode(false);
    setAddOpen(false);
    setNewName("");
    setNewType("Term Life");
    setNewActive(true);
    toast({ title: "Script created", className: "bg-success text-success-foreground border-success" });
  };

  // Toggle active
  const toggleActive = (id: string) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !s.active, modifiedAt: new Date() } : s))
    );
    toast({ title: "Script updated", className: "bg-success text-success-foreground border-success" });
  };

  // Duplicate
  const duplicateScript = (id: string) => {
    const orig = scripts.find((s) => s.id === id);
    if (!orig) return;
    const dup: Script = {
      ...orig,
      id: crypto.randomUUID(),
      name: `${orig.name} — Copy`,
      modifiedAt: new Date(),
    };
    setScripts((prev) => [dup, ...prev]);
    setSelectedId(dup.id);
    setEditorContent(dup.content);
    setEditorDirty(false);
    setPreviewMode(false);
    toast({ title: "Script duplicated", className: "bg-success text-success-foreground border-success" });
  };

  // Delete
  const confirmDelete = () => {
    if (!deleteTarget) return;
    setScripts((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    if (selectedId === deleteTarget.id) {
      setSelectedId(null);
      setEditorContent("");
      setEditorDirty(false);
    }
    setDeleteTarget(null);
    toast({ title: "Script deleted", className: "bg-success text-success-foreground border-success" });
  };

  // Rename
  const startRename = (id: string) => {
    const s = scripts.find((x) => x.id === id);
    if (s) {
      setRenamingId(id);
      setRenameValue(s.name);
      setTimeout(() => renameRef.current?.focus(), 50);
    }
  };

  const commitRename = () => {
    if (!renamingId || !renameValue.trim()) return;
    setScripts((prev) =>
      prev.map((s) =>
        s.id === renamingId ? { ...s, name: renameValue.trim(), modifiedAt: new Date() } : s
      )
    );
    setRenamingId(null);
    toast({ title: "Script renamed", className: "bg-success text-success-foreground border-success" });
  };

  // Save
  const handleSave = () => {
    if (!selected) return;
    setSaving(true);
    setTimeout(() => {
      setScripts((prev) =>
        prev.map((s) =>
          s.id === selected.id ? { ...s, content: editorContent, modifiedAt: new Date() } : s
        )
      );
      setEditorDirty(false);
      setSaving(false);
      toast({ title: "Script saved successfully", className: "bg-success text-success-foreground border-success" });
    }, 800);
  };

  // Inline product type change
  const changeProductType = (id: string, pt: ProductType) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, productType: pt, modifiedAt: new Date() } : s))
    );
    setEditorDirty(true);
  };

  // Inline name change in editor header
  const changeEditorName = (name: string) => {
    if (!selected) return;
    setScripts((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, name, modifiedAt: new Date() } : s))
    );
    setEditorDirty(true);
  };

  // Insert merge field
  const insertMergeField = (field: string) => {
    const ta = editorRef.current;
    if (!ta) {
      setEditorContent((prev) => prev + field);
      setEditorDirty(true);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newContent = editorContent.slice(0, start) + field + editorContent.slice(end);
    setEditorContent(newContent);
    setEditorDirty(true);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + field.length;
    }, 0);
  };

  // Toolbar actions (simple markdown-style wrapping)
  const wrapSelection = (before: string, after: string) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selectedText = editorContent.slice(start, end);
    const newContent = editorContent.slice(0, start) + before + selectedText + after + editorContent.slice(end);
    setEditorContent(newContent);
    setEditorDirty(true);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + before.length;
      ta.selectionEnd = end + before.length;
    }, 0);
  };

  // Preview content
  const previewContent = editorContent.replace(/\{\{(\w+)\}\}/g, (match) => {
    if (match === "{{product_name}}" && selected) return selected.productType;
    return MERGE_PREVIEW[match] ?? match;
  });

  const wc = wordCount(editorContent);
  const readTime = (wc / 160).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Call Scripts</h3>
          <p className="text-sm text-muted-foreground">Write and manage scripts for your agents to use during calls</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add Script
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="bg-card rounded-xl border flex overflow-hidden" style={{ minHeight: 560 }}>
        {/* Left panel */}
        <div className="w-[35%] border-r flex flex-col">
          <div className="p-3 space-y-2 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search scripts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-accent"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
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

          <div className="flex-1 overflow-y-auto">
            {scripts.length === 0 && !search && filterType === "all" ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <FileText className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No scripts yet. Click Add Script to get started.</p>
                <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" /> Add Script
                </Button>
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
                  onClick={() => selectScript(s.id)}
                  className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b sidebar-transition ${
                    selectedId === s.id ? "bg-primary/10" : "hover:bg-accent/50"
                  } ${!s.active ? "opacity-50" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    {renamingId === s.id ? (
                      <input
                        ref={renameRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-semibold bg-accent text-foreground rounded px-2 py-0.5 w-full border focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${productBadgeClass[s.productType]}`}>
                        {s.productType}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{timeAgo(s.modifiedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={s.active}
                      onCheckedChange={() => toggleActive(s.id)}
                      className="scale-75"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-accent">
                          <MoreVertical className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => startRename(s.id)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> Edit Name
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicateScript(s.id)}>
                          <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(s)} className="text-destructive focus:text-destructive">
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[65%] flex flex-col">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Select a script from the list to view and edit it.</p>
            </div>
          ) : (
            <>
              {/* Editor header */}
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <input
                    value={selected.name}
                    onChange={(e) => changeEditorName(e.target.value)}
                    className="text-base font-semibold bg-transparent text-foreground border-0 focus:outline-none focus:ring-0 min-w-0 flex-1 truncate"
                    maxLength={60}
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className={`text-[11px] px-2 py-0.5 rounded border font-medium cursor-pointer hover:opacity-80 ${productBadgeClass[selected.productType]}`}>
                        {selected.productType} <ChevronDown className="w-3 h-3 inline ml-0.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-1">
                      {PRODUCT_TYPES.map((pt) => (
                        <button
                          key={pt}
                          onClick={() => changeProductType(selected.id, pt)}
                          className="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-accent text-foreground"
                        >
                          {pt}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-center bg-accent rounded-lg p-0.5">
                  <button
                    onClick={() => setPreviewMode(false)}
                    className={`px-3 py-1 rounded text-xs font-medium sidebar-transition ${!previewMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Pencil className="w-3 h-3 inline mr-1" /> Edit
                  </button>
                  <button
                    onClick={() => setPreviewMode(true)}
                    className={`px-3 py-1 rounded text-xs font-medium sidebar-transition ${previewMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Eye className="w-3 h-3 inline mr-1" /> Preview
                  </button>
                </div>
              </div>

              {/* Toolbar */}
              {!previewMode && (
                <div className="flex items-center gap-1 px-4 py-2 border-b flex-wrap">
                  <button onClick={() => wrapSelection("**", "**")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Bold">
                    <Bold className="w-4 h-4" />
                  </button>
                  <button onClick={() => wrapSelection("*", "*")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Italic">
                    <Italic className="w-4 h-4" />
                  </button>
                  <button onClick={() => wrapSelection("<u>", "</u>")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Underline">
                    <Underline className="w-4 h-4" />
                  </button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <button onClick={() => wrapSelection("\n- ", "")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Bullet List">
                    <List className="w-4 h-4" />
                  </button>
                  <button onClick={() => wrapSelection("\n1. ", "")} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Numbered List">
                    <ListOrdered className="w-4 h-4" />
                  </button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1" title="Heading">
                        <Heading className="w-4 h-4" /> <ChevronDown className="w-3 h-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => wrapSelection("\n# ", "")}>H1</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => wrapSelection("\n## ", "")}>H2</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => wrapSelection("\n### ", "")}>H3</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="w-px h-5 bg-border mx-1" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="px-2 py-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground text-xs font-medium flex items-center gap-1">
                        Merge Fields <ChevronDown className="w-3 h-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {MERGE_FIELDS.map((f) => (
                        <DropdownMenuItem key={f} onClick={() => insertMergeField(f)} className="font-mono text-xs">
                          {f}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {/* Preview banner */}
              {previewMode && (
                <div className="px-4 py-2 bg-muted text-muted-foreground text-xs border-b">
                  Preview mode — merge fields shown with example values
                </div>
              )}

              {/* Editor / Preview area */}
              <div className="flex-1 px-4 py-3 overflow-y-auto">
                {previewMode ? (
                  <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap" style={{ minHeight: 400 }}>
                    {previewContent || <span className="text-muted-foreground italic">No content to preview.</span>}
                  </div>
                ) : (
                  <textarea
                    ref={editorRef}
                    value={editorContent}
                    onChange={(e) => {
                      setEditorContent(e.target.value);
                      setEditorDirty(true);
                    }}
                    placeholder="Start writing your script..."
                    className="w-full bg-transparent text-foreground text-sm resize-none focus:outline-none placeholder:text-muted-foreground"
                    style={{ minHeight: 400 }}
                  />
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  {wc} words — ~{readTime} min read
                </span>
                {!previewMode && (
                  <Button
                    onClick={handleSave}
                    disabled={!editorDirty || saving}
                    className="gap-2"
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Script
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add Script Modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Script</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Script Name</label>
              <Input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value.slice(0, 60));
                  setNewNameError(false);
                }}
                placeholder="e.g. Term Life Closer"
                className={newNameError ? "border-destructive" : ""}
              />
              {newNameError && <p className="text-xs text-destructive mt-1">Script name is required</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Product Type</label>
              <Select value={newType} onValueChange={(v) => setNewType(v as ProductType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Active</label>
              <Switch checked={newActive} onCheckedChange={setNewActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Create Script</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={!!pendingSelect} onOpenChange={(o) => !o && setPendingSelect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this script. Are you sure you want to leave?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLeave} className="bg-muted text-foreground hover:bg-muted/80">
              Leave Without Saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CallScripts;
