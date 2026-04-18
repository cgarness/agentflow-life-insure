import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import type { Template } from "@/components/settings/messageTemplateTypes";
import { parseAttachments } from "@/components/settings/templateAttachmentUtils";
import { parseCategory } from "@/components/settings/templateCategories";
import { TemplateModal } from "@/components/settings/TemplateModal";
import { TemplatesListView } from "@/components/settings/TemplatesListView";
import { TemplatesFiltersRow } from "@/components/settings/TemplatesFiltersRow";

const EmailSMSTemplates: React.FC = () => {
  const { organizationId } = useOrganization();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      let q = supabase.from("message_templates").select("*").order("updated_at", { ascending: false });
      if (organizationId) {
        q = q.eq("organization_id", organizationId);
      }
      const { data, error } = await q;

      if (error) throw error;

      const formatted: Template[] = (data || []).map((d) => ({
        id: d.id,
        name: d.name,
        type: (d.type as "email" | "sms") || "email",
        subject: d.subject,
        content: d.content,
        updatedAt: new Date(d.updated_at),
        category: parseCategory(d.category),
        attachments: parseAttachments(d.attachments),
      }));
      setTemplates(formatted);
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast({ title: "Error loading templates", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const openAdd = () => {
    setEditTarget(null);
    setAddOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditTarget(t);
    setAddOpen(true);
  };

  const duplicateTemplate = async (t: Template) => {
    try {
      const { data, error } = await supabase.from("message_templates").select("*").eq("id", t.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        toast({ title: "Template not found", variant: "destructive" });
        return;
      }
      if (!organizationId) {
        toast({ title: "Organization required", variant: "destructive" });
        return;
      }
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = data;
      const { error: insertError } = await supabase.from("message_templates").insert({
        ...rest,
        name: `Copy of ${data.name}`,
        organization_id: organizationId,
      });
      if (insertError) throw insertError;
      toast({ title: "Template duplicated", className: "bg-success text-success-foreground border-success" });
      fetchTemplates();
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to duplicate template", variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from("message_templates").delete().eq("id", deleteTarget.id);
      if (error) throw error;

      setTemplates((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      toast({ title: "Template deleted", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to delete template", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const filtered = templates.filter((t) => {
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || t.type === filterType;
    const matchCategory = filterCategory === "all" || (t.category ?? "") === filterCategory;
    return matchSearch && matchType && matchCategory;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Email & SMS Templates</h3>
          <p className="text-sm text-muted-foreground">Manage templates for automated and manual messaging</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add Template
        </Button>
      </div>

      <TemplatesFiltersRow
        search={search}
        onSearchChange={setSearch}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        filterCategory={filterCategory}
        onFilterCategoryChange={setFilterCategory}
      />

      <TemplatesListView
        loading={loading}
        filtered={filtered}
        onAdd={openAdd}
        onEdit={openEdit}
        onDuplicate={duplicateTemplate}
        onDelete={setDeleteTarget}
      />

      <TemplateModal
        open={addOpen}
        onOpenChange={setAddOpen}
        editTarget={editTarget}
        organizationId={organizationId}
        onSaved={fetchTemplates}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold text-foreground">&quot;{deleteTarget?.name}&quot;</span>? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EmailSMSTemplates;
