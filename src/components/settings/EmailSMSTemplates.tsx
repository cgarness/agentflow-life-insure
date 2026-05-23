import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { logActivity } from "@/lib/activityLogger";
import type { Template, TemplateScope } from "@/components/settings/messageTemplateTypes";
import { parseAttachments } from "@/components/settings/templateAttachmentUtils";
import { parseCategory } from "@/components/settings/templateCategories";
import { TemplateModal } from "@/components/settings/TemplateModal";
import { TemplatesListView } from "@/components/settings/TemplatesListView";
import { TemplatesFiltersRow } from "@/components/settings/TemplatesFiltersRow";

const EmailSMSTemplates: React.FC = () => {
  const { organizationId, role, isSuperAdmin } = useOrganization();
  const { user, profile } = useAuth();
  const currentUserId = user?.id ?? null;
  const userName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : undefined;
  const canManageAgency = isSuperAdmin || role === "Admin";

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterScope, setFilterScope] = useState<string>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

  const fetchTemplates = useCallback(async () => {
    if (!organizationId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false });

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
        scope: (d.scope === "personal" ? "personal" : "agency") as TemplateScope,
        createdBy: d.created_by ?? null,
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

  function canModify(t: Template): boolean {
    if (t.scope === "agency") return canManageAgency;
    return t.createdBy === currentUserId;
  }

  const duplicateTemplate = async (t: Template) => {
    if (!organizationId) {
      toast({ title: "Organization required", variant: "destructive" });
      return;
    }
    try {
      // Re-read by id + org so duplication uses the latest content.
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("id", t.id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast({ title: "Template not found", variant: "destructive" });
        return;
      }

      // Scope resolution:
      //   - Agent/TL duplicating Agency  → Personal (owned by current user)
      //   - Anyone duplicating Personal  → Personal (owned by current user)
      //   - Admin/Super Admin duplicating Agency → Agency
      let newScope: TemplateScope;
      let newCreatedBy: string | null;
      if (data.scope === "personal") {
        newScope = "personal";
        newCreatedBy = currentUserId;
      } else if (canManageAgency) {
        newScope = "agency";
        newCreatedBy = null;
      } else {
        newScope = "personal";
        newCreatedBy = currentUserId;
      }

      if (newScope === "personal" && !newCreatedBy) {
        toast({ title: "Sign in required to duplicate", variant: "destructive" });
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("message_templates")
        .insert({
          name: `Copy of ${data.name}`,
          type: data.type,
          subject: data.subject,
          content: data.content,
          attachments: data.attachments,
          category: data.category,
          organization_id: organizationId,
          scope: newScope,
          created_by: newCreatedBy,
        })
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;

      toast({
        title:
          data.scope === "agency" && !canManageAgency
            ? "Duplicated to your Personal templates"
            : "Template duplicated",
        className: "bg-success text-success-foreground border-success",
      });
      void logActivity({
        action: `Duplicated template "${data.name}" → ${newScope}`,
        category: "settings",
        organizationId,
        userId: currentUserId ?? undefined,
        userName,
        metadata: {
          source_template_id: t.id,
          new_template_id: inserted?.id ?? null,
          name: `Copy of ${data.name}`,
          type: data.type,
          scope: newScope,
          category: data.category ?? null,
          event: "template_duplicated",
        },
      });
      fetchTemplates();
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to duplicate template", variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !organizationId) return;
    if (!canModify(deleteTarget)) {
      toast({ title: "You don't have permission to delete this template", variant: "destructive" });
      setDeleteTarget(null);
      return;
    }
    try {
      const { error } = await supabase
        .from("message_templates")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("organization_id", organizationId);
      if (error) throw error;

      setTemplates((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      toast({ title: "Template deleted", className: "bg-success text-success-foreground border-success" });
      void logActivity({
        action: `Deleted ${deleteTarget.scope} template "${deleteTarget.name}"`,
        category: "settings",
        organizationId,
        userId: currentUserId ?? undefined,
        userName,
        metadata: {
          template_id: deleteTarget.id,
          name: deleteTarget.name,
          type: deleteTarget.type,
          scope: deleteTarget.scope,
          category: deleteTarget.category,
          event: "template_deleted",
        },
      });
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
    const matchScope = filterScope === "all" || t.scope === filterScope;
    return matchSearch && matchType && matchCategory && matchScope;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Email & SMS Templates</h3>
          <p className="text-sm text-muted-foreground">
            Manage templates for automated and manual messaging. Agency templates are shared with your organization; Personal templates are visible only to you.
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2" disabled={!organizationId}>
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
        filterScope={filterScope}
        onFilterScopeChange={setFilterScope}
      />

      <TemplatesListView
        loading={loading}
        filtered={filtered}
        currentUserId={currentUserId}
        canManageAgency={canManageAgency}
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
        canManageAgency={canManageAgency}
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
