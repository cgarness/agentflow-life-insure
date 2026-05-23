import React, { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activityLogger";
import { Plus, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  type ProductType,
  callScriptInsertSchema,
  callScriptRenameSchema,
  callScriptSaveSchema,
} from "@/components/settings/call-scripts/callScriptSchema";
import type { Script } from "@/components/settings/call-scripts/callScriptTypes";
import { CallScriptsList } from "@/components/settings/call-scripts/CallScriptsList";
import { CallScriptEditor } from "@/components/settings/call-scripts/CallScriptEditor";
import { AddCallScriptDialog } from "@/components/settings/call-scripts/AddCallScriptDialog";
import { DeleteCallScriptDialog } from "@/components/settings/call-scripts/DeleteCallScriptDialog";
import { UnsavedChangesDialog } from "@/components/settings/call-scripts/UnsavedChangesDialog";

const CallScripts: React.FC = () => {
  const { organizationId, role, isSuperAdmin } = useOrganization();
  const { user, profile } = useAuth();
  const canManage = Boolean(isSuperAdmin || role?.toLowerCase() === "admin");

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
  const [newNameError, setNewNameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Script | null>(null);

  // Unsaved changes dialog
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const fetchScripts = useCallback(async (showLoading = true) => {
    if (!organizationId) {
      setScripts([]);
      setLoading(false);
      return;
    }
    try {
      if (showLoading) setLoading(true);
      const { data, error } = await supabase
        .from('call_scripts')
        .select('*')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const formatted: Script[] = (data || []).map(d => ({
        id: d.id,
        name: d.name,
        productType: (d.product_type as ProductType) || "Custom",
        active: d.active ?? true,
        content: d.content || "",
        updatedAt: new Date(d.updated_at ?? Date.now()),
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
  }, [organizationId]);

  useEffect(() => {
    fetchScripts();

    if (!organizationId) return;

    const channel = supabase
      .channel('call_scripts_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_scripts' }, () => {
        fetchScripts(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchScripts]);

  const selected = scripts.find((s) => s.id === selectedId) ?? null;

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

  const handleAdd = async () => {
    if (!canManage) return;
    if (!organizationId) {
      toast({ title: "Organization not loaded", variant: "destructive" });
      return;
    }

    const parsed = callScriptInsertSchema.safeParse({
      name: newName,
      product_type: newType,
      active: newActive,
      content: "",
      organization_id: organizationId,
    });
    if (!parsed.success) {
      const nameErr = parsed.error.issues.find(i => i.path[0] === "name");
      setNewNameError(nameErr?.message ?? "Invalid input");
      return;
    }

    try {
      setAdding(true);
      const { data, error } = await supabase
        .from('call_scripts')
        .insert({
          name: parsed.data.name,
          product_type: parsed.data.product_type,
          active: parsed.data.active,
          content: parsed.data.content,
          organization_id: parsed.data.organization_id,
        })
        .select()
        .single();

      if (error) throw error;

      const newScript: Script = {
        id: data.id,
        name: data.name,
        productType: data.product_type as ProductType,
        active: data.active ?? true,
        content: data.content ?? "",
        updatedAt: new Date(data.updated_at ?? Date.now()),
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
      setNewNameError(null);
      toast({ title: "Script created", className: "bg-success text-success-foreground border-success" });
      void logActivity({
        action: `Created call script "${newScript.name}"`,
        category: "settings",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { scriptId: newScript.id },
      });
    } catch (error) {
      console.error("Create script failed:", error);
      toast({ title: "Failed to create", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    if (!canManage || !organizationId) return;

    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, active: !currentActive, updatedAt: new Date() } : s)));

    const { error } = await supabase
      .from('call_scripts')
      .update({ active: !currentActive })
      .eq('id', id)
      .eq('organization_id', organizationId);

    if (error) {
      console.error("Toggle failed:", error);
      toast({ title: "Failed to update status", variant: "destructive" });
      void fetchScripts(false);
      return;
    }
    toast({ title: "Status updated", className: "bg-success text-success-foreground border-success" });
  };

  const duplicateScript = async (id: string) => {
    if (!canManage || !organizationId) return;
    const orig = scripts.find((s) => s.id === id);
    if (!orig) return;

    const parsed = callScriptInsertSchema.safeParse({
      name: `${orig.name} — Copy`.slice(0, 60),
      product_type: orig.productType,
      active: orig.active,
      content: orig.content,
      organization_id: organizationId,
    });
    if (!parsed.success) {
      toast({ title: "Failed to duplicate", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('call_scripts')
        .insert(parsed.data)
        .select()
        .single();

      if (error) throw error;

      const dup: Script = {
        id: data.id,
        name: data.name,
        productType: data.product_type as ProductType,
        active: data.active ?? true,
        content: data.content ?? "",
        updatedAt: new Date(data.updated_at ?? Date.now()),
      };

      setScripts((prev) => [dup, ...prev]);
      setSelectedId(data.id);
      setEditorContent(dup.content);
      setEditorDirty(false);
      setPreviewMode(false);
      toast({ title: "Script duplicated", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      console.error("Duplicate failed:", error);
      toast({ title: "Failed to duplicate", variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!canManage || !organizationId) return;
    if (!deleteTarget) return;

    try {
      const { error } = await supabase
        .from('call_scripts')
        .delete()
        .eq('id', deleteTarget.id)
        .eq('organization_id', organizationId);

      if (error) throw error;

      setScripts((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setEditorContent("");
        setEditorDirty(false);
      }
      toast({ title: "Script deleted", className: "bg-success text-success-foreground border-success" });
      void logActivity({
        action: `Deleted call script "${deleteTarget.name}"`,
        category: "settings",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { scriptId: deleteTarget.id },
      });
      setDeleteTarget(null);
    } catch (error) {
      console.error("Delete failed:", error);
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const startRename = (id: string) => {
    if (!canManage) return;
    const s = scripts.find((x) => x.id === id);
    if (s) {
      setRenamingId(id);
      setRenameValue(s.name);
      setRenameError(null);
      setTimeout(() => renameRef.current?.focus(), 50);
    }
  };

  const commitRename = async () => {
    if (!canManage || !organizationId) return;
    if (!renamingId) return;

    const parsed = callScriptRenameSchema.safeParse({ name: renameValue });
    if (!parsed.success) {
      setRenameError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    const newName = parsed.data.name;
    const targetId = renamingId;

    setScripts((prev) =>
      prev.map((s) => (s.id === targetId ? { ...s, name: newName, updatedAt: new Date() } : s))
    );
    setRenamingId(null);
    setRenameError(null);

    const { error } = await supabase
      .from('call_scripts')
      .update({ name: newName })
      .eq('id', targetId)
      .eq('organization_id', organizationId);

    if (error) {
      console.error("Rename failed:", error);
      toast({ title: "Failed to rename", variant: "destructive" });
      void fetchScripts(false);
      return;
    }
    toast({ title: "Script renamed", className: "bg-success text-success-foreground border-success" });
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameError(null);
  };

  const handleSave = async () => {
    if (!canManage || !organizationId) return;
    if (!selected) return;

    const parsed = callScriptSaveSchema.safeParse({
      name: selected.name,
      product_type: selected.productType,
      content: editorContent,
    });
    if (!parsed.success) {
      toast({
        title: "Cannot save",
        description: parsed.error.issues[0]?.message ?? "Invalid input",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('call_scripts')
        .update({
          name: parsed.data.name,
          product_type: parsed.data.product_type,
          content: parsed.data.content,
        })
        .eq('id', selected.id)
        .eq('organization_id', organizationId);

      if (error) throw error;

      setScripts((prev) =>
        prev.map((s) =>
          s.id === selected.id
            ? { ...s, name: parsed.data.name, productType: parsed.data.product_type, content: parsed.data.content, updatedAt: new Date() }
            : s
        )
      );
      setEditorDirty(false);
      toast({ title: "Script saved successfully", className: "bg-success text-success-foreground border-success" });
      void logActivity({
        action: `Updated call script "${parsed.data.name}"`,
        category: "settings",
        organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { scriptId: selected.id },
      });
    } catch (error) {
      console.error("Save failed:", error);
      toast({ title: "Failed to save", variant: "destructive" });
      void fetchScripts(false);
    } finally {
      setSaving(false);
    }
  };

  const changeProductType = (id: string, pt: ProductType) => {
    if (!canManage) return;
    setScripts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, productType: pt } : s))
    );
    setEditorDirty(true);
  };

  const changeEditorName = (name: string) => {
    if (!canManage || !selected) return;
    setScripts((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, name } : s))
    );
    setEditorDirty(true);
  };

  const insertMergeField = (field: string) => {
    if (!canManage) return;
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

  const wrapSelection = (before: string, after: string) => {
    if (!canManage) return;
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

  if (loading && scripts.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 h-[500px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Call Scripts</h3>
          <p className="text-sm text-muted-foreground">Write and manage scripts for your agents to use during calls</p>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Script
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md border bg-muted/30 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Call scripts are managed by agency admins. Additional delegation will be handled through Permissions.</span>
        </div>
      )}

      <div className="bg-card rounded-xl border flex overflow-hidden" style={{ minHeight: 560 }}>
        <CallScriptsList
          scripts={scripts}
          filtered={filtered}
          selectedId={selectedId}
          search={search}
          filterType={filterType}
          loading={loading}
          canManage={canManage}
          renamingId={renamingId}
          renameValue={renameValue}
          renameError={renameError}
          renameRef={renameRef}
          onSearchChange={setSearch}
          onFilterChange={setFilterType}
          onSelect={selectScript}
          onAdd={() => setAddOpen(true)}
          onRenameValueChange={(v) => { setRenameValue(v); setRenameError(null); }}
          onRenameCommit={commitRename}
          onRenameCancel={cancelRename}
          onRenameStart={startRename}
          onToggleActive={toggleActive}
          onDuplicate={duplicateScript}
          onRequestDelete={setDeleteTarget}
        />

        <CallScriptEditor
          selected={selected}
          canManage={canManage}
          editorContent={editorContent}
          editorDirty={editorDirty}
          previewMode={previewMode}
          saving={saving}
          editorRef={editorRef}
          onSetPreview={setPreviewMode}
          onEditorChange={(v) => { setEditorContent(v); setEditorDirty(true); }}
          onChangeName={changeEditorName}
          onChangeProductType={changeProductType}
          onSave={handleSave}
          onWrap={wrapSelection}
          onInsertMergeField={insertMergeField}
        />
      </div>

      {canManage && (
        <AddCallScriptDialog
          open={addOpen}
          onOpenChange={(o) => { setAddOpen(o); if (!o) setNewNameError(null); }}
          name={newName}
          type={newType}
          active={newActive}
          nameError={newNameError}
          adding={adding}
          onNameChange={(v) => { setNewName(v); setNewNameError(null); }}
          onTypeChange={setNewType}
          onActiveChange={setNewActive}
          onSubmit={handleAdd}
          onCancel={() => setAddOpen(false)}
        />
      )}

      {canManage && (
        <DeleteCallScriptDialog
          target={deleteTarget}
          saving={saving}
          onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
          onConfirm={confirmDelete}
        />
      )}

      <UnsavedChangesDialog
        open={!!pendingSelect}
        onOpenChange={(o) => !o && setPendingSelect(null)}
        onDiscard={confirmLeave}
      />
    </div>
  );
};

export default CallScripts;
