import React, { useEffect, useState } from "react";
import { z } from "zod";
import { X } from "lucide-react";
import type { Lead } from "@/lib/types";
import { toast } from "sonner";
import { AddLeadAssignmentSection } from "@/components/contacts/AddLeadAssignmentSection";
import { AddLeadLeadFormBody } from "@/components/contacts/AddLeadLeadFormBody";
import { useAddLeadAssignableState } from "@/components/contacts/useAddLeadAssignableState";
import { AddLeadFormFooter } from "@/components/contacts/AddLeadFormFooter";
import { useAddLeadModalForm } from "@/components/contacts/useAddLeadModalForm";
import { addLeadLeadFormSchema } from "@/lib/addLeadLeadZod";

export type AddLeadSaveMeta = {
  assignToAgentId: string;
  campaignId: string | null;
};

interface AddLeadModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead>, meta?: AddLeadSaveMeta) => Promise<void>;
  initial?: Partial<Lead> | null;
  currentUserId?: string | null;
  organizationId?: string | null;
  viewerRole?: string;
  viewerIsSuperAdmin?: boolean;
  /** Agents the viewer may assign to (excludes non-downline for TL). */
  assignableAgents?: { id: string; firstName: string; lastName: string }[];
}

const AddLeadModal: React.FC<AddLeadModalProps> = ({
  open,
  onClose,
  onSave,
  initial,
  currentUserId = null,
  organizationId = null,
  viewerRole = "Agent",
  viewerIsSuperAdmin = false,
  assignableAgents = [],
}) => {
  const [saving, setSaving] = useState(false);
  const {
    assignMode,
    setAssignMode,
    specificAgentId,
    setSpecificAgentId,
    attachCampaignId,
    setAttachCampaignId,
    resolvedAssigneeId,
    validateAssignment,
    resetAssignFields,
    canElevateLeadAssignment,
  } = useAddLeadAssignableState({
    initial,
    currentUserId,
    viewerRole,
    viewerIsSuperAdmin,
    assignableAgents,
  });
  const { form, setForm, leadSources } = useAddLeadModalForm({
    open,
    initial,
    resetAssignFields,
  });

  useEffect(() => {
    if (initial) return;
    setAttachCampaignId("");
  }, [resolvedAssigneeId, assignMode, initial, setAttachCampaignId]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addLeadLeadFormSchema.parse({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        state: form.state,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        toast.error(err.errors[0]?.message ?? "Invalid form");
        return;
      }
    }
    const assignErr = validateAssignment();
    if (assignErr) {
      toast.error(assignErr);
      return;
    }
    let assignToAgentId = currentUserId || "";
    if (!initial && canElevateLeadAssignment && currentUserId) {
      assignToAgentId =
        assignMode === "specific_agent" ? specificAgentId : currentUserId;
    }
    if (!assignToAgentId) {
      toast.error("Signing in required to assign ownership.");
      return;
    }
    setSaving(true);
    try {
      const resolvedLeadSource = initial
        ? (form.leadSource ?? "")
        : form.leadSource && leadSources.includes(form.leadSource)
          ? form.leadSource
          : (leadSources[0] ?? "");
      const payload: Partial<Lead> & { assignedAgentId?: string; userId?: string | null } = {
        ...form,
        leadSource: resolvedLeadSource,
        status: form.status ?? "New",
        assignedAgentId: assignToAgentId,
        userId: assignToAgentId,
      };
      const meta: AddLeadSaveMeta | undefined = initial
        ? undefined
        : {
            assignToAgentId,
            campaignId: attachCampaignId ? attachCampaignId : null,
          };
      await onSave(payload, meta);
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} Lead</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <AddLeadLeadFormBody
            form={form}
            setForm={setForm}
            leadSources={leadSources}
            initial={initial}
          />
          {!initial && (
            <AddLeadAssignmentSection
              currentUserId={currentUserId}
              viewerRole={viewerRole}
              viewerIsSuperAdmin={viewerIsSuperAdmin}
              assignableAgents={assignableAgents}
              assignMode={assignMode}
              onAssignModeChange={setAssignMode}
              specificAgentId={specificAgentId}
              onSpecificAgentChange={setSpecificAgentId}
              organizationId={organizationId}
              resolvedAssigneeId={resolvedAssigneeId}
              attachCampaignId={attachCampaignId}
              onAttachCampaignChange={setAttachCampaignId}
            />
          )}
          <AddLeadFormFooter onCancel={onClose} saving={saving} isEdit={!!initial} />
        </form>
      </div>
    </div>
  );
};

export default AddLeadModal;
