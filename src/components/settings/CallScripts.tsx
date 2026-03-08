import React, { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  updatedAt: Date;
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
  if (!text) return 0;
  const stripped = text.replace(/[#*_\->[\]()]/g, "").trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

const CallScripts: React.FC = () => {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [adding, setAdding] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);

  // Unsaved changes dialog
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchScripts();

    const channel = supabase
      .channel('call_scripts_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_scripts' }, () => {
        fetchScripts(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchScripts = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const { data, error } = await supabase
        .from('call_scripts')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const formatted: Script[] = (data || []).map(d => ({
        id: d.id,
        name: d.name,
        productType: (d.product_type as ProductType) || "Custom",
        active: d.active,
        content: d.content || "",
        updatedAt: new Date(d.updated_at),
      }));
      setScripts(formatted);
    } catch (error) {
      console.error("Error fetching scripts:", error);
      toast({
        title: "Error loading scripts",
        description: "Could not fetch scripts from database.",
        variant: "destructive",
      });
    } finally {
      if (showLoading) setLoading(false);
    }
  };

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
  const handleAdd = async () => {
    if (!newName.trim()) {
      setNewNameError(true);
      return;
    }

    try {
      setAdding(true);
      const { data, error } = await supabase
        .from('call_scripts')
        .insert({
          name: newName.trim(),
          product_type: newType,
          active: newActive,
          content: "",
        })
        .select()
        .single();

      if (error) throw error;

      const newScript: Script = {
        id: data.id,
        name: data.name,
        productType: data.product_type as ProductType,
        active: data.active,
        content: data.content,
        updatedAt: new Date(data.updated_at),
      };

      setScripts((prev) => [newScript, ...prev]);
      setSelectedId(data.id);
      setEditorContent("");
      setEditorDirty(false);
      setPreviewMode(false);
      setAddOpen(false);
      setNewName("");
      setNewType("Term Life");
      setNewActive(true);
      toast({ title: "Script created", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to create", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  // Toggle active
  const toggleActive = async (id: string, currentActive: boolean) => {
    try {
      // Optimistic update
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, active: !currentActive, updatedAt: new Date() } : s)));

      const { error } = await supabase
        .from('call_scripts')
        .update({ active: !currentActive, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      toast({ title: "Status updated", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to update status", variant: "destructive" });
      fetchScripts(false); // revert
    }
  };

  // Duplicate
  const duplicateScript = async (id: string) => {
    const orig = scripts.find((s) => s.id === id);
    if (!orig) return;

    try {
      const { data, error } = await supabase
        .from('call_scripts')
        .insert({
          name: `${orig.name} — Copy`,
          product_type: orig.productType,
          active: orig.active,
          content: orig.content,
        })
        .select()
        .single();

      if (error) throw error;

      const dup: Script = {
        id: data.id,
        name: data.name,
        productType: data.product_type as ProductType,
        active: data.active,
        content: data.content,
        updatedAt: new Date(data.updated_at),
      };

      setScripts((prev) => [dup, ...prev]);
      setSelectedId(data.id);
      setEditorContent(data.content);
      setEditorDirty(false);
      setPreviewMode(false);
      toast({ title: "Script duplicated", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to duplicate", variant: "destructive" });
    }
  };

  // Delete
  const confirmDelete = async () => {
    if (!deleteTarget) return;

    try {
      const { error } = await supabase
        .from('call_scripts')
        .delete()
        .eq('id', deleteTarget.id);

      if (error) throw error;

      setScripts((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setEditorContent("");
        setEditorDirty(false);
      }
      setDeleteTarget(null);
      toast({ title: "Script deleted", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
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

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) return;

    try {
      const newName = renameValue.trim();
      setScripts((prev) =>
        prev.map((s) => (s.id === renamingId ? { ...s, name: newName, updatedAt: new Date() } : s))
      );
      setRenamingId(null);

      const { error } = await supabase
        .from('call_scripts')
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq('id', renamingId);

      if (error) throw error;
      toast({ title: "Script renamed", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to rename", variant: "destructive" });
      fetchScripts(false);
    }
  };

  // Save changes (content and any unsaved name/type edits)
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('call_scripts')
        .update({
          name: selected.name,
          product_type: selected.productType,
          content: editorContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', selected.id);

      if (error) throw error;

      setScripts((prev) =>
        prev.map((s) => (s.id === selected.id ? { ...s, content: editorContent, updatedAt: new Date() } : s))
      );
      setEditorDirty(false);
      toast({ title: "Script saved successfully", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Inline product type change
  const changeProductType = (id: string, pt: ProductType) => {
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, productType: pt } : s))
    );
    setEditorDirty(true);
  };

  // Inline name change in editor header
  const changeEditorName = (name: string) => {
    if (!selected) return;
    setScripts((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, name } : s))
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

  if (loading && scripts.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 h-[500px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

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

          <div className="flex-1 overflow-y-auto min-h-[400px]">
            {loading && scripts.length > 0 ? (
              <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : scripts.length === 0 && !search && filterType === "all" ? (
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
                  className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b sidebar-transition ${selectedId === s.id ? "bg-primary/10" : "hover:bg-accent/50"
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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${productBadgeClass[s.productType]}`}>
                        {s.productType}
                      </span>
                      <span className="text-[11px] text-muted-foreground min-w-max shrink-0">{timeAgo(s.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={s.active}
                      onCheckedChange={() => toggleActive(s.id, s.active)}
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
            <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-card">
              <FileText className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Select a script from the list to view and edit it.</p>
            </div>
          ) : (
            <>
              {/* Editor header */}
              <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
                <div className="flex flex-col gap-1 min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2 text-muted-foreground text-[10px] uppercase font-bold tracking-wider">
                    {editorDirty && <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />}
                    {editorDirty ? "Unsaved Changes" : "Saved"}
                  </div>
                  <input
                    value={selected.name}
                    onChange={(e) => changeEditorName(e.target.value)}
                    className="text-base font-semibold bg-transparent text-foreground border-0 focus:outline-none focus:ring-0 w-full truncate p-0 h-6"
                    maxLength={60}
                  />
                  <div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className={`text-[11px] px-2 py-0.5 mt-0.5 rounded border font-medium cursor-pointer hover:opacity-80 ${productBadgeClass[selected.productType]}`}>
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
                </div>
                <div className="flex items-center bg-accent rounded-lg p-0.5 shrink-0 self-start mt-1">
                  <button
                    onClick={() => setPreviewMode(false)}
                    className={`px-3 py-1 rounded text-xs font-medium sidebar-transition ${!previewMode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
                  >
                    <Pencil className="w-3 h-3 inline mr-1" /> Edit
                  </button>
                  <button
                    onClick={() => setPreviewMode(true)}
                    className={`px-3 py-1 rounded text-xs font-medium sidebar-transition ${previewMode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
                  >
                    <Eye className="w-3 h-3 inline mr-1" /> Preview
                  </button>
                </div>
              </div>

              {/* Toolbar */}
              {!previewMode && (
                <div className="flex items-center gap-1 px-4 py-2 border-b flex-wrap bg-card w-full">
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
                <div className="px-4 py-2 bg-muted text-muted-foreground text-xs border-b font-medium tracking-wide">
                  Preview mode — merge fields shown with example values
                </div>
              )}

              {/* Editor / Preview area */}
              <div className="flex-1 px-4 py-4 overflow-y-auto bg-card">
                {previewMode ? (
                  <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap font-sans leading-relaxed" style={{ minHeight: 400 }}>
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
                    placeholder="Start writing your script here..."
                    className="w-full h-full bg-transparent text-foreground text-sm resize-none focus:outline-none placeholder:text-muted-foreground leading-relaxed p-1"
                    style={{ minHeight: 400 }}
                  />
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t bg-card mt-auto shrink-0">
                <span className="text-xs font-medium text-muted-foreground">
                  {wc} {wc === 1 ? 'word' : 'words'} · ~{readTime} min read
                </span>
                {!previewMode && (
                  <Button
                    onClick={handleSave}
                    disabled={!editorDirty || saving}
                    size="sm"
                    className="gap-2 px-6 shadow-sm font-medium"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {saving ? "Saving..." : "Save Changes"}
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
                className={newNameError ? "border-destructive focus-visible:ring-destructive" : ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !adding) handleAdd();
                }}
              />
              {newNameError && <p className="text-xs text-destructive mt-1.5 font-medium">Script name is required</p>}
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
            <div className="flex items-center justify-between bg-accent/30 p-3 rounded-lg border">
              <div className="space-y-0.5">
                <label className="text-sm font-medium text-foreground">Active Status</label>
                <div className="text-xs text-muted-foreground">Agents can use this script on calls</div>
              </div>
              <Switch checked={newActive} onCheckedChange={setNewActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={adding}>Cancel</Button>
            <Button onClick={handleAdd} disabled={adding} className="gap-2">
              {adding && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Script
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => (!o && !saving) && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span>? This action cannot be undone and will remove the script from all agent views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving}>
              Delete Script
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
              You have unsaved changes to your current script. Do you want to discard them and switch scripts?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLeave} className="bg-muted text-foreground hover:bg-muted/80">
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CallScripts;
